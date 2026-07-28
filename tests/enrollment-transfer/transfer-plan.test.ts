import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  planTransfer, rescheduleForNewStart, resolveStart, parseStartFromLabel, transferIsPermitted,
} from "../../lib/enrollmentTransfer";
import type { Course, CourseBatch, CourseEnrollment, InstallmentItem } from "../../lib/types";

const IST_MIDNIGHT = (d: string) => new Date(new Date(`${d}T00:00:00+05:30`)).toISOString();

function batch(over: Partial<CourseBatch> = {}): CourseBatch {
  return {
    id: "b-target", label: "Morning : Online", mode: "Online", timing: "Morning",
    start_date: IST_MIDNIGHT("2026-08-10"), end_date: null,
    price: 45000, original_price: null, pay_in_full_price: 40000,
    emi_config: {} as CourseBatch["emi_config"], capacity: 40, seats_left: 20, ...over,
  };
}
function course(over: Partial<Course> = {}): Course {
  return {
    id: "c-target", slug: "target-course", title: "Target Course",
    price: 45000, pay_in_full_price: 40000, batches: [batch()], ...over,
  } as unknown as Course;
}
/** Shipra's real shape: a paid seat line and one unpaid balance. */
function enrollment(over: Partial<CourseEnrollment> = {}): CourseEnrollment {
  return {
    id: "e-1", phone: "9999999999", student_name: "Test Student",
    course_id: "c-source", course_slug: "source-course", course_title: "Source Course",
    batch_label: "Starts 13 Jul 2026 · Morning", batch_id: null,
    plan_type: "full", installment_count: 1,
    total_fee: 40000, amount_paid: 2000, status: "seat_booked",
    schedule: [
      { no: 0, kind: "seat", label: "Book Your Seat", amount: 2000, due: null, paid: true, paid_at: "2026-07-25T12:25:27.170Z", reference_no: "NAMAN-X", gateway_ref: "260725280020653" },
      { no: 1, kind: "installment", label: "Remaining balance", amount: 38000, due: "2026-08-01T06:30:00.000Z", paid: false },
    ],
    ...over,
  } as unknown as CourseEnrollment;
}

describe("reading a start date, and admitting where it came from", () => {
  test("the catalog is authoritative when it has a date", () => {
    const r = resolveStart(batch(), "Starts 5 Aug 2026 · Morning");
    assert.equal(r.provenance, "catalog");
    assert.equal(r.iso, IST_MIDNIGHT("2026-08-10"));
  });

  test("a label that disagrees with the catalog is REPORTED, not silently obeyed", () => {
    // This is the live situation: the label says 5 Aug, the catalog says 10 Aug.
    const r = resolveStart(batch(), "Starts 5 Aug 2026 · Morning");
    assert.ok(r.conflict, "a disagreement must be surfaced");
    assert.equal(r.conflict!.labelISO, IST_MIDNIGHT("2026-08-05"));
    assert.equal(r.conflict!.catalogISO, IST_MIDNIGHT("2026-08-10"));
    assert.match(r.detail, /catalog is used/);
  });

  test("with no catalog date the label is parsed, and flagged as parsed", () => {
    const r = resolveStart(batch({ start_date: null }), "Starts 5 Aug 2026 · Morning");
    assert.equal(r.provenance, "parsed_label");
    assert.equal(r.iso, IST_MIDNIGHT("2026-08-05"));
    assert.match(r.detail, /read out of the label/);
  });

  test("an unparseable label yields nothing rather than a guess", () => {
    assert.equal(parseStartFromLabel("Online · Morning"), null);
    assert.equal(parseStartFromLabel(null), null);
    const r = resolveStart(batch({ start_date: null }), "Online · Morning");
    assert.equal(r.provenance, "unknown");
    assert.equal(r.iso, null);
  });

  test("the formats actually present in the data all parse", () => {
    assert.equal(parseStartFromLabel("Starts 13 Jul 2026 · Morning"), IST_MIDNIGHT("2026-07-13"));
    assert.equal(parseStartFromLabel("Safalta July Batch — starts 13 Jul 2026"), IST_MIDNIGHT("2026-07-13"));
    assert.equal(parseStartFromLabel("Starts 10 Aug 2026 · Evening"), IST_MIDNIGHT("2026-08-10"));
  });
});

describe("rescheduling never touches money that has already moved", () => {
  const paid: InstallmentItem = { no: 0, kind: "seat", label: "Book Your Seat", amount: 2000, due: null, paid: true, paid_at: "2026-07-25T12:25:27.170Z", reference_no: "NAMAN-X" };
  const unpaid: InstallmentItem = { no: 1, kind: "installment", label: "Remaining balance", amount: 38000, due: "2026-08-01T06:30:00.000Z", paid: false };

  test("a paid line comes back byte-identical", () => {
    const { schedule } = rescheduleForNewStart([paid, unpaid], IST_MIDNIGHT("2026-07-13"), IST_MIDNIGHT("2026-08-10"));
    assert.deepEqual(schedule[0], paid, "a paid line must survive a transfer untouched");
  });

  test("an unpaid line shifts by the gap between the two batch starts", () => {
    const { schedule, shiftDays } = rescheduleForNewStart([paid, unpaid], IST_MIDNIGHT("2026-07-13"), IST_MIDNIGHT("2026-08-10"));
    assert.equal(shiftDays, 28);
    assert.equal(schedule[1].due, "2026-08-29T06:30:00.000Z");
    assert.equal(schedule[1].amount, 38000, "shifting a date must not change the amount");
    assert.equal(schedule[1].no, 1, "the ordinal is stable");
  });

  test("with no resolvable start on either side, dates are left alone", () => {
    const { schedule, shiftDays } = rescheduleForNewStart([paid, unpaid], null, IST_MIDNIGHT("2026-08-10"));
    assert.equal(shiftDays, null);
    assert.equal(schedule[1].due, unpaid.due, "an unknown shift must not invent a date");
  });

  test("waived and cancelled lines are not moved", () => {
    const waived: InstallmentItem = { no: 2, kind: "installment", label: "Waived", amount: 5000, due: "2026-09-01T06:30:00.000Z", paid: false, status: "waived" };
    const { schedule } = rescheduleForNewStart([waived], IST_MIDNIGHT("2026-07-13"), IST_MIDNIGHT("2026-08-10"));
    assert.equal(schedule[0].due, waived.due);
  });
});

describe("the primary case — Shipra, July to August", () => {
  const plan = planTransfer({
    enrollment: enrollment(),
    sourceCourse: { id: "c-source", title: "Source Course", batches: [] } as unknown as Course,
    targetCourse: course(),
    targetBatchId: "b-target",
    now: Date.parse("2026-07-28T12:00:00Z"),
  });

  test("total fee, amount paid and outstanding are all unchanged", () => {
    assert.equal(plan.money.oldTotal, 40000);
    assert.equal(plan.money.newTotal, 40000, "the target's pay-in-full price matches her current fee");
    assert.equal(plan.money.delta, 0);
    assert.equal(plan.money.amountPaid, 2000, "the 2000 already paid carries over, never resets");
    assert.equal(plan.money.oldOutstanding, 38000);
    assert.equal(plan.money.newOutstanding, 38000);
    assert.equal(plan.money.creditDue, 0);
    assert.ok(plan.financiallyNeutral);
  });

  test("the PAID SEAT LINE is untouched, references and all", () => {
    const seat = plan.schedule.after.find((l) => l.kind === "seat")!;
    assert.equal(seat.paid, true);
    assert.equal(seat.amount, 2000);
    assert.equal(seat.paid_at, "2026-07-25T12:25:27.170Z");
    assert.equal(seat.reference_no, "NAMAN-X");
    assert.equal(seat.gateway_ref, "260725280020653");
    assert.equal(plan.schedule.changes.find((c) => c.kind === "seat")!.effect, "untouched_paid");
  });

  test("ONLY the unpaid 38,000 moves, and it moves later", () => {
    const moved = plan.schedule.changes.filter((c) => c.effect === "shifted");
    assert.equal(moved.length, 1, "exactly one line may move");
    assert.equal(moved[0].amount, 38000);
    assert.equal(moved[0].oldDue, "2026-08-01T06:30:00.000Z");
    assert.equal(moved[0].newDue, "2026-08-29T06:30:00.000Z");
    assert.ok(new Date(moved[0].newDue!) > new Date(moved[0].oldDue!));
  });

  test("the later deadline is surfaced, not buried", () => {
    const w = plan.warnings.find((x) => x.code === "deadline_moves_later");
    assert.ok(w, "pushing a payment deadline out is a revenue-timing effect and must be stated");
    assert.match(w!.detail, /28 days/);
  });

  test("she is a seat_booked record, and that status carries over unchanged", () => {
    assert.equal(plan.source.status, "seat_booked");
    // The plan does not alter status; the SQL carries src.status across verbatim.
    assert.ok(!plan.blocks.some((b) => b.code === "enrollment_cancelled"));
  });

  test("nothing blocks it", () => {
    assert.deepEqual(plan.blocks, []);
    assert.ok(transferIsPermitted(plan));
  });
});

describe("fee differences are reported, never actioned", () => {
  test("a higher fee raises outstanding and charges nothing", () => {
    const plan = planTransfer({
      enrollment: enrollment(),
      sourceCourse: null,
      targetCourse: course({ batches: [batch({ price: 75000, pay_in_full_price: 67000 })] }),
      targetBatchId: "b-target",
    });
    assert.equal(plan.money.direction, "higher");
    assert.equal(plan.money.newTotal, 67000);
    assert.equal(plan.money.delta, 27000);
    assert.equal(plan.money.newOutstanding, 65000, "67000 less the 2000 already paid");
    assert.match(plan.money.detail, /NOTHING is charged/);
    // The difference joins the schedule rather than appearing from nowhere later.
    const unpaidTotal = plan.schedule.after.filter((l) => !l.paid).reduce((a, l) => a + l.amount, 0);
    assert.equal(unpaidTotal, 65000);
  });

  test("a lower fee flags a credit and refunds nothing", () => {
    const plan = planTransfer({
      enrollment: enrollment({ amount_paid: 40000, total_fee: 40000, status: "fully_paid",
        schedule: [{ no: 0, kind: "full", label: "Full Payment", amount: 40000, due: null, paid: true, paid_at: "2026-07-01T00:00:00Z" }] } as Partial<CourseEnrollment>),
      sourceCourse: null,
      targetCourse: course({ batches: [batch({ price: 30000, pay_in_full_price: 30000 })] }),
      targetBatchId: "b-target",
    });
    assert.equal(plan.money.direction, "lower");
    assert.equal(plan.money.creditDue, 10000);
    assert.match(plan.money.detail, /NOTHING is refunded automatically/);
    assert.ok(plan.warnings.some((w) => w.code === "credit_due"));
    assert.ok(!plan.financiallyNeutral);
  });

  test("a fully paid student keeps every paid line", () => {
    const plan = planTransfer({
      enrollment: enrollment({ amount_paid: 40000, status: "fully_paid",
        schedule: [{ no: 0, kind: "full", label: "Full Payment", amount: 40000, due: null, paid: true }] } as Partial<CourseEnrollment>),
      sourceCourse: null, targetCourse: course(), targetBatchId: "b-target",
    });
    assert.equal(plan.money.newOutstanding, 0);
    assert.ok(plan.schedule.after.every((l) => l.paid));
    assert.equal(plan.schedule.changes.every((c) => c.effect === "untouched_paid"), true);
  });

  test("mid-schedule: 2 of 4 paid — the paid two are frozen, the unpaid two move", () => {
    const mid = enrollment({
      total_fee: 40000, amount_paid: 20000, plan_type: "emi", installment_count: 4, status: "partially_paid",
      schedule: [
        { no: 1, kind: "installment", label: "Installment 1 of 4", amount: 10000, due: "2026-07-20T06:30:00.000Z", paid: true, paid_at: "2026-07-20T00:00:00Z" },
        { no: 2, kind: "installment", label: "Installment 2 of 4", amount: 10000, due: "2026-08-20T06:30:00.000Z", paid: true, paid_at: "2026-08-20T00:00:00Z" },
        { no: 3, kind: "installment", label: "Installment 3 of 4", amount: 10000, due: "2026-09-20T06:30:00.000Z", paid: false },
        { no: 4, kind: "installment", label: "Installment 4 of 4", amount: 10000, due: "2026-10-20T06:30:00.000Z", paid: false },
      ],
    } as Partial<CourseEnrollment>);
    const plan = planTransfer({
      enrollment: mid, sourceCourse: null,
      targetCourse: course({ batches: [batch({ price: 40000, pay_in_full_price: null })] }),
      targetBatchId: "b-target",
    });
    const frozen = plan.schedule.changes.filter((c) => c.effect === "untouched_paid");
    const moved = plan.schedule.changes.filter((c) => c.effect === "shifted");
    assert.equal(frozen.length, 2);
    assert.equal(moved.length, 2);
    assert.deepEqual(moved.map((m) => m.no), [3, 4]);
    assert.equal(plan.money.amountPaid, 20000, "money already collected is never re-opened");
  });
});

describe("what a transfer refuses to do", () => {
  test("a cancelled enrollment cannot be transferred", () => {
    const plan = planTransfer({ enrollment: enrollment({ status: "cancelled" } as Partial<CourseEnrollment>), sourceCourse: null, targetCourse: course(), targetBatchId: "b-target" });
    assert.ok(plan.blocks.some((b) => b.code === "enrollment_cancelled"));
    assert.equal(transferIsPermitted(plan), false);
  });

  test("moving a student into the batch they are already in is refused", () => {
    const plan = planTransfer({
      enrollment: enrollment({ course_id: "c-target", batch_id: "b-target" } as Partial<CourseEnrollment>),
      sourceCourse: course(), targetCourse: course(), targetBatchId: "b-target",
    });
    assert.ok(plan.blocks.some((b) => b.code === "same_target"));
  });

  test("a full batch blocks, and only an override gets past it", () => {
    const plan = planTransfer({
      enrollment: enrollment(), sourceCourse: null,
      targetCourse: course({ batches: [batch({ seats_left: 0 })] }), targetBatchId: "b-target",
    });
    const block = plan.blocks.find((b) => b.code === "target_full")!;
    assert.ok(block, "a full batch must block");
    assert.equal(block.overridable, true);
    assert.equal(transferIsPermitted(plan), false, "no override, no transfer");
    assert.equal(transferIsPermitted(plan, { overrideCapacity: true }), true);
  });

  test("an ended batch blocks and cannot be overridden", () => {
    const plan = planTransfer({
      enrollment: enrollment(), sourceCourse: null,
      targetCourse: course({ batches: [batch({ end_date: "2026-01-01T00:00:00Z" })] }),
      targetBatchId: "b-target", now: Date.parse("2026-07-28T00:00:00Z"),
    });
    const b = plan.blocks.find((x) => x.code === "target_batch_ended")!;
    assert.ok(b);
    assert.equal(b.overridable, false);
    assert.equal(transferIsPermitted(plan, { overrideCapacity: true }), false);
  });

  test("an unknown target batch blocks rather than falling back to the course", () => {
    const plan = planTransfer({ enrollment: enrollment(), sourceCourse: null, targetCourse: course(), targetBatchId: "b-does-not-exist" });
    assert.ok(plan.blocks.some((b) => b.code === "no_target_batch"));
  });
});

describe("seat accounting", () => {
  test("the target loses a seat and the source gains one", () => {
    const plan = planTransfer({
      enrollment: enrollment({ batch_id: "b-source" } as Partial<CourseEnrollment>),
      sourceCourse: { id: "c-source", title: "Source", batches: [batch({ id: "b-source", capacity: 30, seats_left: 5 })] } as unknown as Course,
      targetCourse: course(), targetBatchId: "b-target",
    });
    assert.equal(plan.seats.target.seatsLeft, 20);
    assert.equal(plan.seats.target.after, 19);
    assert.equal(plan.seats.source.seatsLeft, 5);
    assert.equal(plan.seats.source.after, 6);
  });

  test("a batch that does not track seats reports null rather than zero", () => {
    const plan = planTransfer({
      enrollment: enrollment(), sourceCourse: null,
      targetCourse: course({ batches: [batch({ capacity: null, seats_left: null })] }), targetBatchId: "b-target",
    });
    assert.equal(plan.seats.target.after, null, "untracked capacity must not be invented as a number");
    assert.ok(!plan.blocks.some((b) => b.code === "target_full"));
  });
});
