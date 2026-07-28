/**
 * STEP 2 of the reminder sequence: the decision to send it, or not.
 *
 * The rule these tests exist to defend: nobody is told how to pay something they
 * have already paid. Thirty minutes is plenty of time for the student to pay, opt
 * out, or have their plan restructured, so eligibility is re-derived when the job
 * runs and every one of those changes must stop the send with a named reason.
 *
 * Time is TRAVELLED, never waited on: `evaluateFollowUp` is pure and takes the
 * world as an argument, so "30 minutes later" is a different argument, not a
 * different wall clock.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateFollowUp, followUpBackoffMs, followUpDedupeKey, isTransientSendFailure,
  locateFollowUpLine, terminalSkipReason, CANCEL_REASON_LABELS,
  FOLLOW_UP_DELAY_MINUTES, INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID,
  type FollowUpCheckContext, type ScheduledSend,
} from "../../lib/sms/installmentFollowUp";
import { installmentFingerprint } from "../../lib/sms/installmentAttribution";
import type { CourseEnrollment, InstallmentItem } from "../../lib/types";

const DAY = 86_400_000;
const MIN = 60_000;
const REMINDED_AT = Date.parse("2026-07-28T10:00:00+05:30");
const FIRES_AT = REMINDED_AT + FOLLOW_UP_DELAY_MINUTES * MIN;

function line(p: Partial<InstallmentItem> & { no: number }): InstallmentItem {
  return {
    kind: "installment", label: `Installment ${p.no}`, amount: 10000,
    due: new Date(REMINDED_AT - 10 * DAY).toISOString(), paid: false, ...p,
  };
}

function enr(schedule: InstallmentItem[], over: Partial<CourseEnrollment> = {}): CourseEnrollment {
  return {
    id: "enr-1", phone: "9876543210", student_name: "Test Student", email: null,
    course_id: "c1", course_slug: "c", course_title: "Course", batch_label: null,
    plan_type: "emi", total_fee: 30000, amount_paid: 10000, installment_count: 3,
    status: "partially_paid", schedule,
    created_at: new Date(REMINDED_AT).toISOString(), updated_at: new Date(REMINDED_AT).toISOString(),
    ...over,
  } as CourseEnrollment;
}

/** A queued follow-up, keyed exactly the way the send path keys it. */
function job(l: InstallmentItem, over: Partial<ScheduledSend> = {}): ScheduledSend {
  return {
    id: "job-1",
    template_id: INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID,
    normalized_mobile: "9876543210",
    student_name: "Test Student", student_id: "stu-1", course_id: "c1",
    course_enrollment_id: "enr-1",
    installment_no: l.no,
    installment_fingerprint: installmentFingerprint(l),
    parent_send_id: "00000000-0000-0000-0000-0000000000aa",
    job_id: null,
    scheduled_at: new Date(FIRES_AT).toISOString(),
    status: "claimed", attempts: 1, max_attempts: 3,
    last_error: null, cancel_reason: null,
    actor_user_id: "admin-1", actor_type: "ADMIN", sent_log_id: null,
    created_at: new Date(REMINDED_AT).toISOString(),
    updated_at: new Date(REMINDED_AT).toISOString(),
    finished_at: null,
    ...over,
  };
}

const ACTIVE_TEMPLATE = { status: "active" as const, gateway_template_id: "1777178519743722233" };

function ctx(enrollment: CourseEnrollment | null, over: Partial<FollowUpCheckContext> = {}): FollowUpCheckContext {
  return { enrollment, optedOut: false, alreadyInstructed: false, template: ACTIVE_TEMPLATE, ...over };
}

describe("the follow-up goes out when nothing has changed", () => {
  test("still unpaid 30 minutes later => send", () => {
    const l = line({ no: 1 });
    const d = evaluateFollowUp(job(l), ctx(enr([l])));
    assert.equal(d.send, true);
  });

  test("the delay is one named constant, not a magic number", () => {
    assert.equal(FOLLOW_UP_DELAY_MINUTES, 30);
  });
});

describe("PAID between the reminder and the follow-up — the case that matters most", () => {
  test("the line is flagged paid => cancelled, reason installment_paid", () => {
    const l = line({ no: 1 });
    const paid = { ...l, paid: true, paid_at: new Date(REMINDED_AT + 10 * MIN).toISOString() };
    const d = evaluateFollowUp(job(l), ctx(enr([paid])));
    assert.equal(d.send, false);
    assert.equal(d.send === false && d.reason, "installment_paid");
  });

  test("paid at minute 10 is caught even though the job was queued at minute 0", () => {
    // The job carries the state from scheduling time; the decision uses the state
    // it is given now. If these were ever conflated this test would send.
    const l = line({ no: 1 });
    const queued = job(l);
    const settled = { ...l, paid: true, paid_at: new Date(REMINDED_AT + 10 * MIN).toISOString() };
    assert.equal(evaluateFollowUp(queued, ctx(enr([settled]))).send, false);
  });

  test("part payments that together clear the line => cancelled", () => {
    const l = line({ no: 1, amount: 10000 });
    const cleared = { ...l, paid: false, paid_amount: 10000 };
    const d = evaluateFollowUp(job(l), ctx(enr([cleared])));
    assert.equal(d.send === false && d.reason, "installment_paid");
  });

  test("a PART payment is NOT paid — the follow-up still goes", () => {
    // Half the money is not the money. The instructions are still useful.
    const l = line({ no: 1, amount: 10000 });
    const partial = { ...l, paid: false, paid_amount: 4000 };
    assert.equal(evaluateFollowUp(job(l), ctx(enr([partial]))).send, true);
  });
});

describe("the other auto-cancels, each with its own reason", () => {
  test("opted out in the meantime", () => {
    const l = line({ no: 1 });
    const d = evaluateFollowUp(job(l), ctx(enr([l]), { optedOut: true }));
    assert.equal(d.send === false && d.reason, "opted_out");
  });

  test("installment waived", () => {
    const l = line({ no: 1 });
    const d = evaluateFollowUp(job(l), ctx(enr([{ ...l, status: "waived" }])));
    assert.equal(d.send === false && d.reason, "installment_voided");
  });

  test("installment cancelled", () => {
    const l = line({ no: 1 });
    const d = evaluateFollowUp(job(l), ctx(enr([{ ...l, status: "cancelled" }])));
    assert.equal(d.send === false && d.reason, "installment_voided");
  });

  test("enrolment cancelled", () => {
    const l = line({ no: 1 });
    const d = evaluateFollowUp(job(l), ctx(enr([l], { status: "cancelled" })));
    assert.equal(d.send === false && d.reason, "enrollment_cancelled");
  });

  test("enrolment gone entirely", () => {
    const d = evaluateFollowUp(job(line({ no: 1 })), ctx(null));
    assert.equal(d.send === false && d.reason, "enrollment_gone");
  });

  test("the same instructions already went out for this line", () => {
    const l = line({ no: 1 });
    const d = evaluateFollowUp(job(l), ctx(enr([l]), { alreadyInstructed: true }));
    assert.equal(d.send === false && d.reason, "already_instructed");
  });

  test("template deactivated after the reminder went out", () => {
    const l = line({ no: 1 });
    const d = evaluateFollowUp(job(l), ctx(enr([l]), { template: { status: "draft", gateway_template_id: "177" } }));
    assert.equal(d.send === false && d.reason, "template_inactive");
  });

  test("template lost its DLT id", () => {
    const l = line({ no: 1 });
    const d = evaluateFollowUp(job(l), ctx(enr([l]), { template: { status: "active", gateway_template_id: null } }));
    assert.equal(d.send === false && d.reason, "template_inactive");
  });

  test("every cancel reason has human wording — no raw enum reaches a staff member", () => {
    const reasons = [
      "installment_paid", "installment_voided", "installment_restructured",
      "enrollment_cancelled", "enrollment_gone", "opted_out",
      "already_instructed", "template_inactive", "cancelled_by_staff",
    ];
    for (const r of reasons) {
      assert.ok(CANCEL_REASON_LABELS[r], `${r} has no label`);
      assert.ok(!CANCEL_REASON_LABELS[r]!.includes("_"), `${r} label still looks like an enum`);
    }
  });
});

describe("a plan change between the reminder and the follow-up", () => {
  test("the reminded line survives a RENUMBERING and is still found", () => {
    // Same obligation, different ordinal: the fingerprint is what recognises it.
    const original = line({ no: 2, amount: 20000, due: "2026-07-18T06:30:00.000Z" });
    const queued = job(original);
    const renumbered = enr([
      line({ no: 1, amount: 5000, paid: true }),
      line({ no: 2, amount: 8000 }),
      line({ no: 3, amount: 20000, due: "2026-07-18T06:30:00.000Z" }),
    ]);
    const located = locateFollowUpLine(renumbered, queued);
    assert.equal(located.line?.no, 3);
    assert.equal(evaluateFollowUp(queued, ctx(renumbered)).send, true);
  });

  test("the reminded line is GONE => cancelled as restructured, never re-pointed", () => {
    // A slot now holding a different amount is a different obligation. Sending
    // payment instructions about it would be about something else entirely.
    const original = line({ no: 2, amount: 20000 });
    const queued = job(original);
    const rebuilt = enr([line({ no: 1, amount: 15000 }), line({ no: 2, amount: 15000 })]);
    const d = evaluateFollowUp(queued, ctx(rebuilt));
    assert.equal(d.send === false && d.reason, "installment_restructured");
  });

  test("an ambiguous fingerprint falls back to the ordinal only when it agrees", () => {
    const twin = line({ no: 1, amount: 10000, due: "2026-07-18T06:30:00.000Z" });
    const other = line({ no: 2, amount: 10000, due: "2026-07-18T06:30:00.000Z" });
    const both = enr([twin, other]);
    // Two lines share an identity; the ordinal is what tells them apart.
    assert.equal(locateFollowUpLine(both, job(twin)).line?.no, 1);
    assert.equal(locateFollowUpLine(both, job(other)).line?.no, 2);
  });

  test("ambiguous fingerprint whose ordinal points elsewhere => refuses", () => {
    const twin = line({ no: 1, amount: 10000, due: "2026-07-18T06:30:00.000Z" });
    const other = line({ no: 2, amount: 10000, due: "2026-07-18T06:30:00.000Z" });
    const queued = job(twin, { installment_no: 9 });
    const located = locateFollowUpLine(enr([twin, other]), queued);
    assert.equal(located.line, null);
  });

  test("a keyless job (no fingerprint) falls back to the ordinal", () => {
    const l = line({ no: 2 });
    const queued = job(l, { installment_fingerprint: null });
    assert.equal(locateFollowUpLine(enr([line({ no: 1 }), l]), queued).line?.no, 2);
  });

  test("only kind:installment counts — a seat line never satisfies the lookup", () => {
    const seat = { ...line({ no: 0, amount: 2000 }), kind: "seat" as const, label: "Book Your Seat", due: null };
    const queued = job(line({ no: 0, amount: 2000 }), { installment_no: 0, installment_fingerprint: null });
    assert.equal(locateFollowUpLine(enr([seat]), queued).line, null);
  });
});

describe("three installments stay independent", () => {
  test("paying no.1 does not cancel the follow-up for no.2", () => {
    const l1 = line({ no: 1, amount: 10000, paid: true });
    const l2 = line({ no: 2, amount: 20000 });
    const l3 = line({ no: 3, amount: 30000 });
    const schedule = enr([l1, l2, l3]);
    assert.equal(evaluateFollowUp(job(l2), ctx(schedule)).send, true);
    assert.equal(evaluateFollowUp(job(l3), ctx(schedule)).send, true);
    // ...and the paid one is refused.
    assert.equal(evaluateFollowUp(job(l1), ctx(schedule)).send, false);
  });
});

describe("retries and duplicate suppression", () => {
  test("backoff grows and is capped", () => {
    assert.equal(followUpBackoffMs(1), 1 * 60_000);
    assert.equal(followUpBackoffMs(2), 2 * 60_000);
    assert.equal(followUpBackoffMs(3), 4 * 60_000);
    assert.equal(followUpBackoffMs(99), 30 * 60_000);
  });

  test("a gateway failure is transient; a compliance refusal is not", () => {
    assert.equal(isTransientSendFailure("send_failed", "502"), true);
    assert.equal(isTransientSendFailure("gateway_not_configured", null), true);
    assert.equal(isTransientSendFailure(null, "socket hang up"), true);
    assert.equal(isTransientSendFailure("opted_out", null), false);
    assert.equal(isTransientSendFailure("daily_cap", null), false);
  });

  test("terminal skips map onto a visible cancel reason, retryable ones do not", () => {
    assert.equal(terminalSkipReason("opted_out"), "opted_out");
    assert.equal(terminalSkipReason("duplicate"), "already_instructed");
    assert.equal(terminalSkipReason("recent_duplicate"), "already_instructed");
    assert.equal(terminalSkipReason("no_dlt_id"), "template_inactive");
    assert.equal(terminalSkipReason("send_failed"), null);
  });

  test("the dedupe key is stable for one attempt of one job", () => {
    const l = line({ no: 2 });
    const a = followUpDedupeKey(job(l));
    assert.equal(a, followUpDedupeKey(job(l)));
    assert.ok(a.includes("enr-1"));
    assert.ok(a.includes(":2:"));
    // A genuinely different queued follow-up gets a different key.
    assert.notEqual(a, followUpDedupeKey(job(l, { id: "job-2" })));
  });

  test("a RETRY gets a fresh key, or the failed attempt's log would block it forever", () => {
    // sendSms inserts the log before calling the gateway, under a unique index on
    // dedupe_key. Reusing one key per row meant attempt 2 collided with attempt
    // 1's FAILED log and was reported as "already sent" — a message that never
    // went out, recorded as if it had.
    const l = line({ no: 2 });
    const first = followUpDedupeKey(job(l, { attempts: 1 }));
    const second = followUpDedupeKey(job(l, { attempts: 2 }));
    assert.notEqual(first, second);
    assert.ok(second.endsWith(":a2"));
  });
});
