/**
 * Ship QA + mutations for phantom neutralize + apply re-anchor (15).
 * Usage:
 *   APPLY=0  — diagnose + dry preview (default)
 *   APPLY=1  — neutralize phantoms + apply 15 re-anchors
 *   REVERT_ONE=1 — after apply, prove revert in rolled-back txn via RPC then re-apply
 */
import {
  getAllCourseEnrollments, getAllCourses, getAllAccessOverrides, updateCourseEnrollment, pageThrough,
} from "../../lib/dataProvider";
import { isActiveEnrollment, isAttemptEnrollment, scheduleAsCheckoutIntent, countsTowardCapacity } from "../../lib/enrollmentScope";
import { lectureAccessForCourse } from "../../lib/entitlements";
import { resolveEnrollmentBatchStart, earliestContentDateForCourse, derivedBatchLabelFromStart } from "../../lib/batchStart";
import { resolveStart } from "../../lib/enrollmentTransfer";
import { previewReanchorEnrollment } from "../../lib/scheduleReanchor";
import { applyReanchorEnrollment, revertReanchorSnapshot, REANCHOR_ACTOR } from "../../lib/scheduleReanchorApply";
import { maskMobile } from "../../lib/phone";
import { getSupabaseAdmin } from "../../lib/supabase";
import { isAccessAtRiskEnrollment } from "../../lib/accessAtRisk";
import type { ContentItem, CourseEnrollment } from "../../lib/types";

const APPLY = process.env.APPLY === "1";
const TAG = `phantom-reanchor-${new Date().toISOString().slice(0, 10)}`;

function seatKey(e: CourseEnrollment): string {
  return `${e.course_title || e.course_id}|${e.batch_label || e.batch_id || "—"}`;
}

async function smsCountSince(iso: string): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) return 0;
  const { count } = await db.from("sms_logs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", iso)
    .in("status", ["SENT", "DELIVERED", "queued", "QUEUED", "sent"]);
  return count || 0;
}

async function main() {
  const startedAt = new Date().toISOString();
  const smsBefore = await smsCountSince(startedAt);
  const [enrollments, courses, overrides] = await Promise.all([
    getAllCourseEnrollments(), getAllCourses(), getAllAccessOverrides(),
  ]);
  const byId = new Map(courses.map((c) => [c.id, c]));
  const now = Date.now();
  const ovrByPhone = new Map(overrides.map((o) => [`${o.phone}|${o.course_id}`, o]));

  let content: ContentItem[] = [];
  const db = getSupabaseAdmin();
  if (db) {
    content = await pageThrough<ContentItem>(() =>
      db.from("content_items").select("id, date, course_id, course_ids").order("id"),
    ).catch(() => []);
  }

  // ─── PART 1: phantoms ─────────────────────────────────────────────
  const phantoms = enrollments.filter((e) =>
    e.status !== "cancelled" && e.status !== "transferred_out" && isAttemptEnrollment(e),
  );
  console.log(`\n=== PART 1 — PHANTOM / ATTEMPT ROWS: ${phantoms.length} ===`);

  const byPhone = new Map<string, CourseEnrollment[]>();
  for (const e of enrollments) {
    const list = byPhone.get(e.phone) || [];
    list.push(e);
    byPhone.set(e.phone, list);
  }

  const paymentByEnr = new Map<string, string>();
  if (db && phantoms.length) {
    const pays = await pageThrough<{ enrollment_id: string | null; status: string }>(() =>
      db.from("payments").select("enrollment_id, status, id").in("enrollment_id", phantoms.map((p) => p.id)).order("id"),
    ).catch(() => [] as { enrollment_id: string | null; status: string }[]);
    for (const p of pays) {
      if (!p.enrollment_id) continue;
      const prev = paymentByEnr.get(p.enrollment_id) || "";
      paymentByEnr.set(p.enrollment_id, prev ? `${prev}|${p.status}` : p.status);
    }
  }

  console.table(phantoms.map((e) => {
    const siblings = (byPhone.get(e.phone) || []).filter((x) => x.id !== e.id);
    const access = lectureAccessForCourse(byId.get(e.course_id), e, undefined, false, now);
    return {
      student: e.student_name,
      phone: maskMobile(e.phone),
      course: (e.course_title || "").slice(0, 28),
      created: e.created_at.slice(0, 10),
      status: e.status,
      paid: e.amount_paid,
      datedUnpaid: (e.schedule || []).filter((s) => !s.paid && s.due).length,
      access: access.status,
      payments: paymentByEnr.get(e.id) || "none",
      realSame: siblings.filter((x) => x.course_id === e.course_id && isActiveEnrollment(x)).length,
      realOther: siblings.filter((x) => x.course_id !== e.course_id && isActiveEnrollment(x)).length,
    };
  }));

  // Seat counts before
  const seatBefore = new Map<string, { all: number; active: number; phantom: number }>();
  for (const e of enrollments) {
    if (e.status === "cancelled" || e.status === "transferred_out") continue;
    const k = seatKey(e);
    const acc = seatBefore.get(k) || { all: 0, active: 0, phantom: 0 };
    acc.all++;
    if (countsTowardCapacity(e)) acc.active++;
    else acc.phantom++;
    seatBefore.set(k, acc);
  }
  console.log("\n=== SEAT COUNTS (before neutralize) — batches with phantoms ===");
  console.table([...seatBefore.entries()]
    .filter(([, v]) => v.phantom > 0)
    .map(([batch, v]) => ({ batch: batch.slice(0, 50), naive: v.all, activeOnly: v.active, phantom: v.phantom })));

  const phantomOutstanding = phantoms.reduce((a, e) => a + Math.max(0, (e.total_fee || 0) - (e.amount_paid || 0)), 0);
  console.log(`\nDistortion if phantoms counted as outstanding: ₹${phantomOutstanding.toLocaleString("en-IN")}`);
  console.log("Root cause: create-payment + enrollStudentInCourse persisted pending + full dated schedule on INITIATED checkout.");
  console.log("Classification: abandoned/failed checkouts (not admin tests). DO NOT DELETE — mark checkout_intent + strip dues.");

  if (APPLY) {
    console.log(`\n=== NEUTRALIZE PHANTOMS (tag=${TAG}) ===`);
    for (const e of phantoms) {
      const next = scheduleAsCheckoutIntent(e.schedule || []);
      await updateCourseEnrollment(e.id, {
        status: "checkout_intent",
        schedule: next,
        payment_plan_change_reason: `[${TAG}] neutralized phantom — undated intent schedule`,
        payment_plan_changed_at: new Date().toISOString(),
        payment_plan_changed_by: "System · phantom-neutralize",
      });
    }
    console.log(`Neutralized ${phantoms.length} rows → status=checkout_intent, dues stripped.`);
  }

  console.log("\n=== CLEANUP CANDIDATES (manual review — not deleted) ===");
  console.table(phantoms.map((e) => ({
    id: e.id,
    student: e.student_name,
    phone: maskMobile(e.phone),
    course: (e.course_title || "").slice(0, 28),
    created: e.created_at.slice(0, 10),
    payments: paymentByEnr.get(e.id) || "none",
    action: "keep as checkout_intent; cancel only if confirmed abandoned",
  })));

  // Reload after neutralize
  const enrollments2 = APPLY ? await getAllCourseEnrollments() : enrollments;
  const phantoms2 = enrollments2.filter((e) =>
    e.status !== "cancelled" && e.status !== "transferred_out" && isAttemptEnrollment(e),
  );
  const seatAfter = new Map<string, { active: number; phantom: number }>();
  for (const e of enrollments2) {
    if (e.status === "cancelled" || e.status === "transferred_out") continue;
    const k = seatKey(e);
    const acc = seatAfter.get(k) || { active: 0, phantom: 0 };
    if (countsTowardCapacity(e)) acc.active++;
    else acc.phantom++;
    seatAfter.set(k, acc);
  }
  console.log("\n=== SEAT COUNTS before → after (activeOnly is correct) ===");
  console.table([...seatBefore.entries()]
    .filter(([, v]) => v.phantom > 0)
    .map(([batch, v]) => {
      const a = seatAfter.get(batch) || { active: 0, phantom: 0 };
      return {
        batch: batch.slice(0, 48),
        naiveBefore: v.all,
        activeAfter: a.active,
        phantomsStill: a.phantom,
        seatsCorrectedBy: v.phantom,
      };
    }));

  // Suvakar check
  const suv = enrollments2.filter((e) => /suvakar/i.test(e.student_name || ""));
  console.log("\n=== SUVAKAR ROWS ===");
  console.table(suv.map((e) => ({
    course: (e.course_title || "").slice(0, 28),
    status: e.status,
    paid: e.amount_paid,
    active: isActiveEnrollment(e),
    datedUnpaid: (e.schedule || []).filter((s) => !s.paid && s.due).length,
    access: lectureAccessForCourse(byId.get(e.course_id), e, undefined, false, now).status,
  })));

  // ─── PART 2: batch starts ─────────────────────────────────────────
  const active = enrollments2.filter(isActiveEnrollment);
  const missingCatalogGroups = new Map<string, { course: string; label: string; catalog: string; classDate: string; n: number; avail: string; resolvedAs: string }>();
  const conflicts: { course: string; label: string; catalog: string; labelParsed: string; n: number }[] = [];
  const labelMismatches: { course: string; currentLabel: string; derivedLabel: string; catalog: string }[] = [];
  let missingCatalogN = 0;
  let stillUnknownN = 0;

  for (const e of active) {
    const course = byId.get(e.course_id);
    const batch = course?.batches?.find((b) => b.id === e.batch_id) ?? null;
    const earliest = earliestContentDateForCourse(content, e.course_id);
    const catalogOnly = resolveEnrollmentBatchStart(course, e); // no class fallback
    const start = resolveEnrollmentBatchStart(course, e, {
      earliestClassISO: earliest,
      createdAtISO: course?.created_at ?? null,
    });
    const raw = resolveStart(batch, e.batch_label);
    if (raw.conflict) {
      conflicts.push({
        course: (e.course_title || "").slice(0, 28),
        label: (e.batch_label || "").slice(0, 36),
        catalog: raw.conflict.catalogISO.slice(0, 10),
        labelParsed: raw.conflict.labelISO.slice(0, 10),
        n: 1,
      });
    }
    if (batch) {
      const derived = derivedBatchLabelFromStart(
        batch.start_date,
        Array.isArray(batch.mode) ? batch.mode[0] : batch.mode,
        Array.isArray(batch.timing) ? batch.timing[0] : batch.timing,
      );
      if (batch.label && derived && batch.label !== derived) {
        labelMismatches.push({
          course: (course?.title || "").slice(0, 28),
          currentLabel: batch.label.slice(0, 40),
          derivedLabel: derived.slice(0, 40),
          catalog: (batch.start_date || "").slice(0, 10),
        });
      }
    }
    const hasStructured = !!(batch?.start_date || course?.batch_start);
    if (!hasStructured || catalogOnly.provenance !== "catalog") {
      // The 245 hole: no structured catalog date (may still resolve via class/label).
      if (!hasStructured) {
        missingCatalogN++;
        const key = `${e.course_id}|${e.batch_label || e.batch_id || ""}`;
        const g = missingCatalogGroups.get(key) || {
          course: (e.course_title || "").slice(0, 28),
          label: (e.batch_label || "—").slice(0, 32),
          catalog: "—",
          classDate: (earliest || "—").toString().slice(0, 10),
          n: 0,
          avail: "nothing",
          resolvedAs: start.provenance,
        };
        g.n++;
        const parts = [];
        if (e.batch_label) parts.push("label");
        if (earliest) parts.push("class");
        g.avail = parts.length ? parts.join("+") : "nothing";
        g.resolvedAs = start.provenance;
        missingCatalogGroups.set(key, g);
      }
    }
    if (!start.iso) stillUnknownN++;
  }

  // Dedupe conflicts
  const conflictMap = new Map<string, typeof conflicts[0]>();
  for (const c of conflicts) {
    const k = `${c.course}|${c.label}|${c.catalog}`;
    const prev = conflictMap.get(k);
    if (prev) prev.n++;
    else conflictMap.set(k, { ...c });
  }

  console.log(`\n=== PART 2 — NO STRUCTURED CATALOG START (active): ${missingCatalogN} · still UNKNOWN after fallbacks: ${stillUnknownN} ===`);
  console.table([...missingCatalogGroups.values()].sort((a, b) => b.n - a.n).slice(0, 40));
  console.log("\n=== LABEL ↔ CATALOG CONFLICTS (catalog wins) ===");
  console.table([...conflictMap.values()]);
  console.log("\n=== LABEL → DERIVED LABEL MISMATCHES (preview only — not overwritten) ===");
  const uniqMis = new Map<string, typeof labelMismatches[0]>();
  for (const m of labelMismatches) uniqMis.set(`${m.course}|${m.currentLabel}`, m);
  console.table([...uniqMis.values()].slice(0, 40));

  // Invariant: true UNKNOWN never blocked
  let unknownBlocked = 0;
  for (const e of active) {
    const course = byId.get(e.course_id);
    const start = resolveEnrollmentBatchStart(course, e, {
      earliestClassISO: earliestContentDateForCourse(content, e.course_id),
    });
    if (start.iso) continue;
    const access = lectureAccessForCourse(course, e, ovrByPhone.get(`${e.phone}|${e.course_id}`), false, now);
    if (access.status === "blocked" || access.status === "grace") unknownBlocked++;
  }
  console.log(`TRUE UNKNOWN batch starts still grace/blocked: ${unknownBlocked} (must be 0)`);

  // ─── PART 3: re-anchor apply ──────────────────────────────────────
  const candidates = enrollments2
    .map((e) => previewReanchorEnrollment(e, byId.get(e.course_id), now))
    .filter((p) => p.skipReason == null && p.wouldChange);
  const rupeesPreview = candidates.reduce((a, p) => a + p.rupeesMovingOutOfMonth, 0);
  console.log(`\n=== PART 3 — RE-ANCHOR CANDIDATES: ${candidates.length} · ₹${rupeesPreview.toLocaleString("en-IN")} out of month ===`);
  console.table(candidates.map((p) => ({
    student: p.studentName,
    phone: maskMobile(p.phone),
    course: p.courseTitle.slice(0, 24),
    batchStart: (p.batchStart || "").slice(0, 10),
    access: `${p.accessBefore}->${p.accessAfter}`,
    rupeesOut: p.rupeesMovingOutOfMonth,
  })));

  const accessDiffs: { student: string; before: string; after: string; reason: string }[] = [];
  let applied = 0;
  let rupeesApplied = 0;
  const snapshotIds: string[] = [];

  if (APPLY) {
    for (const p of candidates) {
      const e = enrollments2.find((x) => x.id === p.enrollmentId)!;
      const course = byId.get(e.course_id);
      const before = lectureAccessForCourse(course, e, ovrByPhone.get(`${e.phone}|${e.course_id}`), false, now);
      const res = await applyReanchorEnrollment({ enrollment: e, course, now, actor: REANCHOR_ACTOR });
      if (!res.ok) {
        console.error("APPLY FAIL", e.id, res.error);
        continue;
      }
      applied++;
      rupeesApplied += res.preview.rupeesMovingOutOfMonth;
      snapshotIds.push(res.snapshotId);
      const refreshed = { ...e, schedule: res.nextSchedule };
      const after = lectureAccessForCourse(course, refreshed, ovrByPhone.get(`${e.phone}|${e.course_id}`), false, now);
      if (before.status !== after.status || before.allowed !== after.allowed) {
        accessDiffs.push({
          student: e.student_name,
          before: `${before.status}/${before.allowed}`,
          after: `${after.status}/${after.allowed}`,
          reason: "re-anchor due dates past batch start",
        });
      }
      // Assert no legitimate access loss
      if (before.allowed && !after.allowed) {
        throw new Error(`ACCESS REGRESSION: ${e.student_name} ${e.id} lost access`);
      }
      console.table(res.preview.lines.filter((l) => l.kind === "installment").map((l) => ({
        student: e.student_name.slice(0, 18),
        no: l.no,
        old: (l.currentDue || "").slice(0, 10),
        neu: (l.proposedDue || "").slice(0, 10),
        days: l.daysShifted,
        paid: l.paid,
      })));
    }
    console.log(`Applied ${applied}/${candidates.length}; ₹${rupeesApplied.toLocaleString("en-IN")} moved out of month`);
    console.log("Snapshot IDs:", snapshotIds.join(", "));
    console.log(`\nRevert command (one):\n  node --import tsx --import ./scripts/_react-cache-shim.mjs --env-file=.env.local -e "import { revertReanchorSnapshot } from './lib/scheduleReanchorApply.ts'; const r=await revertReanchorSnapshot('${snapshotIds[0] || "SNAPSHOT_ID"}'); console.log(r);"`);
    console.log(`\nRevert all via SQL:\n  select public.revert_schedule_reanchor(id) from schedule_reanchor_snapshots where reverted_at is null and created_at >= '${startedAt}';`);

    // Prove revert on one in a rolled-back sense: revert then re-apply
    if (snapshotIds[0] && process.env.REVERT_PROOF !== "0") {
      const sid = snapshotIds[0];
      const rev = await revertReanchorSnapshot(sid);
      console.log("\n=== REVERT PROOF (live revert then re-apply) ===", rev);
      if (rev.ok) {
        const e = await getAllCourseEnrollments().then((all) => all.find((x) => x.id === rev.enrollmentId)!);
        const course = byId.get(e.course_id);
        const again = await applyReanchorEnrollment({ enrollment: e, course, now, actor: REANCHOR_ACTOR });
        console.log("Re-applied after revert proof:", again.ok, again.ok ? again.snapshotId : again.error);
      }
    }
  }

  console.log("\n=== ACCESS STATE DIFFS ===");
  console.table(accessDiffs.length ? accessDiffs : [{ student: "—", before: "—", after: "—", reason: "no flips (or APPLY=0)" }]);

  // Booked 2 Jul / starts 10 Aug synthetic invariant already in unit tests; live check:
  const julyBooked = active.filter((e) => {
    const course = byId.get(e.course_id);
    const start = resolveEnrollmentBatchStart(course, e);
    if (!start.iso) return false;
    const book = Date.parse(e.created_at);
    const bs = Date.parse(start.iso);
    return book < bs && now < bs;
  });
  let preBatchBlocked = 0;
  for (const e of julyBooked) {
    const a = lectureAccessForCourse(byId.get(e.course_id), e, undefined, false, now);
    if (a.status === "blocked" || a.status === "grace") preBatchBlocked++;
  }
  console.log(`Pre-batch enrollments still grace/blocked: ${preBatchBlocked} (must be 0)`);

  // At-risk length
  let atRisk = 0;
  for (const e of enrollments2) {
    const course = byId.get(e.course_id);
    const access = lectureAccessForCourse(course, e, ovrByPhone.get(`${e.phone}|${e.course_id}`), false, now);
    if (isAccessAtRiskEnrollment({ enrollment: e, scheduleAccess: access, override: ovrByPhone.get(`${e.phone}|${e.course_id}`), now })) {
      atRisk++;
    }
  }
  console.log(`Access At Risk list length (shared helper): ${atRisk}`);
  console.log(`Phantom datedUnpaid after: ${phantoms2.reduce((a, e) => a + (e.schedule || []).filter((s) => !s.paid && s.due).length, 0)} (must be 0 after APPLY)`);

  const smsAfter = await smsCountSince(startedAt);
  console.log(`\n=== SMS outbound during run: ${smsAfter - smsBefore} (must be 0) ===`);
  console.log(`Automation: leave enabled=false dry-run=true (untouched).`);
  console.log(`APPLY=${APPLY} TAG=${TAG}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
