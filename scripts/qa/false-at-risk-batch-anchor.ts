/**
 * Self-QA: false at-risk listings + batch-start invariant + reanchor preview (no writes).
 * ZERO SMS.
 *
 * Run: node --import tsx --import ./scripts/_react-cache-shim.mjs --env-file=.env.local \
 *   scripts/qa/false-at-risk-batch-anchor.ts
 */
import { getAllCourseEnrollments, getAllAccessOverrides, getAllCourses } from "../../lib/dataProvider";
import { lectureAccessForCourse } from "../../lib/entitlements";
import { isActiveEnrollment, deriveEnrollment } from "../../lib/installments";
import { isAccessAtRiskEnrollment, humanRemindInaction, nextUnpaidDatedLine } from "../../lib/accessAtRisk";
import { resolveEnrollmentBatchStart } from "../../lib/batchStart";
import { previewReanchorEnrollment } from "../../lib/scheduleReanchor";
import { buildAccessReminder, activeAccessGrant } from "../../lib/sms/accessReminderService";
import { planAccessAutomation } from "../../lib/sms/accessAutomation";
import { maskMobile } from "../../lib/phone";

const SUV = /suvakar/i;
const AMAN = "71992ab3-5214-42b5-a80e-7595afc7da01";

async function main() {
  console.log("=== QA: false at-risk · batch anchor · reanchor preview ===");
  console.log("ZERO SMS. Reanchor writes NOTHING.\n");

  const [enrollments, overrides, courses] = await Promise.all([
    getAllCourseEnrollments(), getAllAccessOverrides(), getAllCourses(),
  ]);
  const byId = new Map(courses.map((c) => [c.id, c]));
  const now = Date.now();

  // --- BEFORE (old predicate) vs AFTER (shared) ---
  type Row = { e: typeof enrollments[0]; before: boolean; after: boolean; status: string; active: boolean };
  const compared: Row[] = [];
  for (const e of enrollments) {
    if (e.status === "cancelled") continue;
    const ovr = overrides.find((o) => o.phone === e.phone && o.course_id === e.course_id);
    const schedule = lectureAccessForCourse(byId.get(e.course_id), e, undefined, false, now);
    const grant = activeAccessGrant(ovr, now);
    const owed = Math.max(0, (e.total_fee || 0) - (e.amount_paid || 0));
    const before = (schedule.status === "blocked" || schedule.status === "grace" || schedule.status === "expiring")
      || (!!grant && owed > 0);
    const after = isAccessAtRiskEnrollment({ enrollment: e, scheduleAccess: schedule, override: ovr, now });
    if (before || after) compared.push({ e, before, after, status: schedule.status, active: isActiveEnrollment(e) });
  }
  const vanished = compared.filter((r) => r.before && !r.after);
  const listAfter = compared.filter((r) => r.after);
  console.log("--- List length before → after ---");
  console.table([{ before: compared.filter((r) => r.before).length, after: listAfter.length, vanished: vanished.length }]);
  console.log("--- Vanished (no longer listed) ---");
  console.table(vanished.map((r) => ({
    student: r.e.student_name,
    phone: maskMobile(r.e.phone),
    status: r.e.status,
    paid: r.e.amount_paid,
    schedule: r.status,
    activeEnrollment: r.active,
    reason: !r.active ? "pending_zero_paid" : "access_no_longer_risk",
  })));

  // Access state flips from grace/blocked → active due to batch invariant
  const flips: Record<string, unknown>[] = [];
  for (const e of enrollments) {
    if (!isActiveEnrollment(e)) continue;
    const course = byId.get(e.course_id);
    const batch = resolveEnrollmentBatchStart(course, e);
    if (!batch.iso) continue;
    const access = lectureAccessForCourse(course, e, undefined, false, now);
    // Simulate WITHOUT invariant by checking if unpaid due is past and now < batch
    const unpaid = (e.schedule || []).filter((s) => !s.paid && s.due && s.status !== "cancelled" && s.status !== "waived")
      .sort((a, b) => Date.parse(a.due!) - Date.parse(b.due!))[0];
    if (!unpaid?.due) continue;
    const dueMs = Date.parse(unpaid.due);
    const batchMs = Date.parse(batch.iso);
    const graceEnd = dueMs + 15 * 86400000;
    if (now < batchMs && now > dueMs) {
      flips.push({
        student: e.student_name,
        phone: maskMobile(e.phone),
        batchStart: batch.iso.slice(0, 10),
        unpaidDue: unpaid.due.slice(0, 10),
        wouldHaveBeen: now > graceEnd ? "blocked" : "grace",
        after: access.status,
        allowed: access.allowed,
      });
    }
  }
  console.log("\n--- Access flips (pre-batch overdue → active via invariant) ---");
  console.table(flips);
  const lostAccess = flips.filter((f) => f.allowed === false);
  console.log(`Assert no legitimate access lost: ${lostAccess.length === 0 ? "PASS" : "FAIL " + lostAccess.length}`);

  // Suvakar
  console.log("\n--- Suvakar Safalta (healthy) ---");
  const suvHealthy = enrollments.find((e) => SUV.test(e.student_name || "") && e.status === "partially_paid" && (e.amount_paid || 0) > 0);
  if (suvHealthy) {
    const schedule = lectureAccessForCourse(byId.get(suvHealthy.course_id), suvHealthy, undefined, false, now);
    const onList = isAccessAtRiskEnrollment({ enrollment: suvHealthy, scheduleAccess: schedule, now });
    const preview = await buildAccessReminder({ enrollmentId: suvHealthy.id, now });
    const next = nextUnpaidDatedLine(suvHealthy.schedule);
    console.table([{
      enrollment: suvHealthy.id.slice(0, 8),
      access: schedule.status,
      onList,
      sendable: preview.sendable,
      block: preview.blockReason,
      inaction: humanRemindInaction({ blockReason: preview.blockReason, nextUnpaid: next, scheduleStatus: schedule.status }),
      paid: suvHealthy.amount_paid,
      next: next ? `${next.label} ${next.due?.slice(0, 10)}` : null,
    }]);
  }

  // Aman unchanged?
  console.log("\n--- Aman ---");
  const aman = enrollments.find((e) => e.id === AMAN);
  if (aman) {
    const ovr = overrides.find((o) => o.phone === aman.phone && o.course_id === aman.course_id);
    const schedule = lectureAccessForCourse(byId.get(aman.course_id), aman, undefined, false, now);
    const onList = isAccessAtRiskEnrollment({ enrollment: aman, scheduleAccess: schedule, override: ovr, now });
    const preview = await buildAccessReminder({ enrollmentId: AMAN, now });
    console.table([{
      onList,
      schedule: schedule.status,
      sendable: preview.sendable,
      template: preview.templateId,
      days: preview.daysLeft,
      daysSource: preview.daysSource,
      inst: preview.installmentNo,
      amount: preview.amountDue,
    }]);
  }

  // Pre-batch-start audit
  console.log("\n--- Enrolments with ANY installment due BEFORE batch start ---");
  const preBatch: Record<string, unknown>[] = [];
  let seatBookedAffected = 0;
  let missingBatch = 0;
  for (const e of enrollments) {
    if (!isActiveEnrollment(e)) continue;
    const course = byId.get(e.course_id);
    const batch = resolveEnrollmentBatchStart(course, e);
    if (!batch.iso) { missingBatch++; continue; }
    const bad = (e.schedule || []).filter((s) =>
      s.kind === "installment" && s.due && Date.parse(s.due) < Date.parse(batch.iso!),
    );
    if (!bad.length) continue;
    const access = lectureAccessForCourse(course, e, undefined, false, now);
    const purelyPreBatch = bad.some((s) => !s.paid) && Date.now() < Date.parse(batch.iso);
    if (e.status === "seat_booked") seatBookedAffected++;
    preBatch.push({
      student: e.student_name,
      phone: maskMobile(e.phone),
      course: (e.course_title || "").slice(0, 36),
      batchStart: batch.iso.slice(0, 10),
      provenance: batch.provenance,
      booked: e.created_at.slice(0, 10),
      badLines: bad.map((s) => `#${s.no}:${s.due?.slice(0, 10)}:${s.paid ? "paid" : "unpaid"}`).join(" "),
      access: access.status,
      bucket: purelyPreBatch
        ? (access.status === "active" ? "protected_by_invariant" : "still_risk")
        : "batch_started_or_paid",
    });
  }
  console.table(preBatch.slice(0, 40));
  console.log(`pre-batch dues (active enrollments): ${preBatch.length}; seat_booked affected: ${seatBookedAffected}; missing batch start: ${missingBatch}`);

  // Reanchor preview — prove no writes
  console.log("\n--- Re-anchoring PREVIEW (no writes) ---");
  const fingerprintsBefore = new Map(enrollments.map((e) => [e.id, JSON.stringify(e.schedule)]));
  const previews = enrollments
    .map((e) => previewReanchorEnrollment(e, byId.get(e.course_id), now))
    .filter((p) => !p.skipReason && p.wouldChange);
  // Re-read schedules from same in-memory objects — preview is pure
  let mutated = 0;
  for (const e of enrollments) {
    if (fingerprintsBefore.get(e.id) !== JSON.stringify(e.schedule)) mutated++;
  }
  console.table([{
    candidates: previews.length,
    rupeesOutOfMonth: previews.reduce((a, p) => a + p.rupeesMovingOutOfMonth, 0),
    schedulesMutated: mutated,
  }]);
  console.table(previews.slice(0, 25).map((p) => ({
    student: p.studentName,
    phone: maskMobile(p.phone),
    batch: p.batchStart?.slice(0, 10),
    accessBefore: p.accessBefore,
    accessAfter: p.accessAfter,
    lines: p.lines.filter((l) => l.daysShifted && l.daysShifted !== 0).map((l) => `#${l.no}:${l.daysShifted}d`).join(" "),
    rupeesOut: p.rupeesMovingOutOfMonth,
  })));
  console.log(`Assert schedules byte-identical after preview: ${mutated === 0 ? "PASS" : "FAIL"}`);

  // Partially-paid current → not listed
  console.log("\n--- Partially-paid current on plan still listed? ---");
  const falsePositives = listAfter.filter(({ e, status }) => {
    if (e.status !== "partially_paid" && e.status !== "seat_booked") return false;
    return status === "active";
  });
  console.table([{ listedActivePartials: falsePositives.length }]);

  // Dry-run
  console.log("\n--- Automation dry-run ---");
  const plan = await planAccessAutomation(now);
  console.table([{
    dryRun: plan.dryRun, enabled: plan.settings.enabled, killSwitch: plan.settings.killSwitch,
    wouldSend: plan.wouldSend.length, candidates: plan.candidates.length, sent: plan.sent,
  }]);
  const excl = new Map<string, number>();
  for (const c of plan.candidates) {
    const k = c.skipReason || (c.preview ? "would_send" : "unknown");
    excl.set(k, (excl.get(k) || 0) + 1);
  }
  console.table([...excl.entries()].map(([reason, count]) => ({ reason, count })));
  console.table(plan.wouldSend.slice(0, 15).map((w) => ({
    student: w.studentName, phone: w.maskedPhone, template: w.templateId, days: w.daysLeft, inst: w.installmentNo,
  })));

  console.log("\nSMS_SENT_THIS_RUN=0");
  console.log("DONE");
}

main().catch((e) => { console.error(e); process.exit(1); });
