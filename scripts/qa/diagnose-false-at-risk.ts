/**
 * DIAGNOSE: false Access At Risk listings (Suvakar + cohort).
 * Read-only. ZERO SMS.
 *
 * Run: node --import tsx --import ./scripts/_react-cache-shim.mjs --env-file=.env.local \
 *   scripts/qa/diagnose-false-at-risk.ts
 */
import { getAllCourseEnrollments, getAllAccessOverrides, getAllCourses } from "../../lib/dataProvider";
import { lectureAccessForCourse } from "../../lib/entitlements";
import { deriveEnrollment, isLineOutstanding } from "../../lib/installments";
import { buildAccessReminder, activeAccessGrant } from "../../lib/sms/accessReminderService";
import { resolveInstallmentForEnrollment } from "../../lib/sms/installmentReminder";
import { maskMobile } from "../../lib/phone";

const SUV_HINT = /suvakar/i;

async function main() {
  const [enrollments, overrides, courses] = await Promise.all([
    getAllCourseEnrollments(),
    getAllAccessOverrides(),
    getAllCourses(),
  ]);
  const byId = new Map(courses.map((c) => [c.id, c]));
  const now = Date.now();

  const suv = enrollments.filter((e) => SUV_HINT.test(e.student_name || ""));
  console.log("=== SUVAKAR MATCHES ===");
  console.table(suv.map((e) => ({
    id: e.id.slice(0, 8),
    name: e.student_name,
    phone: maskMobile(e.phone),
    status: e.status,
    paid: e.amount_paid,
    fee: e.total_fee,
    batch: e.batch_label,
    course: e.course_title,
  })));

  for (const e of suv) {
    const course = byId.get(e.course_id);
    const ovr = overrides.find((o) => o.phone === e.phone && o.course_id === e.course_id);
    const schedule = lectureAccessForCourse(course, e, undefined, false, now);
    const live = lectureAccessForCourse(course, e, ovr, false, now);
    const grant = activeAccessGrant(ovr, now);
    const d = deriveEnrollment(e, now);
    const owed = Math.max(0, (e.total_fee || 0) - (e.amount_paid || 0));
    const scheduleRisk = schedule.status === "blocked" || schedule.status === "grace" || schedule.status === "expiring";
    const grantHolding = !!grant && owed > 0;
    const onList = e.status !== "cancelled" && (scheduleRisk || grantHolding);

    console.log("\n--- Suvakar schedule lines ---");
    console.table((e.schedule || []).map((s) => ({
      no: s.no,
      kind: s.kind,
      label: s.label,
      amount: s.amount,
      due: s.due,
      paid: s.paid,
      status: s.status ?? null,
      outstanding: isLineOutstanding(s),
      grace: s.grace ?? null,
    })));

    const unpaidDated = (e.schedule || [])
      .filter((i) => isLineOutstanding(i) && i.due)
      .map((i) => ({ no: i.no, due: i.due, amount: i.amount, paid: i.paid }))
      .sort((a, b) => Date.parse(a.due!) - Date.parse(b.due!));
    console.log("\n--- earliest unpaid dated ---");
    console.table(unpaidDated.slice(0, 3));

    const resolved = resolveInstallmentForEnrollment(e, now);
    const preview = await buildAccessReminder({ enrollmentId: e.id, now });

    console.log("\n--- LIST PREDICATE VALUES ---");
    console.table([{
      scheduleStatus: schedule.status,
      scheduleReason: schedule.reason,
      scheduleGraceEnds: schedule.graceEndsAt,
      amountDueAccess: schedule.amountDue,
      liveStatus: live.status,
      liveAllowed: live.allowed,
      grant: !!grant,
      owed,
      scheduleRisk,
      grantHolding,
      onList,
      derivedPaidCount: d.paidCount,
      derivedRemaining: d.remaining,
      nextPayable: d.nextPayable ? `${d.nextPayable.label} due ${d.nextPayable.due}` : null,
    }]);

    console.log("\n--- GATE / PREVIEW ---");
    console.table([{
      sendable: preview.sendable,
      block: preview.blockReason,
      detail: (preview.blockDetail || "").slice(0, 120),
      template: preview.templateId,
      inst: preview.installmentNo,
      resolverOk: resolved.ok,
      resolverReason: resolved.ok ? null : resolved.reason,
    }]);

    console.log("\n=== VERDICT (5 lines) ===");
    console.log(`1. List matched via: scheduleRisk=${scheduleRisk} (${schedule.status}/${schedule.reason}) grantHolding=${grantHolding}`);
    console.log(`2. Gate block: ${preview.blockReason || "none"} — ${preview.blockDetail || "sendable"}`);
    console.log(`3. Wrong side: ${onList && !preview.sendable ? (schedule.status === "active" ? "LIST (should not include active)" : preview.blockReason === "not_access_risk" ? "LIST (gate says not risk)" : "investigate both") : "aligned or sendable"}`);
    console.log(`4. Access driven by unpaid no=${unpaidDated[0]?.no} due=${unpaidDated[0]?.due}; nextPayable=${d.nextPayable?.no}`);
    console.log(`5. Paid lines still outstanding? ${ (e.schedule||[]).filter(s=>s.paid && isLineOutstanding(s)).length }`);
  }

  // Cohort: on list but excluded
  const onList: { e: typeof enrollments[0]; schedule: ReturnType<typeof lectureAccessForCourse>; grant: boolean }[] = [];
  for (const e of enrollments) {
    if (e.status === "cancelled") continue;
    const ovr = overrides.find((o) => o.phone === e.phone && o.course_id === e.course_id);
    const schedule = lectureAccessForCourse(byId.get(e.course_id), e, undefined, false, now);
    const grant = !!activeAccessGrant(ovr, now);
    const owed = Math.max(0, (e.total_fee || 0) - (e.amount_paid || 0));
    const scheduleRisk = schedule.status === "blocked" || schedule.status === "grace" || schedule.status === "expiring";
    if (scheduleRisk || (grant && owed > 0)) onList.push({ e, schedule, grant });
  }

  console.log(`\n=== ON LIST COUNT: ${onList.length} ===`);
  const excludedByReason = new Map<string, number>();
  const excludedRows: Record<string, unknown>[] = [];
  let checked = 0;
  for (const { e, schedule, grant } of onList) {
    checked++;
    const preview = await buildAccessReminder({ enrollmentId: e.id, now });
    if (preview.sendable) continue;
    const reason = preview.blockReason || "unknown";
    excludedByReason.set(reason, (excludedByReason.get(reason) || 0) + 1);
    if (excludedRows.length < 40) {
      excludedRows.push({
        student: e.student_name,
        phone: maskMobile(e.phone),
        schedule: schedule.status,
        grant,
        block: reason,
        detail: (preview.blockDetail || "").slice(0, 80),
      });
    }
  }
  console.log(`Checked ${checked}; on-list-but-excluded = ${[...excludedByReason.values()].reduce((a, b) => a + b, 0)}`);
  console.log("\n--- Exclusion reasons (on list but not sendable) ---");
  console.table([...excludedByReason.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count));
  console.log("\n--- Sample excluded ---");
  console.table(excludedRows);
}

main().catch((e) => { console.error(e); process.exit(1); });
