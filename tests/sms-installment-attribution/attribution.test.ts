/**
 * Reminder → payment attribution, PER INSTALLMENT.
 *
 * The rule these tests exist to defend: a payment must NEVER be attributed to a
 * reminder for a different installment. Installments have no stable id — they
 * are JSONB elements addressed by an ordinal inside a mutable document — so the
 * dangerous case is a plan change that renumbers the array between the reminder
 * and the payment. Every tier of the matching logic is pinned here, including
 * the one that must REFUSE to answer.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateStats, attributeReminders, installmentFingerprint,
  installmentReminderStates, isInstallmentLine, lineOutstandingAmount, median,
  oldestUnpaidInstallment, rowReminderState,
  type ReminderLogLike,
} from "../../lib/sms/installmentAttribution";
import type { CourseEnrollment, InstallmentItem } from "../../lib/types";

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-27T12:00:00+05:30");

function line(p: Partial<InstallmentItem> & { no: number }): InstallmentItem {
  return {
    kind: "installment", label: `Installment ${p.no}`, amount: 10000,
    due: new Date(NOW - 10 * DAY).toISOString(), paid: false, ...p,
  };
}

function enr(schedule: InstallmentItem[], over: Partial<CourseEnrollment> = {}): CourseEnrollment {
  return {
    id: "enr-1", phone: "9876543210", student_name: "Test Student", email: null,
    course_id: "c1", course_slug: "c", course_title: "Course", batch_label: null,
    plan_type: "emi", total_fee: 30000, amount_paid: 10000, installment_count: 3,
    status: "partially_paid", schedule, created_at: new Date(NOW).toISOString(),
    updated_at: new Date(NOW).toISOString(), ...over,
  } as CourseEnrollment;
}

let logSeq = 0;
function log(p: Partial<ReminderLogLike> & { at: string }): ReminderLogLike {
  return {
    id: `log-${++logSeq}`, status: "SENT", sent_at: p.at, created_at: p.at,
    template_id: "installment_reminder", sent_by_user_id: "admin-1", sent_by_type: "ADMIN",
    course_enrollment_id: "enr-1", installment_no: null, installment_fingerprint: null,
    ...p,
  };
}

/** A reminder keyed the way the send path keys it, for a given line. */
function reminderFor(l: InstallmentItem, at: string, over: Partial<ReminderLogLike> = {}): ReminderLogLike {
  return log({ at, installment_no: l.no, installment_fingerprint: installmentFingerprint(l), ...over });
}

describe("fingerprint identity", () => {
  test("is stable across a renumber but distinguishes different lines", () => {
    const a = line({ no: 1, amount: 10000 });
    const renumbered = { ...a, no: 4 };
    assert.equal(installmentFingerprint(a), installmentFingerprint(renumbered),
      "moving a line's ordinal must not change its identity");

    const differentAmount = line({ no: 1, amount: 12000 });
    assert.notEqual(installmentFingerprint(a), installmentFingerprint(differentAmount));
  });

  test("ignores time-of-day but not the calendar day", () => {
    const morning = line({ no: 1, due: "2026-07-19T06:30:00.000Z" });
    const evening = line({ no: 1, due: "2026-07-19T18:45:00.000Z" });
    const nextDay = line({ no: 1, due: "2026-07-20T06:30:00.000Z" });
    assert.equal(installmentFingerprint(morning), installmentFingerprint(evening));
    assert.notEqual(installmentFingerprint(morning), installmentFingerprint(nextDay));
  });

  test("a seat line and an installment line of the same amount differ", () => {
    const seat = { ...line({ no: 0, amount: 2000 }), kind: "seat" as const, due: null };
    const inst = line({ no: 1, amount: 2000, due: null });
    assert.notEqual(installmentFingerprint(seat), installmentFingerprint(inst));
  });
});

describe("kind matters — seat is not an installment", () => {
  test("only kind:installment is an installment", () => {
    assert.equal(isInstallmentLine({ kind: "installment" }), true);
    assert.equal(isInstallmentLine({ kind: "seat" }), false);
    assert.equal(isInstallmentLine({ kind: "full" }), false);
  });

  test("an enrollment whose only unpaid line is a seat has no target installment", () => {
    const e = enr([
      { ...line({ no: 0, amount: 2000 }), kind: "seat", due: null, paid: false },
      line({ no: 1, paid: true, paid_at: new Date(NOW - 5 * DAY).toISOString() }),
    ]);
    assert.equal(oldestUnpaidInstallment(e), null,
      "an unpaid seat booking must never be offered as an installment to chase");
  });

  test("seat lines get no reminder state at all", () => {
    const e = enr([
      { ...line({ no: 0, amount: 2000 }), kind: "seat", due: null, paid: false },
      line({ no: 1 }),
    ]);
    const states = installmentReminderStates(e, [], NOW);
    assert.deepEqual(states.map((s) => s.installmentNo), [1]);
  });
});

describe("tier 1 — fingerprint match survives a plan change", () => {
  test("a renumbered installment is still matched, and to the RIGHT line", () => {
    const target = line({ no: 1, amount: 10000 });
    const sentAt = new Date(NOW - 6 * DAY).toISOString();
    const reminder = reminderFor(target, sentAt);

    // The plan is restructured AFTER the reminder: a new line is inserted at the
    // front, pushing the reminded installment from no. 1 to no. 2. A naive
    // ordinal join would now credit the reminder to a line nobody was told about.
    const after = enr(
      [line({ no: 1, amount: 7000 }), { ...target, no: 2 }],
      { payment_plan_changed_at: new Date(NOW - 3 * DAY).toISOString() },
    );

    const { byInstallmentNo, unmatched } = attributeReminders(after, [reminder]);
    assert.equal(unmatched.length, 0);
    assert.equal(byInstallmentNo.get(2)?.length, 1, "must follow the line, not the ordinal");
    assert.equal(byInstallmentNo.get(2)?.[0]!.confidence, "fingerprint");
    assert.equal(byInstallmentNo.has(1), false, "the NEW no. 1 was never reminded");
  });
});

describe("tier 2 — the ordinal is trusted only when the plan has not moved", () => {
  test("no plan change: the ordinal is enough", () => {
    const l = line({ no: 2 });
    const r = log({ at: new Date(NOW - 4 * DAY).toISOString(), installment_no: 2 });
    const { byInstallmentNo } = attributeReminders(enr([line({ no: 1, paid: true }), l]), [r]);
    assert.equal(byInstallmentNo.get(2)?.[0]!.confidence, "ordinal");
  });

  test("plan changed after the send and no fingerprint: REFUSES to attribute", () => {
    const r = log({ at: new Date(NOW - 6 * DAY).toISOString(), installment_no: 2 });
    const after = enr([line({ no: 1 }), line({ no: 2, amount: 15000 })], {
      payment_plan_changed_at: new Date(NOW - 2 * DAY).toISOString(),
    });

    const { byInstallmentNo, unmatched } = attributeReminders(after, [r]);
    assert.equal(byInstallmentNo.size, 0, "must not guess which line this was");
    assert.equal(unmatched.length, 1);
    assert.equal(unmatched[0]!.reason, "plan_changed");
  });

  test("plan changed BEFORE the send: the ordinal is trustworthy again", () => {
    const r = log({ at: new Date(NOW - 2 * DAY).toISOString(), installment_no: 2 });
    const e = enr([line({ no: 1 }), line({ no: 2 })], {
      payment_plan_changed_at: new Date(NOW - 9 * DAY).toISOString(),
    });
    assert.equal(attributeReminders(e, [r]).byInstallmentNo.get(2)?.length, 1);
  });

  test("two installments sharing kind+due+amount are told apart by the ordinal, never by array order", () => {
    // A real collision: the fingerprint alone cannot distinguish these, and they
    // are two SEPARATE obligations, not interchangeable.
    const a = line({ no: 1, amount: 10000, due: new Date(NOW - 10 * DAY).toISOString() });
    const b = line({ no: 2, amount: 10000, due: new Date(NOW - 10 * DAY).toISOString() });
    assert.equal(installmentFingerprint(a), installmentFingerprint(b), "premise: identities collide");

    const forB = reminderFor(b, new Date(NOW - 5 * DAY).toISOString());
    const { byInstallmentNo } = attributeReminders(enr([a, b]), [forB]);
    assert.equal(byInstallmentNo.has(1), false, "must not credit the first line just because it came first");
    assert.equal(byInstallmentNo.get(2)?.length, 1);
    assert.equal(byInstallmentNo.get(2)?.[0]!.confidence, "ordinal");
  });

  test("a colliding identity plus a plan change refuses outright", () => {
    const a = line({ no: 1, amount: 10000 });
    const b = line({ no: 2, amount: 10000 });
    const forB = reminderFor(b, new Date(NOW - 6 * DAY).toISOString());
    const after = enr([a, b], { payment_plan_changed_at: new Date(NOW - 2 * DAY).toISOString() });

    const { byInstallmentNo, unmatched } = attributeReminders(after, [forB]);
    assert.equal(byInstallmentNo.size, 0, "ambiguous identity + moved plan = no confident answer");
    assert.equal(unmatched[0]!.reason, "plan_changed");
  });

  test("a recorded identity that matches nothing does NOT fall back to the ordinal", () => {
    // The amount on line 1 was edited after the reminder went out. The slot
    // still exists, but it is no longer the obligation the student was told
    // about, so attributing the payment to it would be a false claim.
    const asSent = line({ no: 1, amount: 10000 });
    const r = reminderFor(asSent, new Date(NOW - 5 * DAY).toISOString());
    const edited = enr([line({ no: 1, amount: 14000 })]);

    const { byInstallmentNo, unmatched } = attributeReminders(edited, [r]);
    assert.equal(byInstallmentNo.size, 0);
    assert.equal(unmatched[0]!.reason, "line_gone");
  });

  test("a keyed reminder whose line has vanished is reported, not reassigned", () => {
    const gone = line({ no: 7, amount: 999 });
    const r = reminderFor(gone, new Date(NOW - 3 * DAY).toISOString());
    const { byInstallmentNo, unmatched } = attributeReminders(enr([line({ no: 1 })]), [r]);
    assert.equal(byInstallmentNo.size, 0);
    assert.equal(unmatched[0]!.reason, "line_gone");
  });
});

describe("tier 3 — historical reminders with no key", () => {
  test("render honestly: never dropped, never attributed", () => {
    const legacy = log({ at: new Date(NOW - 5 * DAY).toISOString(), course_enrollment_id: null });
    const e = enr([line({ no: 2 })]);

    const { byInstallmentNo, unmatched } = attributeReminders(e, [legacy]);
    assert.equal(byInstallmentNo.size, 0, "must never be attributed to an installment");
    assert.equal(unmatched.length, 1, "must never be silently dropped");
    assert.equal(unmatched[0]!.reason, "no_key");

    const state = rowReminderState(e, [legacy], NOW)!;
    assert.equal(state.kind, "reminded_unattributable");
    assert.equal(state.unattributableReason, "no_key");
    assert.equal(state.reminderCount, 0, "an unattributable reminder is not a counted reminder");
  });

  test("a FAILED send is not a reminder", () => {
    const failed = log({ at: new Date(NOW - DAY).toISOString(), status: "FAILED", installment_no: 1 });
    const e = enr([line({ no: 1 })]);
    assert.equal(rowReminderState(e, [failed], NOW)!.kind, "not_reminded");
  });
});

describe("reminder → payment states", () => {
  test("not reminded", () => {
    const s = rowReminderState(enr([line({ no: 1 })]), [], NOW)!;
    assert.equal(s.kind, "not_reminded");
    assert.equal(s.daysSinceFirstReminder, null);
  });

  test("reminded Xd ago", () => {
    const l = line({ no: 1 });
    const s = rowReminderState(enr([l]), [reminderFor(l, new Date(NOW - 3 * DAY).toISOString())], NOW)!;
    assert.equal(s.kind, "reminded");
    assert.equal(s.daysSinceFirstReminder, 3);
    assert.equal(s.reminderCount, 1);
  });

  test("paid BEFORE any reminder is never credited to one", () => {
    const paidAt = new Date(NOW - 8 * DAY).toISOString();
    const l = line({ no: 1, paid: true, paid_at: paidAt });
    const later = reminderFor(l, new Date(NOW - 2 * DAY).toISOString());
    const s = rowReminderState(enr([l]), [later], NOW)!;
    assert.equal(s.kind, "paid_no_reminder");
    assert.equal(s.daysToPayment, null, "never negative, never zero-day");
  });

  test("paid with no reminder at all", () => {
    const l = line({ no: 1, paid: true, paid_at: new Date(NOW - DAY).toISOString() });
    assert.equal(rowReminderState(enr([l]), [], NOW)!.kind, "paid_no_reminder");
  });

  test("paid same day reads 0, not 'after'", () => {
    const at = new Date(NOW - 4 * DAY).toISOString();
    const paidAt = new Date(NOW - 4 * DAY + 5 * 3600_000).toISOString();
    const l = line({ no: 1, paid: true, paid_at: paidAt });
    const s = rowReminderState(enr([l]), [reminderFor(l, at)], NOW)!;
    assert.equal(s.kind, "paid_after_reminder");
    assert.equal(s.daysToPayment, 0);
  });

  test("reminded twice then paid computes from the FIRST reminder", () => {
    const l = line({ no: 1, paid: true, paid_at: new Date(NOW - 2 * DAY).toISOString() });
    const first = reminderFor(l, new Date(NOW - 10 * DAY).toISOString());
    const second = reminderFor(l, new Date(NOW - 4 * DAY).toISOString());
    // Deliberately out of order: ordering must come from the timestamps.
    const s = rowReminderState(enr([l]), [second, first], NOW)!;
    assert.equal(s.kind, "paid_after_reminder");
    assert.equal(s.daysToPayment, 8, "8 days from the FIRST reminder, not 2 from the last");
    assert.equal(s.reminderCount, 2);
    assert.equal(s.daysSinceLastReminder, 4, "days-since-LAST is kept for the hover detail");
  });

  test("a part payment is NOT paid — reminder state and balance are kept", () => {
    const l = line({ no: 1, amount: 10000, paid_amount: 4000 });
    const s = rowReminderState(enr([l]), [reminderFor(l, new Date(NOW - 5 * DAY).toISOString())], NOW)!;
    assert.equal(s.kind, "reminded", "must not read as paid until outstanding hits zero");
    assert.equal(s.outstanding, 6000);
    assert.equal(lineOutstandingAmount(l), 6000);
  });

  test("a refund reverts to reminded, never stays paid", () => {
    const l = line({ no: 1 });
    const reminder = reminderFor(l, new Date(NOW - 6 * DAY).toISOString());

    const paid = enr([{ ...l, paid: true, paid_at: new Date(NOW - DAY).toISOString() }]);
    assert.equal(rowReminderState(paid, [reminder], NOW)!.kind, "paid_after_reminder");

    // Reversal: the line goes back to unpaid. State follows the live schedule.
    const reversed = enr([{ ...l, paid: false, paid_at: null }]);
    const after = rowReminderState(reversed, [reminder], NOW)!;
    assert.equal(after.kind, "reminded");
    assert.equal(after.outstanding, 10000);
  });

  test("three installments keep independent, correctly aligned states", () => {
    const i1 = line({ no: 1, amount: 10000, paid: true, paid_at: new Date(NOW - 12 * DAY).toISOString() });
    const i2 = line({ no: 2, amount: 10000, paid: true, paid_at: new Date(NOW - 3 * DAY).toISOString() });
    const i3 = line({ no: 3, amount: 10000 });

    const logs = [
      // i1: reminded AFTER it was paid -> must not become "paid after reminder"
      reminderFor(i1, new Date(NOW - 11 * DAY).toISOString()),
      // i2: reminded 9d ago, paid 3d ago -> 6d
      reminderFor(i2, new Date(NOW - 9 * DAY).toISOString()),
      // i3: never reminded
    ];

    const states = installmentReminderStates(enr([i1, i2, i3]), logs, NOW);
    const byNo = new Map(states.map((s) => [s.installmentNo, s]));
    assert.equal(byNo.get(1)!.kind, "paid_no_reminder");
    assert.equal(byNo.get(2)!.kind, "paid_after_reminder");
    assert.equal(byNo.get(2)!.daysToPayment, 6);
    assert.equal(byNo.get(3)!.kind, "not_reminded");
    assert.equal(byNo.get(3)!.reminderCount, 0, "i3 must not inherit i2's reminder");
  });

  test("timezone boundary: reminder 23:50 IST, payment 00:10 next day is same-day-crossing, not negative", () => {
    const reminderAt = "2026-07-20T23:50:00+05:30";
    const paidAt = "2026-07-21T00:10:00+05:30";
    const l = line({ no: 1, paid: true, paid_at: new Date(paidAt).toISOString(), due: "2026-07-10T06:30:00.000Z" });
    const s = rowReminderState(enr([l]), [reminderFor(l, new Date(reminderAt).toISOString())], Date.parse("2026-07-25T12:00:00+05:30"))!;
    assert.equal(s.kind, "paid_after_reminder");
    assert.equal(s.daysToPayment, 0, "20 minutes apart is 0 whole days — 'Paid same day', never 1d and never -1");
  });
});

describe("aggregate line", () => {
  test("uses the MEDIAN, so one outlier cannot move it", () => {
    assert.equal(median([1, 2, 3, 60]), 2.5);
    assert.equal(median([2, 3, 4]), 3);
    assert.equal(median([]), null);
  });

  test("counts reminded / paid-after / still-pending per installment", () => {
    const paidL = line({ no: 1, paid: true, paid_at: new Date(NOW - 2 * DAY).toISOString() });
    const openL = line({ no: 1 });

    const paidAfter = rowReminderState(enr([paidL]), [reminderFor(paidL, new Date(NOW - 6 * DAY).toISOString())], NOW);
    const stillOwing = rowReminderState(enr([openL]), [reminderFor(openL, new Date(NOW - 6 * DAY).toISOString())], NOW);
    const untouched = rowReminderState(enr([openL]), [], NOW);

    const agg = aggregateStats([paidAfter, stillOwing, untouched]);
    assert.equal(agg.reminded, 2);
    assert.equal(agg.paidAfterReminder, 1);
    assert.equal(agg.stillPending, 1);
    assert.equal(agg.medianDaysToPayment, 4);
  });
});
