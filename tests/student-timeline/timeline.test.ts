import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  transferEvent, enrollmentEvents, paymentEvent, smsEvent, sortTimeline,
  forStudentEyes, relativeTime, dueDateMoves, istDayMonth, rupees,
  type TransferRow,
} from "../../lib/studentTimeline";
import type { InstallmentItem } from "../../lib/types";

const OLD_SCHEDULE: InstallmentItem[] = [
  { no: 0, kind: "seat", label: "Book Your Seat", amount: 2000, due: null, paid: true, paid_at: "2026-07-25T12:25:27.170Z" },
  { no: 1, kind: "installment", label: "Remaining balance", amount: 38000, due: "2026-08-01T06:30:00.000Z", paid: false },
];
const NEW_SCHEDULE: InstallmentItem[] = [
  { no: 0, kind: "seat", label: "Book Your Seat", amount: 2000, due: null, paid: true, paid_at: "2026-07-25T12:25:27.170Z" },
  { no: 1, kind: "installment", label: "Remaining balance", amount: 38000, due: "2026-08-29T06:30:00.000Z", paid: false },
];

/** Shipra's exact transfer, as it would be stored. */
function shipraTransfer(over: Partial<TransferRow> = {}): TransferRow {
  return {
    id: "t-1",
    created_at: "2026-07-28T10:12:00.000Z",
    student_name: "Test Student",
    from_course_title: "Safalta Online Foundation 2027/28/29",
    to_course_title: "Safalta GS Foundation Batch for UPSC 2027/28/29",
    from_batch_label: "Starts 13 Jul 2026 · Morning",
    to_batch_label: "Starts 10 Aug 2026 · Morning",
    old_total_fee: 40000, new_total_fee: 40000, amount_paid: 2000, fee_delta: 0, credit_due: 0,
    old_schedule: OLD_SCHEDULE, new_schedule: NEW_SCHEDULE, shift_days: 28,
    reason: "Student requested the August cohort",
    actor_user_id: "anil_kumar", actor_name: "Anil Kumar", capacity_overridden: false,
    snapshot: {
      before: { courseId: "co-safalta", courseTitle: "Safalta Online Foundation 2027/28/29", batchId: null, batchLabel: "Starts 13 Jul 2026 · Morning", batchStart: "2026-07-12T18:30:00.000Z", totalFee: 40000, amountPaid: 2000, outstanding: 38000, schedule: OLD_SCHEDULE, seatsLeft: null },
      after: { courseId: "c-gs", courseTitle: "Safalta GS Foundation Batch for UPSC 2027/28/29", batchId: "b-mr1jfh0k-oupfzv", batchLabel: "Starts 10 Aug 2026 · Morning", batchStart: "2026-08-09T18:30:00.000Z", totalFee: 40000, amountPaid: 2000, outstanding: 38000, schedule: NEW_SCHEDULE, seatsLeft: 20 },
      contentAccess: { beforeItems: 12, afterItems: 34 },
    },
    ...over,
  };
}

const changeFor = (ev: ReturnType<typeof transferEvent>, label: string) => ev.changes.find((c) => c.label === label);

describe("the transfer entry reads as a sentence, not a diff", () => {
  const ev = transferEvent(shipraTransfer());

  test("a course change says so explicitly", () => {
    assert.match(ev.title, /^Course & batch changed:/);
    assert.match(ev.title, /Safalta Online Foundation 2027\/28\/29/);
    assert.match(ev.title, /Safalta GS Foundation Batch for UPSC 2027\/28\/29/);
    assert.match(ev.title, /starts 10 Aug/);
  });

  test("a same-course move is described as a batch change instead", () => {
    const same = transferEvent(shipraTransfer({ to_course_title: "Safalta Online Foundation 2027/28/29" }));
    assert.match(same.title, /^Batch changed:/);
    assert.ok(!same.changes.some((c) => c.label === "Course"), "no course row when the course did not change");
  });

  test("who and why are carried, with a name rather than an id", () => {
    assert.equal(ev.actor.name, "Anil Kumar");
    assert.equal(ev.reason, "Student requested the August cohort");
  });
});

describe("the itemised changes", () => {
  const ev = transferEvent(shipraTransfer());

  test("an unchanged fee is labelled unchanged, not left to be compared", () => {
    const fee = changeFor(ev, "Total fee")!;
    assert.equal(fee.before, "₹40,000");
    assert.equal(fee.after, "₹40,000 (no change)");
    assert.equal(fee.emphasis, false, "an unchanged fee is not the thing to look at");
  });

  test("the paid amount is shown as carried over", () => {
    assert.equal(changeFor(ev, "Amount paid")!.after, "₹2,000 (carried over)");
  });

  test("outstanding is unchanged and says so", () => {
    const o = changeFor(ev, "Outstanding")!;
    assert.equal(o.before, "₹38,000");
    assert.equal(o.after, "₹38,000 (unchanged)");
  });

  test("the due date move is itemised and emphasised — the point of this transfer", () => {
    const due = changeFor(ev, "Due date — Remaining balance")!;
    assert.equal(due.before, "₹38,000 due 1 Aug");
    assert.equal(due.after, "29 Aug");
    assert.equal(due.emphasis, true);
  });

  test("paid lines produce no due-date row", () => {
    assert.equal(ev.changes.filter((c) => c.label.startsWith("Due date")).length, 1, "only the unpaid line moved");
  });

  test("Class Hub access gained and lost is stated", () => {
    const c = changeFor(ev, "Class Hub content")!;
    assert.equal(c.before, "12 items");
    assert.match(c.after!, /34 items/);
    assert.match(c.after!, /old course content no longer applies/);
  });

  test("seat movement on both batches is stated", () => {
    const s = changeFor(ev, "Seats")!;
    assert.match(s.after!, /target 20 → 19/);
  });

  test("a capacity override is recorded loudly", () => {
    const o = transferEvent(shipraTransfer({ capacity_overridden: true }));
    assert.match(changeFor(o, "Capacity")!.after!, /senior admin overrode/);
  });

  test("a fee increase is emphasised and a credit is flagged as not refunded", () => {
    const up = transferEvent(shipraTransfer({ new_total_fee: 67000, fee_delta: 27000 }));
    assert.equal(changeFor(up, "Total fee")!.emphasis, true);
    const down = transferEvent(shipraTransfer({ new_total_fee: 1000, fee_delta: -39000, credit_due: 1000 }));
    assert.match(changeFor(down, "Credit due")!.after!, /not refunded/);
  });
});

describe("history written before the snapshot column still renders", () => {
  test("a row with no snapshot degrades instead of disappearing", () => {
    const ev = transferEvent(shipraTransfer({ snapshot: null }));
    assert.match(ev.title, /Course & batch changed/);
    // outstanding is recomputed from the flat columns rather than shown as blank
    assert.equal(changeFor(ev, "Outstanding")!.before, "₹38,000");
    assert.equal(changeFor(ev, "Class Hub content"), undefined, "what we do not know, we do not claim");
  });

  test("a null batch label does not crash the sentence", () => {
    const ev = transferEvent(shipraTransfer({ from_batch_label: null, to_batch_label: null, snapshot: null }));
    assert.match(ev.title, /no batch/);
    assert.ok(ev.changes.length > 0);
  });
});

describe("surfaced events", () => {
  test("a payment reads plainly and attributes the gateway, not a person", () => {
    const ev = paymentEvent({ id: "p1", created_at: "2026-07-25T12:25:27.170Z", amount: 2000, status: "PAID", item: "Safalta", payment_kind: "seat", installment_no: null, mode: "razorpay", reference_no: "NAMAN-X", receipt_no: null });
    assert.equal(ev.title, "Seat booking received — ₹2,000");
    assert.equal(ev.actor.name, "student / gateway");
  });

  test("an offline payment is attributed to staff", () => {
    const ev = paymentEvent({ id: "p2", created_at: "2026-07-25T00:00:00Z", amount: 5000, status: "PAID", item: null, payment_kind: null, installment_no: 2, mode: "cash", reference_no: null, receipt_no: null });
    assert.equal(ev.title, "Installment 2 received — ₹5,000");
    assert.equal(ev.actor.name, "recorded by staff");
  });

  test("an SMS surfaces from sms_logs rather than a duplicate log", () => {
    const ev = smsEvent({ id: "s1", created_at: "2026-07-26T00:00:00Z", sent_at: "2026-07-26T00:05:00Z", template_name: "Installment Reminder", status: "DELIVERED", sent_by_type: "ADMIN", installment_no: 1, course_id: null });
    assert.equal(ev.at, "2026-07-26T00:05:00Z", "the send time, not the row creation time");
    assert.match(ev.title, /Installment Reminder \(installment 1\)/);
  });

  test("enrolment creation is derived from the row that already exists", () => {
    const [created] = enrollmentEvents(baseEnrollment());
    assert.match(created.title, /^Enrolled in Safalta/);
    assert.match(created.detail!, /Pay in full · total ₹40,000/);
  });
});

describe("one action is never reported twice", () => {
  test("a plan change caused by a transfer does not also appear as a schedule change", () => {
    const evs = enrollmentEvents(baseEnrollment({
      payment_plan_changed_at: "2026-07-28T10:12:00.000Z",
      payment_plan_change_reason: "Batch/course transfer: Student requested the August cohort",
    }));
    assert.equal(evs.filter((e) => e.type === "plan_changed").length, 0, "the transfer event already tells this story");
  });

  test("a genuine manual plan change DOES appear", () => {
    const evs = enrollmentEvents(baseEnrollment({
      payment_plan_changed_at: "2026-07-20T10:00:00.000Z",
      payment_plan_change_reason: "Student asked to split into 3",
      payment_plan_changed_by: "anil_kumar",
    }));
    assert.equal(evs.filter((e) => e.type === "plan_changed").length, 1);
  });

  test("a discount is reported with its before/after fee", () => {
    const evs = enrollmentEvents(baseEnrollment({ discount_amount: 5000, discount_applied_at: "2026-07-21T00:00:00Z", original_total_fee: 45000 }));
    const d = evs.find((e) => e.type === "discount_applied")!;
    assert.match(d.title, /₹5,000 off/);
    assert.equal(d.changes[0].before, "₹45,000");
  });
});

describe("ordering and visibility", () => {
  test("newest first, with a stable tiebreak on equal timestamps", () => {
    const a = { ...paymentEvent({ id: "a", created_at: "2026-07-01T00:00:00Z", amount: 1, status: "PAID", item: null, payment_kind: null, installment_no: null, mode: null, reference_no: null, receipt_no: null }) };
    const b = { ...paymentEvent({ id: "b", created_at: "2026-07-03T00:00:00Z", amount: 1, status: "PAID", item: null, payment_kind: null, installment_no: null, mode: null, reference_no: null, receipt_no: null }) };
    const c = { ...paymentEvent({ id: "c", created_at: "2026-07-01T00:00:00Z", amount: 1, status: "PAID", item: null, payment_kind: null, installment_no: null, mode: null, reference_no: null, receipt_no: null }) };
    const sorted = sortTimeline([a, b, c]);
    assert.deepEqual(sorted.map((e) => e.id), ["payment:b", "payment:a", "payment:c"]);
    assert.deepEqual(sortTimeline([c, a, b]).map((e) => e.id), sorted.map((e) => e.id), "same input set, same order");
  });

  test("a student-facing view carries no internal reason, actor or snapshot", () => {
    const [safe] = forStudentEyes([transferEvent(shipraTransfer())]);
    assert.equal(safe.reason, null, "internal notes are written for colleagues");
    assert.equal(safe.actor.name, null);
    assert.equal(safe.snapshot, null);
    assert.match(safe.title, /Course & batch changed/, "but what happened is still visible");
  });
});

describe("time is rendered the way the rest of the app renders it", () => {
  const NOW = Date.parse("2026-07-30T10:12:00.000Z");

  test("relative time uses whole units and reads naturally", () => {
    assert.equal(relativeTime("2026-07-28T10:12:00.000Z", NOW), "2 days ago");
    assert.equal(relativeTime("2026-07-30T09:12:00.000Z", NOW), "1 hour ago");
    assert.equal(relativeTime("2026-07-30T10:11:30.000Z", NOW), "just now");
    assert.equal(relativeTime("2026-05-01T00:00:00.000Z", NOW), "3 months ago", "90 days, floored to 30-day months");
  });

  test("a late-evening IST event does not slip to the wrong day", () => {
    // 23:55 IST on 28 Jul is 18:25Z the same day. Naive UTC formatting is fine
    // here, but 00:10 IST on 29 Jul is 18:40Z on the 28th — that is the one that
    // breaks if the timezone is dropped.
    assert.equal(istDayMonth("2026-07-28T18:25:00.000Z"), "28 Jul");
    assert.equal(istDayMonth("2026-07-28T18:40:00.000Z"), "29 Jul", "past IST midnight, so it is the next day");
  });

  test("money is formatted in the Indian numbering system", () => {
    assert.equal(rupees(38000), "₹38,000");
    assert.equal(rupees(2500000), "₹25,00,000");
    assert.equal(rupees(null), "—");
  });
});

describe("due-date diffing", () => {
  test("only unpaid lines whose date actually changed are reported", () => {
    assert.deepEqual(dueDateMoves(OLD_SCHEDULE, NEW_SCHEDULE).map((m) => m.no), [1]);
    assert.deepEqual(dueDateMoves(OLD_SCHEDULE, OLD_SCHEDULE), [], "no movement, no rows");
  });

  test("a line missing from the new schedule is not reported as a move", () => {
    assert.deepEqual(dueDateMoves(OLD_SCHEDULE, [NEW_SCHEDULE[0]]), []);
  });
});

function baseEnrollment(over: Record<string, unknown> = {}) {
  return {
    id: "e-1", created_at: "2026-07-25T12:00:00.000Z",
    course_title: "Safalta Online Foundation 2027/28/29", batch_label: "Starts 13 Jul 2026 · Morning",
    total_fee: 40000, plan_type: "full", status: "seat_booked",
    payment_plan_changed_at: null, payment_plan_changed_by: null, payment_plan_change_reason: null,
    discount_amount: null, discount_applied_at: null, discount_applied_by: null,
    discount_reason: null, original_total_fee: null,
    ...over,
  } as never;
}
