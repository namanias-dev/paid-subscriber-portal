/**
 * The highest-risk interaction in the transfer feature.
 *
 * A transfer reschedules unpaid installments. The reminder→payment attribution
 * built earlier identifies an installment by a fingerprint of kind|due-date|amount,
 * so moving a due date CHANGES THAT LINE'S IDENTITY BY CONSTRUCTION. The danger is
 * not that attribution breaks — it is that it quietly succeeds against the wrong
 * line and reports "reminded" about an installment nobody was ever reminded about.
 *
 * These tests pin the safe behaviour: a reminder whose line was rescheduled goes
 * UNMATCHED with an honest reason, and never falls through to the ordinal.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { attributeReminders, installmentFingerprint } from "../../lib/sms/installmentAttribution";
import { rescheduleForNewStart } from "../../lib/enrollmentTransfer";
import type { CourseEnrollment, InstallmentItem } from "../../lib/types";

const IST = (d: string) => new Date(`${d}T00:00:00+05:30`).toISOString();

const SCHEDULE: InstallmentItem[] = [
  { no: 1, kind: "installment", label: "Installment 1 of 3", amount: 10000, due: "2026-07-20T06:30:00.000Z", paid: true, paid_at: "2026-07-19T00:00:00Z" },
  { no: 2, kind: "installment", label: "Installment 2 of 3", amount: 10000, due: "2026-09-20T06:30:00.000Z", paid: false },
  { no: 3, kind: "installment", label: "Installment 3 of 3", amount: 10000, due: "2026-11-20T06:30:00.000Z", paid: false },
];

function enrollmentWith(schedule: InstallmentItem[], over: Partial<CourseEnrollment> = {}): CourseEnrollment {
  return { id: "e-old", total_fee: 30000, amount_paid: 10000, schedule, ...over } as unknown as CourseEnrollment;
}

/** A reminder genuinely sent about installment 2, before any transfer. */
function reminderForLine2(enrollmentId = "e-old") {
  return {
    id: "log-1",
    course_enrollment_id: enrollmentId,
    installment_no: 2,
    installment_fingerprint: installmentFingerprint(SCHEDULE[1]),
    status: "DELIVERED",
    sent_at: "2026-09-10T06:00:00.000Z",
    created_at: "2026-09-10T06:00:00.000Z",
  };
}

describe("before any transfer, attribution works normally", () => {
  test("the reminder matches installment 2 by fingerprint", () => {
    const { byInstallmentNo, unmatched } = attributeReminders(enrollmentWith(SCHEDULE), [reminderForLine2()]);
    assert.equal(unmatched.length, 0);
    assert.deepEqual([...byInstallmentNo.keys()], [2]);
    assert.equal(byInstallmentNo.get(2)![0].confidence, "fingerprint");
  });
});

describe("after a transfer reschedules the unpaid lines", () => {
  // Exactly what the transfer does: shift unpaid lines onto the new batch start.
  const { schedule: moved, shiftDays } = rescheduleForNewStart(SCHEDULE, IST("2026-07-13"), IST("2026-08-10"));

  test("the reschedule really did move the line the reminder was about", () => {
    assert.equal(shiftDays, 28);
    assert.notEqual(moved[1].due, SCHEDULE[1].due);
    assert.notEqual(installmentFingerprint(moved[1]), installmentFingerprint(SCHEDULE[1]));
  });

  test("the old reminder does NOT re-point to any line on the new schedule", () => {
    // The transferred row records the plan change, which is what the SQL does.
    const transferred = enrollmentWith(moved, { id: "e-new", payment_plan_changed_at: "2026-09-15T00:00:00.000Z" } as Partial<CourseEnrollment>);
    const { byInstallmentNo, unmatched } = attributeReminders(transferred, [reminderForLine2("e-new")]);

    assert.equal(byInstallmentNo.size, 0, "NOTHING may be reported as reminded — this is the whole point");
    assert.equal(unmatched.length, 1);
    assert.equal(unmatched[0].reason, "plan_changed", "and it must say WHY, not fail silently");
  });

  test("it specifically does not fall through to the ordinal", () => {
    // Ordinal 2 still exists on the new schedule and still costs 10000. Only the
    // due date differs. A naive matcher would happily claim this line was
    // reminded; it was not — that reminder named a 20 Sep deadline.
    const transferred = enrollmentWith(moved, { id: "e-new" } as Partial<CourseEnrollment>);
    const { byInstallmentNo, unmatched } = attributeReminders(transferred, [reminderForLine2("e-new")]);
    assert.ok(moved.some((l) => l.no === 2), "the ordinal is still present, which is what makes this dangerous");
    assert.equal(byInstallmentNo.size, 0);
    assert.equal(unmatched[0].reason, "line_gone");
  });

  test("the PAID line's identity is unchanged, so its history still attributes", () => {
    const paidReminder = {
      id: "log-paid", course_enrollment_id: "e-new", installment_no: 1,
      installment_fingerprint: installmentFingerprint(SCHEDULE[0]),
      status: "DELIVERED", sent_at: "2026-07-15T06:00:00.000Z", created_at: "2026-07-15T06:00:00.000Z",
    };
    // A paid line is never moved, so a reminder about it survives the transfer.
    assert.equal(installmentFingerprint(moved[0]), installmentFingerprint(SCHEDULE[0]));
    const { byInstallmentNo } = attributeReminders(enrollmentWith(moved, { id: "e-new" } as Partial<CourseEnrollment>), [paidReminder]);
    assert.deepEqual([...byInstallmentNo.keys()], [1]);
  });
});

describe("the history stays readable on the row it belongs to", () => {
  test("the superseded row still attributes the reminder correctly", () => {
    // The transfer supersedes rather than deletes, and reminder logs keep pointing
    // at the enrollment they were actually sent for. So the old row — which still
    // describes the 20 Sep deadline the student was told about — reports the truth.
    const superseded = enrollmentWith(SCHEDULE, { id: "e-old", status: "transferred_out", superseded_by: "e-new" } as Partial<CourseEnrollment>);
    const { byInstallmentNo, unmatched } = attributeReminders(superseded, [reminderForLine2("e-old")]);
    assert.equal(unmatched.length, 0);
    assert.equal(byInstallmentNo.get(2)![0].confidence, "fingerprint");
  });

  test("a reminder is never counted twice across the two rows", () => {
    const oldRow = attributeReminders(enrollmentWith(SCHEDULE, { id: "e-old" } as Partial<CourseEnrollment>), [reminderForLine2("e-old")]);
    const newRow = attributeReminders(
      enrollmentWith(rescheduleForNewStart(SCHEDULE, IST("2026-07-13"), IST("2026-08-10")).schedule, { id: "e-new" } as Partial<CourseEnrollment>),
      [],
    );
    const total = [...oldRow.byInstallmentNo.values()].flat().length + [...newRow.byInstallmentNo.values()].flat().length;
    assert.equal(total, 1, "one reminder was sent, so exactly one attribution may exist across both rows");
  });
});

describe("a transfer with no date movement changes nothing about attribution", () => {
  test("same start date on both sides leaves every fingerprint intact", () => {
    const { schedule, shiftDays } = rescheduleForNewStart(SCHEDULE, IST("2026-08-10"), IST("2026-08-10"));
    assert.equal(shiftDays, 0);
    for (let i = 0; i < SCHEDULE.length; i++) {
      assert.equal(installmentFingerprint(schedule[i]), installmentFingerprint(SCHEDULE[i]));
    }
    const { byInstallmentNo, unmatched } = attributeReminders(enrollmentWith(schedule, { id: "e-new" } as Partial<CourseEnrollment>), [reminderForLine2("e-new")]);
    assert.equal(unmatched.length, 0);
    assert.deepEqual([...byInstallmentNo.keys()], [2], "a pure batch-label change must not disturb reminder history");
  });
});
