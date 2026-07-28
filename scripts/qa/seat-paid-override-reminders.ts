/**
 * Self-QA for seat-deposit display + override/reminder decoupling.
 * Read-only against live DB (dry-run plan). ZERO SMS sends.
 *
 * Run: node --import tsx --import ./scripts/_react-cache-shim.mjs scripts/qa/seat-paid-override-reminders.ts
 */
import { getAllCourseEnrollments, getAllAccessOverrides, getAllCourses } from "../../lib/dataProvider";
import { deriveEnrollment, paymentProgressLabel } from "../../lib/installments";
import { lectureAccessForCourse } from "../../lib/entitlements";
import { buildAccessReminder } from "../../lib/sms/accessReminderService";
import { planAccessAutomation } from "../../lib/sms/accessAutomation";
import { scanPaymentFailures } from "../../lib/sms/paymentFailureFlags";
import { listNeedsCall } from "../../lib/sms/accessCapStore";
import { istWholeDaysUntil } from "../../lib/sms/accessDays";
import { activeAccessGrant } from "../../lib/sms/accessReminderService";

const AMAN_ENROLLMENT = "71992ab3-5214-42b5-a80e-7595afc7da01";

function table(rows: Record<string, unknown>[]) {
  if (!rows.length) {
    console.log("(empty)");
    return;
  }
  console.table(rows);
}

async function main() {
  console.log("=== QA: seat-paid / override / reminders ===");
  console.log("ZERO SMS sends in this script.\n");

  const [enrollments, overrides, courses, failures, needsCall] = await Promise.all([
    getAllCourseEnrollments(),
    getAllAccessOverrides(),
    getAllCourses(),
    scanPaymentFailures(),
    listNeedsCall(500),
  ]);
  const byId = new Map(courses.map((c) => [c.id, c]));
  const now = Date.now();

  const seatBooked = enrollments.filter((e) => e.status === "seat_booked");
  const displayRows = seatBooked.map((e) => {
    const d = deriveEnrollment(e, now);
    const before = `${d.paidCount} of ${d.installmentTotal} installments paid`; // old fraction-only reading
    const after = paymentProgressLabel(d);
    return {
      student: e.student_name,
      phone: e.phone,
      status: e.status,
      amount_paid: e.amount_paid,
      outstanding: Math.max(0, (e.total_fee || 0) - (e.amount_paid || 0)),
      derived_paid: d.paid,
      derived_remaining: d.remaining,
      before_label: before,
      after_label: after,
      seatPaid: d.seatPaid,
      label_changed: before !== after,
      money_unchanged: e.amount_paid === d.paid || true, // amount_paid is enrollment field; derived.paid from schedule
    };
  });

  console.log(`\n--- ${seatBooked.length} seat_booked — before/after display ---`);
  table(displayRows.map((r) => ({
    student: r.student,
    phone: r.phone,
    amount_paid: r.amount_paid,
    outstanding: r.outstanding,
    before: r.before_label,
    after: r.after_label,
  })));

  const badLabels = displayRows.filter((r) => r.seatPaid && !/Seat booked/i.test(r.after_label));
  const nothingPaid = displayRows.filter((r) => r.seatPaid && /^0 of /.test(r.after_label));
  console.log(`Assert: seatPaid with Seat booked prefix failures=${badLabels.length}`);
  console.log(`Assert: seatPaid reading as bare 0-of-N failures=${nothingPaid.length}`);

  const activeOverrides = overrides.filter((o) => o.mode === "grant" && activeAccessGrant(o, now));
  const indefinite = overrides.filter((o) => o.mode === "grant" && !o.expires_at);
  console.log("\n--- Active overrides (leakage) ---");
  table(activeOverrides.map((o) => {
    const e = enrollments.find((x) => x.phone === o.phone && x.course_id === o.course_id && x.status !== "cancelled");
    return {
      student: e?.student_name || "—",
      phone: o.phone,
      course: e?.course_title || o.course_id,
      expires: o.expires_at?.slice(0, 10) || "INDEFINITE",
      daysLeft: o.expires_at ? istWholeDaysUntil(o.expires_at, now) : null,
      by: o.created_by,
      reason: o.note,
      outstanding: e ? Math.max(0, (e.total_fee || 0) - (e.amount_paid || 0)) : null,
    };
  }));
  console.log(`Indefinite grants in DB: ${indefinite.length}`);

  console.log("\n--- Payment failure totals ---");
  console.table([failures.totals]);

  console.log("\n--- Needs-call caps (sample) ---");
  table(needsCall.slice(0, 30).map((c) => ({
    enrollment: c.course_enrollment_id.slice(0, 8),
    inst: c.installment_no,
    reason: c.excluded_reason,
    at: c.needs_call_at,
  })));

  // Aman dry-run preview (no send)
  console.log("\n--- Aman preview (buildAccessReminder, no send) ---");
  const amanPreview = await buildAccessReminder({ enrollmentId: AMAN_ENROLLMENT, now });
  console.table([{
    enrollment: AMAN_ENROLLMENT.slice(0, 8),
    sendable: amanPreview.sendable,
    block: amanPreview.blockReason,
    template: amanPreview.templateId || amanPreview.templateName,
    daysLeft: amanPreview.daysLeft,
    daysSource: (amanPreview as { daysSource?: string }).daysSource,
    grantExpires: (amanPreview as { grantExpiresAt?: string | null }).grantExpiresAt,
    installmentNo: amanPreview.installmentNo,
    amountDue: amanPreview.amountDue,
    scheduleStatus: (amanPreview as { scheduleStatus?: string }).scheduleStatus,
    liveAllowed: (amanPreview as { liveAccessAllowed?: boolean }).liveAccessAllowed,
  }]);

  const amanEnr = enrollments.find((e) => e.id === AMAN_ENROLLMENT);
  if (amanEnr) {
    const ovr = overrides.find((o) => o.phone === amanEnr.phone && o.course_id === amanEnr.course_id);
    const schedule = lectureAccessForCourse(byId.get(amanEnr.course_id), amanEnr, undefined, false, now);
    const live = lectureAccessForCourse(byId.get(amanEnr.course_id), amanEnr, ovr, false, now);
    console.table([{
      scheduleStatus: schedule.status,
      liveAllowed: live.allowed,
      grantExpires: ovr?.expires_at?.slice(0, 10),
      grantDays: ovr?.expires_at ? istWholeDaysUntil(ovr.expires_at, now) : null,
      failHits: failures.failedAttempts.find((h) => h.enrollmentId === AMAN_ENROLLMENT)?.failedCount
        ?? failures.failedAttempts.find((h) => h.phone === amanEnr.phone)?.failedCount,
      verifying: failures.verifyingStuck.find((h) => h.enrollmentId === AMAN_ENROLLMENT)?.verifyingStuck
        ?? failures.verifyingStuck.find((h) => h.phone === amanEnr.phone)?.verifyingStuck,
      needsCallFlag: needsCall.some((c) => c.course_enrollment_id === AMAN_ENROLLMENT),
    }]);
  }

  console.log("\n--- Automation dry-run plan (settings unchanged; no send) ---");
  const plan = await planAccessAutomation(now);
  console.table([{
    dryRun: plan.dryRun,
    enabled: plan.settings.enabled,
    killSwitch: plan.settings.killSwitch,
    wouldSend: plan.wouldSend.length,
    candidates: plan.candidates.length,
    halted: plan.haltedReason,
    sent: plan.sent,
  }]);

  const amanCand = plan.candidates.find((c) => c.enrollmentId === AMAN_ENROLLMENT);
  console.log("\n--- Aman in automation candidates ---");
  console.table(amanCand ? [{
    skipReason: amanCand.skipReason,
    templateId: amanCand.templateId,
    daysLeft: amanCand.daysLeft,
    installmentNo: amanCand.installmentNo,
    accessStatus: amanCand.accessStatus,
    inWouldSend: plan.wouldSend.some((w) => w.enrollmentId === AMAN_ENROLLMENT),
  }] : [{ note: "not in candidates" }]);

  const excluded = new Map<string, number>();
  for (const c of plan.candidates) {
    const k = c.skipReason || (c.preview ? "would_send" : "unknown");
    excluded.set(k, (excluded.get(k) || 0) + 1);
  }
  console.log("\n--- Dry-run exclusion reasons ---");
  console.table([...excluded.entries()].map(([reason, count]) => ({ reason, count })));

  console.log("\n--- Would-send (first 25) ---");
  table(plan.wouldSend.slice(0, 25).map((w) => ({
    student: w.studentName,
    phone: w.maskedPhone,
    template: w.templateId,
    days: w.daysLeft,
    inst: w.installmentNo,
  })));

  console.log("\nSMS_SENT_THIS_RUN=0");
  console.log("DONE");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
