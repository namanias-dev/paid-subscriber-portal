/**
 * Diagnose phantom ₹0 enrollments + missing batch starts. Read-only.
 */
import { getAllCourseEnrollments, getAllCourses, getAllAccessOverrides } from "../../lib/dataProvider";
import { isActiveEnrollment, isAttemptEnrollment, deriveEnrollment } from "../../lib/installments";
import { lectureAccessForCourse } from "../../lib/entitlements";
import { resolveEnrollmentBatchStart } from "../../lib/batchStart";
import { resolveStart } from "../../lib/enrollmentTransfer";
import { previewReanchorEnrollment } from "../../lib/scheduleReanchor";
import { maskMobile } from "../../lib/phone";
import { getSupabaseAdmin } from "../../lib/supabase";
import { pageThrough } from "../../lib/dataProvider";

async function main() {
  const [enrollments, courses, overrides] = await Promise.all([
    getAllCourseEnrollments(), getAllCourses(), getAllAccessOverrides(),
  ]);
  const byId = new Map(courses.map((c) => [c.id, c]));
  const now = Date.now();

  const phantoms = enrollments.filter((e) =>
    e.status !== "cancelled" && e.status !== "transferred_out" && isAttemptEnrollment(e),
  );
  console.log(`=== PHANTOM / ATTEMPT ROWS: ${phantoms.length} ===`);

  const byPhone = new Map<string, typeof enrollments>();
  for (const e of enrollments) {
    const list = byPhone.get(e.phone) || [];
    list.push(e);
    byPhone.set(e.phone, list);
  }

  const db = getSupabaseAdmin();
  const paymentByEnr = new Map<string, { statuses: string[]; n: number }>();
  if (db) {
    const pays = await pageThrough<{ enrollment_id: string | null; status: string }>(() =>
      db.from("payments").select("enrollment_id, status, id").in("enrollment_id", phantoms.map((p) => p.id)).order("id"),
    ).catch(() => [] as { enrollment_id: string | null; status: string }[]);
    for (const p of pays) {
      if (!p.enrollment_id) continue;
      const acc = paymentByEnr.get(p.enrollment_id) || { statuses: [], n: 0 };
      acc.statuses.push(p.status);
      acc.n++;
      paymentByEnr.set(p.enrollment_id, acc);
    }
  }

  console.table(phantoms.map((e) => {
    const siblings = (byPhone.get(e.phone) || []).filter((x) => x.id !== e.id);
    const realSame = siblings.filter((x) => x.course_id === e.course_id && isActiveEnrollment(x));
    const realOther = siblings.filter((x) => x.course_id !== e.course_id && isActiveEnrollment(x));
    const access = lectureAccessForCourse(byId.get(e.course_id), e, undefined, false, now);
    const pays = paymentByEnr.get(e.id);
    const d = deriveEnrollment(e);
    return {
      student: e.student_name,
      phone: maskMobile(e.phone),
      course: (e.course_title || "").slice(0, 32),
      created: e.created_at.slice(0, 10),
      status: e.status,
      paid: e.amount_paid,
      fee: e.total_fee,
      scheduleLines: (e.schedule || []).length,
      datedUnpaid: (e.schedule || []).filter((s) => !s.paid && s.due).length,
      access: access.status,
      payments: pays ? `${pays.n}:${[...new Set(pays.statuses)].join("|")}` : "none",
      realSameCourse: realSame.length,
      realOtherCourse: realOther.length,
      outstandingIfCounted: d.remaining,
    };
  }));

  // Distortion estimates
  const phantomOutstanding = phantoms.reduce((a, e) => a + Math.max(0, (e.total_fee || 0) - (e.amount_paid || 0)), 0);
  const active = enrollments.filter(isActiveEnrollment);
  const activeOutstanding = active.reduce((a, e) => a + Math.max(0, (e.total_fee || 0) - (e.amount_paid || 0)), 0);
  const allNonCancelled = enrollments.filter((e) => e.status !== "cancelled" && e.status !== "transferred_out");
  const naiveOutstanding = allNonCancelled.reduce((a, e) => a + Math.max(0, (e.total_fee || 0) - (e.amount_paid || 0)), 0);

  // Seat counts by batch_id — who counts phantoms
  const seatByBatch = new Map<string, { active: number; phantom: number; label: string; course: string }>();
  for (const e of enrollments) {
    if (e.status === "cancelled" || e.status === "transferred_out") continue;
    const key = e.batch_id || `label:${e.course_id}:${e.batch_label || "?"}`;
    const acc = seatByBatch.get(key) || { active: 0, phantom: 0, label: e.batch_label || "—", course: e.course_title || e.course_id };
    if (isActiveEnrollment(e)) acc.active++;
    else acc.phantom++;
    seatByBatch.set(key, acc);
  }
  const seatDistort = [...seatByBatch.entries()].filter(([, v]) => v.phantom > 0);

  console.log("\n--- Distortion summary ---");
  console.table([{
    phantomRows: phantoms.length,
    phantomOutstandingIfCounted: phantomOutstanding,
    activeOutstanding: activeOutstanding,
    naiveAllOutstanding: naiveOutstanding,
    overstatedBy: naiveOutstanding - activeOutstanding,
    batchesWithPhantomSeats: seatDistort.length,
    phantomSeatSlots: seatDistort.reduce((a, [, v]) => a + v.phantom, 0),
  }]);
  console.log("\n--- Batches where phantoms inflate seat occupancy ---");
  console.table(seatDistort.map(([k, v]) => ({
    key: k.slice(0, 36),
    course: v.course.slice(0, 36),
    label: (v.label || "").slice(0, 40),
    activeSeats: v.active,
    phantomSeats: v.phantom,
    ifPhantomsCounted: v.active + v.phantom,
  })));

  // Batch start gaps among ACTIVE enrollments
  console.log("\n=== BATCH START COVERAGE (active enrollments) ===");
  const groups = new Map<string, {
    course: string; label: string; catalog: string | null; parsed: string | null;
    conflict: boolean; n: number; provenance: string;
  }>();
  let unknown = 0;
  let conflictN = 0;
  for (const e of active) {
    const course = byId.get(e.course_id);
    const batch = course?.batches?.find((b) => b.id === e.batch_id) ?? null;
    const resolved = resolveStart(batch, e.batch_label);
    const fallback = resolveEnrollmentBatchStart(course, e);
    if (!fallback.iso) unknown++;
    if (resolved.conflict) conflictN++;
    const key = `${e.course_id}||${e.batch_id || ""}||${e.batch_label || ""}`;
    const g = groups.get(key) || {
      course: e.course_title || e.course_id,
      label: e.batch_label || "—",
      catalog: batch?.start_date || course?.batch_start || null,
      parsed: resolved.provenance === "parsed_label" ? resolved.iso : (resolved.conflict?.labelISO || null),
      conflict: !!resolved.conflict,
      n: 0,
      provenance: fallback.provenance,
    };
    g.n++;
    groups.set(key, g);
  }
  const unknownGroups = [...groups.values()].filter((g) => g.provenance === "unknown");
  console.table([{
    activeEnrollments: active.length,
    unknownBatchStart: unknown,
    labelCatalogConflicts: conflictN,
    distinctUnknownGroups: unknownGroups.length,
  }]);
  console.log("\n--- Top unknown / unreliable groups ---");
  console.table(
    [...groups.values()]
      .filter((g) => g.provenance === "unknown" || g.conflict || !g.catalog)
      .sort((a, b) => b.n - a.n)
      .slice(0, 40)
      .map((g) => ({
        course: g.course.slice(0, 36),
        label: g.label.slice(0, 40),
        catalog: g.catalog?.slice(0, 10) || "NONE",
        parsedLabel: g.parsed?.slice(0, 10) || "—",
        conflict: g.conflict,
        provenance: g.provenance,
        students: g.n,
      })),
  );

  console.log("\n--- Label ↔ catalog conflicts ---");
  console.table(
    [...groups.values()].filter((g) => g.conflict).map((g) => ({
      course: g.course.slice(0, 36),
      label: g.label.slice(0, 40),
      catalog: g.catalog?.slice(0, 10),
      parsedFromLabel: g.parsed?.slice(0, 10),
      students: g.n,
    })),
  );

  // Reanchor candidates again
  const reanchor = active
    .map((e) => previewReanchorEnrollment(e, byId.get(e.course_id), now))
    .filter((p) => !p.skipReason && p.wouldChange);
  console.log("\n--- Reanchor candidates (preview) ---");
  console.table([{ n: reanchor.length, rupeesOut: reanchor.reduce((a, p) => a + p.rupeesMovingOutOfMonth, 0) }]);
}

main().catch((e) => { console.error(e); process.exit(1); });
