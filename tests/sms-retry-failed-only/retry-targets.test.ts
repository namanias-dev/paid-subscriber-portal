/**
 * "Retry failed only" must be incapable of reaching a recipient who already got
 * the message. These tests reconstruct the real 21:47 UTC campaign that exposed
 * the bug — 86 recipients, 76 delivered, 10 failed, every one of them carrying a
 * prior reminder, well over 30 minutes elapsed — and pin the target set at 10.
 *
 * Before the fix that scenario resolved to 86, because the target list came from
 * the review screen's session state rather than from the log.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveRetryTargets, retryTargetsAreDisjoint, type RetryCandidateLog } from "../../lib/sms/retryTargets";

const TEMPLATE = "installment_reminder";
const BASE = Date.parse("2026-07-27T21:47:02Z");

function log(over: Partial<RetryCandidateLog> & { status: string; enrollment?: string }): RetryCandidateLog {
  const { enrollment, ...rest } = over;
  return {
    template_id: TEMPLATE,
    course_enrollment_id: enrollment ?? "enr-1",
    installment_no: 2,
    created_at: new Date(BASE).toISOString(),
    sent_at: new Date(BASE).toISOString(),
    ...rest,
  };
}

/** The batch as production actually recorded it. */
function theRealCampaign(): RetryCandidateLog[] {
  const rows: RetryCandidateLog[] = [];
  for (let i = 0; i < 76; i++) rows.push(log({ status: "DELIVERED", enrollment: `delivered-${i}` }));
  for (let i = 0; i < 10; i++) rows.push(log({ status: "FAILED", enrollment: `failed-${i}` }));
  return rows;
}

describe("the campaign that exposed the bug", () => {
  const campaign = theRealCampaign();

  test("the fixture matches what production logged: 86 rows, 76 delivered, 10 failed", () => {
    assert.equal(campaign.length, 86);
    assert.equal(campaign.filter((r) => r.status === "DELIVERED").length, 76);
    assert.equal(campaign.filter((r) => r.status === "FAILED").length, 10);
  });

  test("the retry resolves to EXACTLY 10 targets, not 86", () => {
    const t = resolveRetryTargets(campaign, { templateId: TEMPLATE });
    assert.equal(t.enrollmentIds.length, 10, "a retry of this campaign must address ten people");
    assert.equal(t.reachedEnrollmentIds.length, 76);
  });

  test("every target is one of the failures, and no delivered recipient is among them", () => {
    const t = resolveRetryTargets(campaign, { templateId: TEMPLATE });
    for (const id of t.enrollmentIds) assert.ok(id.startsWith("failed-"), `${id} was not a failure`);
    assert.ok(!t.enrollmentIds.some((id) => id.startsWith("delivered-")));
    assert.ok(retryTargetsAreDisjoint(t));
  });

  test("elapsed time and prior reminders do not widen the target set", () => {
    // The old client widened it via `allowRepeat: sendableRows.some(p => p.lastSentAt)`.
    // Nothing about when the campaign ran, or what came before it, is an input here:
    // the resolver is a pure function of the campaign's own rows.
    const later = campaign.map((r) => ({ ...r, created_at: new Date(BASE - 9 * 3600_000).toISOString() }));
    const t = resolveRetryTargets(later, { templateId: TEMPLATE });
    assert.equal(t.enrollmentIds.length, 10);
  });
});

describe("reaching a delivered recipient is structurally impossible", () => {
  test("a success anywhere in the campaign removes that recipient, even if a later attempt failed", () => {
    const rows = [
      log({ status: "DELIVERED", enrollment: "both", created_at: new Date(BASE).toISOString() }),
      log({ status: "FAILED", enrollment: "both", created_at: new Date(BASE + 60_000).toISOString() }),
    ];
    const t = resolveRetryTargets(rows, { templateId: TEMPLATE });
    assert.deepEqual(t.enrollmentIds, [], "they already have the message; a later failure does not undo that");
    assert.equal(t.skipped.delivered_elsewhere_in_campaign, 1);
  });

  test("log order cannot change the answer", () => {
    const a = [log({ status: "FAILED", enrollment: "x" }), log({ status: "SENT", enrollment: "x" })];
    const b = [log({ status: "SENT", enrollment: "x" }), log({ status: "FAILED", enrollment: "x" })];
    assert.deepEqual(resolveRetryTargets(a).enrollmentIds, resolveRetryTargets(b).enrollmentIds);
    assert.deepEqual(resolveRetryTargets(a).enrollmentIds, []);
  });

  test("QUEUED counts as reached — an unresolved send may still arrive", () => {
    const rows = [log({ status: "QUEUED", enrollment: "q" }), log({ status: "FAILED", enrollment: "q" })];
    assert.deepEqual(resolveRetryTargets(rows).enrollmentIds, []);
  });

  test("the two sets are disjoint for every mixture of statuses", () => {
    const statuses = ["DELIVERED", "SENT", "QUEUED", "FAILED", "PENDING", "REJECTED"];
    for (const a of statuses) {
      for (const b of statuses) {
        const t = resolveRetryTargets([
          log({ status: a, enrollment: "same" }),
          log({ status: b, enrollment: "same" }),
        ]);
        assert.ok(retryTargetsAreDisjoint(t), `${a} + ${b} produced an overlapping target set`);
        const reached = new Set(t.reachedEnrollmentIds);
        for (const id of t.enrollmentIds) assert.ok(!reached.has(id), `${a} + ${b} let a reached recipient through`);
      }
    }
  });
});

describe("what a retry refuses to guess about", () => {
  test("a log with no attribution key is skipped, never re-sent blind", () => {
    const t = resolveRetryTargets([log({ status: "FAILED", course_enrollment_id: null })]);
    assert.deepEqual(t.enrollmentIds, []);
    assert.equal(t.skipped.no_attribution_key, 1);
  });

  test("another template's logs in the same campaign are ignored", () => {
    const t = resolveRetryTargets(
      [log({ status: "FAILED", enrollment: "a", template_id: "installment_instructions" })],
      { templateId: TEMPLATE },
    );
    assert.deepEqual(t.enrollmentIds, []);
    assert.equal(t.skipped.other_template, 1);
  });

  test("a status that is neither reached nor failed is counted, not assumed", () => {
    const t = resolveRetryTargets([log({ status: "REJECTED", enrollment: "r" })]);
    assert.deepEqual(t.enrollmentIds, []);
    assert.equal(t.skipped.status_rejected, 1);
  });

  test("an all-delivered campaign yields nothing to retry", () => {
    const rows = Array.from({ length: 12 }, (_, i) => log({ status: "DELIVERED", enrollment: `d-${i}` }));
    assert.deepEqual(resolveRetryTargets(rows).enrollmentIds, []);
  });

  test("duplicate failures for one recipient collapse to a single target", () => {
    const rows = [
      log({ status: "FAILED", enrollment: "dup" }),
      log({ status: "FAILED", enrollment: "dup", created_at: new Date(BASE + 1000).toISOString() }),
    ];
    assert.deepEqual(resolveRetryTargets(rows).enrollmentIds, ["dup"]);
  });
});

describe("the disjointness assertion the route relies on", () => {
  test("it rejects a hand-built overlapping set", () => {
    assert.equal(
      retryTargetsAreDisjoint({ enrollmentIds: ["a", "b"], reachedEnrollmentIds: ["b"], skipped: {} }),
      false,
      "if this ever passes, the route's last line of defence is gone",
    );
  });

  test("it accepts a clean set", () => {
    assert.ok(retryTargetsAreDisjoint({ enrollmentIds: ["a"], reachedEnrollmentIds: ["b"], skipped: {} }));
  });
});
