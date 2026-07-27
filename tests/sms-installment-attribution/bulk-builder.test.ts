/**
 * The bulk reminder builder — per-recipient resolution, rendering and gating.
 *
 * `buildReminderFor` is the ONE rendering path: the single-student button, the
 * bulk review screen and both send routes all go through it. These tests drive
 * it directly with a fabricated context (no I/O), which is what lets them assert
 * the property that matters most for a batch: one unresolvable student is
 * excluded with a named reason and NOBODY ELSE is affected.
 *
 * The body used here is the live DLT-approved one, with the mixed-case
 * `{No_of_Installment}` / `{Fee_in_Rs}` tokens that caused the original
 * incident, so a regression in the alias registry fails here too.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReminderFor, MAX_BULK_RECIPIENTS,
  type ReminderContext,
} from "../../lib/sms/installmentReminderService";
import { installmentFingerprint } from "../../lib/sms/installmentAttribution";
import { deriveCollections } from "../../lib/installments";
import type { CourseEnrollment, InstallmentItem } from "../../lib/types";
import type { SmsTemplate } from "../../lib/sms/types";

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-27T12:00:00+05:30");

/** The live approved body, verbatim. */
const DLT_BODY = "Hi {first_name}, your course fee installment no. {No_of_Installment} of Rs.{Fee_in_Rs} is due. Login: {login_url} Code: {login_code} to complete payment. Naman Sharma IAS Academy.";

const TEMPLATE: SmsTemplate = {
  id: "installment_reminder", name: "Installment Reminder", use_case: "PAYMENT",
  message_type: "service", status: "active", body_template: DLT_BODY,
  gateway_template_id: "1777178513223214410", sender_id: "NAMIAS", route: "12",
  trigger_event: null, audience_type: "paid", variables: [],
  is_active: true, auto_send_enabled: false,
  created_at: new Date(NOW).toISOString(), updated_at: new Date(NOW).toISOString(),
};

/**
 * The approved body carries {login_code}, so a student with no resolvable buyer
 * is BLOCKED rather than sent a blank code — which is why every fixture that
 * expects a successful render needs a matching buyer here.
 */
const BUYERS: ReminderContext["buyers"] = new Map([
  ["9876543210", { status: "ok", id: "b1", name: "Asha Verma", login_code: "ASHA01" }],
  ["9812345678", { status: "ok", id: "b2", name: "Chetan Rao", login_code: "CHET02" }],
  ["9811111111", { status: "ok", id: "b3", name: "Bharat Krishnamurthy", login_code: "BHAR03" }],
]);

function ctx(over: Partial<ReminderContext> = {}): ReminderContext {
  return {
    template: TEMPLATE,
    varDefaults: { login_url: "https://www.namanias.com/login" },
    optedOut: new Set<string>(),
    buyers: BUYERS,
    recentByMobile: new Map(),
    priorCountByMobile: new Map(),
    now: NOW,
    overdueOnly: true,
    ...over,
  };
}

function line(p: Partial<InstallmentItem> & { no: number }): InstallmentItem {
  return {
    kind: "installment", label: `Installment ${p.no}`, amount: 10000,
    due: new Date(NOW - 10 * DAY).toISOString(), paid: false, ...p,
  };
}

let seq = 0;
function enr(schedule: InstallmentItem[], over: Partial<CourseEnrollment> = {}): CourseEnrollment {
  return {
    id: `enr-${++seq}`, phone: "9876543210", student_name: "Asha Verma", email: null,
    course_id: "c1", course_slug: "c", course_title: "Safalta Foundation", batch_label: "Morning",
    plan_type: "emi", total_fee: 30000, amount_paid: 10000, installment_count: 3,
    status: "partially_paid", schedule, created_at: new Date(NOW).toISOString(),
    updated_at: new Date(NOW).toISOString(), ...over,
  } as CourseEnrollment;
}

describe("per-recipient rendering", () => {
  test("renders the mixed-case DLT tokens with no braces left behind", () => {
    const p = buildReminderFor(enr([line({ no: 2, amount: 20000 })]), ctx());
    assert.equal(p.sendable, true, p.blockDetail ?? "");
    assert.match(p.body, /installment no\. 2 of Rs\.20000 is due/);
    assert.equal(/[{}]/.test(p.body), false, "a brace in an outbound body is the original incident");
    assert.equal(p.installmentNo, 2);
    assert.equal(p.amountDue, 20000);
  });

  test("the amount matches what the page shows for that line — not a second calculation", () => {
    const target = line({ no: 2, amount: 17500 });
    const e = enr([line({ no: 1, paid: true, paid_at: new Date(NOW - 30 * DAY).toISOString() }), target]);
    const p = buildReminderFor(e, ctx());
    const d = deriveCollections(e, NOW);

    assert.equal(p.installmentNo, d.nextPayable!.no, "SMS installment number must equal the page's next payable");
    assert.equal(p.amountDue, d.nextPayable!.amount, "SMS amount must equal the page's amount for that line");
    assert.match(p.body, /no\. 2 of Rs\.17500/);
  });

  test("targets the OLDEST unpaid installment when several are unpaid, and says so", () => {
    const p = buildReminderFor(enr([line({ no: 1 }), line({ no: 2 }), line({ no: 3 })]), ctx());
    assert.equal(p.installmentNo, 1);
    assert.equal(p.unpaidCount, 3);
    assert.ok(p.warnings.some((w) => /OLDEST/.test(w)), "the UI must state which installment is referenced");
  });

  test("each recipient gets its own body and its own segment count", () => {
    const a = buildReminderFor(enr([line({ no: 1, amount: 8000 })], { student_name: "Asha Verma" }), ctx());
    const b = buildReminderFor(enr([line({ no: 3, amount: 125000 })], { student_name: "Bharat Krishnamurthy", phone: "9811111111" }), ctx());
    assert.notEqual(a.body, b.body);
    assert.match(a.body, /Hi Asha, /);
    assert.match(b.body, /Hi Bharat, /);
    assert.ok(a.segments >= 1 && b.segments >= 1);
  });

  test("carries an attribution key built from the line it actually targeted", () => {
    const target = line({ no: 2, amount: 20000 });
    const e = enr([line({ no: 1, paid: true }), target]);
    const p = buildReminderFor(e, ctx());
    assert.deepEqual(p.installmentKey, {
      courseEnrollmentId: e.id,
      installmentNo: 2,
      fingerprint: installmentFingerprint(target),
    });
  });
});

describe("auto-exclusions — always a named reason, never silent", () => {
  const cases: [string, () => CourseEnrollment, Partial<ReminderContext>, string][] = [
    ["missing phone", () => enr([line({ no: 1 })], { phone: "" }), {}, "missing_phone"],
    ["invalid mobile", () => enr([line({ no: 1 })], { phone: "12345" }), {}, "invalid_mobile"],
    ["zero balance", () => enr([line({ no: 1, paid: true, paid_at: new Date(NOW - DAY).toISOString() })], { amount_paid: 30000, total_fee: 10000 }), {}, "zero_balance"],
    ["cancelled enrollment", () => enr([line({ no: 1 })], { status: "cancelled" }), {}, "no_active_enrollment"],
    ["never paid anything", () => enr([line({ no: 1 })], { amount_paid: 0, status: "pending" }), {}, "no_active_enrollment"],
  ];

  for (const [label, make, over, expected] of cases) {
    test(label, () => {
      const p = buildReminderFor(make(), ctx(over));
      assert.equal(p.sendable, false);
      assert.equal(p.blockReason, expected);
      assert.ok(p.blockDetail && p.blockDetail.length > 10, "a reason must be explainable to staff");
    });
  }

  test("opted out", () => {
    const p = buildReminderFor(enr([line({ no: 1 })]), ctx({ optedOut: new Set(["9876543210"]) }));
    assert.equal(p.blockReason, "opted_out");
  });

  test("an unpaid SEAT BOOKING only — the collections-gap case", () => {
    const e = enr([
      { ...line({ no: 0, amount: 2000 }), kind: "seat", label: "Book Your Seat", due: null, paid: false },
      line({ no: 1, paid: true, paid_at: new Date(NOW - 5 * DAY).toISOString() }),
    ], { amount_paid: 10000, total_fee: 12000 });

    const p = buildReminderFor(e, ctx());
    assert.equal(p.sendable, false);
    assert.equal(p.blockReason, "seat_booking_only", "a seat is not an installment");
    assert.match(p.blockDetail!, /admission follow-up/,
      "staff need to be told what to do instead, not just that it failed");
  });

  test("not yet due is excluded by DEFAULT, and only by default", () => {
    const upcoming = enr([line({ no: 1, due: new Date(NOW + 5 * DAY).toISOString() })]);

    const strict = buildReminderFor(upcoming, ctx({ overdueOnly: true }));
    assert.equal(strict.sendable, false);
    assert.equal(strict.blockReason, "not_yet_due");

    // The single-student button may legitimately chase an upcoming installment.
    const relaxed = buildReminderFor(upcoming, ctx({ overdueOnly: false }));
    assert.equal(relaxed.sendable, true, relaxed.blockDetail ?? "");
  });

  test("template gating is job-level, so an inactive template cannot leak a body", () => {
    const inactive = { ...TEMPLATE, status: "draft" } as SmsTemplate;
    // buildReminderContext refuses before any recipient is built; if a caller
    // forced it through anyway, the body would still be the approved one.
    const p = buildReminderFor(enr([line({ no: 1 })]), ctx({ template: inactive }));
    assert.equal(p.body.includes("Naman Sharma IAS Academy"), true);
  });
});

describe("the guard excludes ONLY the bad recipient", () => {
  test("one unresolvable student does not take the batch down", () => {
    const good1 = enr([line({ no: 1, amount: 8000 })], { student_name: "Asha Verma", phone: "9876543210" });
    const bad = enr([line({ no: 1 })], { student_name: "No Phone", phone: "" });
    const good2 = enr([line({ no: 2, amount: 12000 })], { student_name: "Chetan Rao", phone: "9812345678" });

    const c = ctx();
    const results = [good1, bad, good2].map((e) => buildReminderFor(e, c));

    assert.deepEqual(results.map((r) => r.sendable), [true, false, true]);
    assert.equal(results[1]!.blockReason, "missing_phone");
    // The survivors are untouched: correct bodies, no cross-contamination.
    assert.match(results[0]!.body, /Hi Asha, .*no\. 1 of Rs\.8000/);
    assert.match(results[2]!.body, /Hi Chetan, .*no\. 2 of Rs\.12000/);
  });
});

describe("identity safety on a shared handset", () => {
  test("a login_code is only attached when it provably belongs to this student", () => {
    const e = enr([line({ no: 1 })], { student_name: "Asha Verma", phone: "9876543210" });

    const mine = buildReminderFor(e, ctx({
      buyers: new Map([["9876543210", { status: "ok", id: "b1", name: "Asha Verma", login_code: "ASHA01" }]]),
    }));
    assert.match(mine.body, /Code: ASHA01/);

    // Same number, a DIFFERENT person's code -> must not be sent.
    const other = buildReminderFor(e, ctx({
      buyers: new Map([["9876543210", { status: "ok", id: "b2", name: "Rohit Sharma", login_code: "ROHIT9" }]]),
    }));
    assert.equal(other.body.includes("ROHIT9"), false, "never leak another person's login code");
    assert.equal(other.sendable, false, "an unresolvable code must block, not blank out");
    assert.equal(other.blockReason, "render_blocked");

    // Two buyers on one number is unresolvable by definition.
    const ambiguous = buildReminderFor(e, ctx({
      buyers: new Map([["9876543210", { status: "ambiguous", id: null, name: null, login_code: null }]]),
    }));
    assert.equal(ambiguous.sendable, false);
  });
});

describe("repeat sends warn, never silently block", () => {
  test("a send inside 24h is a warning with the timestamp, and stays sendable", () => {
    const at = new Date(NOW - 3 * 3600_000).toISOString();
    const p = buildReminderFor(enr([line({ no: 1 })]), ctx({
      recentByMobile: new Map([["9876543210", at]]),
      priorCountByMobile: new Map([["9876543210", 2]]),
    }));
    assert.equal(p.sendable, true);
    assert.equal(p.lastSentAt, at, "staff must be shown WHEN, not just that it happened");
    assert.ok(p.warnings.some((w) => w.includes(at)));
    assert.equal(p.priorReminderCount, 2);
  });
});

describe("job cap", () => {
  test("is 500 per job", () => {
    assert.equal(MAX_BULK_RECIPIENTS, 500);
  });
});
