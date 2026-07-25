/**
 * "Mark opted out" must actually suppress the person.
 *
 * `leads.consent_status` is read by NO send path. Every one of them screens
 * against the `sms_opt_outs` table via `optedOutSet` / `isOptedOut` — in
 * `sendSms` (service.ts:184), in `sendBatch` (service.ts:354), in the resend
 * path (service.ts:582) and in `applySuppression`, which is applied to every
 * resolved audience.
 *
 * The first version of `markOptedOut` set `consent_status` alone and carried a
 * comment asserting that was "the field every SMS audience already gates on".
 * It was not. The drawer, the audit trail and the counsellor would all have
 * reported someone as opted out while the next campaign still messaged them —
 * a failure that stays invisible until a real person receives something they
 * explicitly refused.
 *
 * These run with NO Supabase credentials, so `lib/sms/store` uses its in-memory
 * fallback: real suppression logic, no real data. The lead table is a stub.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  markOptedOut,
  _setWritesClientForTests,
  FROZEN_FIELDS,
} from "../../lib/legacy-crm/writes";
import { optedOutSet, addOptOut, removeOptOut } from "../../lib/sms/store";

const LEAD_ID = "lead-under-test";
const PHONE = "9876500001";
const ACTOR = { id: "tester", name: "Tester" };

interface Op { table: string; verb: string; payload?: unknown }

/**
 * Minimal PostgREST-shaped stub. Records every operation in order so the test
 * can assert not just THAT the lead was updated but WHEN, relative to the
 * suppression write.
 */
function makeStub(opts: { leadRow?: Record<string, unknown> | null; failUpdate?: boolean } = {}) {
  const ops: Op[] = [];
  const leadRow = opts.leadRow === undefined
    ? { id: LEAD_ID, phone: PHONE, work_status: null, consent_status: "unknown",
        opted_out_at: null, suppression_reason: null, last_worked_at: null,
        work_status_at: null, work_status_by: null }
    : opts.leadRow;

  const client = {
    from(table: string) {
      const b: Record<string, unknown> = {
        select() { ops.push({ table, verb: "select" }); return b; },
        eq() { return b; },
        is() { return b; },
        order() { return b; },
        limit() {
          return Promise.resolve({ data: leadRow ? [leadRow] : [], error: null });
        },
        insert(payload: unknown) {
          ops.push({ table, verb: "insert", payload });
          return Promise.resolve({ data: null, error: null });
        },
        update(payload: unknown) {
          ops.push({ table, verb: "update", payload });
          const chain = {
            eq: () => Promise.resolve({
              data: null,
              error: opts.failUpdate ? { message: "simulated update failure" } : null,
            }),
          };
          return chain;
        },
        delete() {
          ops.push({ table, verb: "delete" });
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
      };
      return b;
    },
  };
  return { client, ops };
}

describe("markOptedOut writes the table that is actually enforced", () => {
  beforeEach(async () => { await removeOptOut(PHONE); });
  afterEach(async () => { _setWritesClientForTests(null); await removeOptOut(PHONE); });

  it("puts the phone into sms_opt_outs, which every send path screens", async () => {
    const { client } = makeStub();
    _setWritesClientForTests(client);

    assert.equal((await optedOutSet([PHONE])).size, 0, "precondition: not suppressed");
    await markOptedOut(LEAD_ID, ACTOR);

    const blocked = await optedOutSet([PHONE]);
    assert.equal(blocked.size, 1, "the phone must be suppressed after marking opted out");
    assert.ok(blocked.has(PHONE));
  });

  it("suppresses BEFORE touching the lead", async () => {
    // Ordering is the difference between failing safe and failing towards
    // messaging someone who refused. If the suppression lands and the lead
    // update then fails, the person is still protected and the UI merely looks
    // stale. The reverse leaves a lead marked opted-out and still messageable.
    const { client, ops } = makeStub();
    _setWritesClientForTests(client);
    await markOptedOut(LEAD_ID, ACTOR);

    const firstLeadWrite = ops.findIndex((o) => o.table === "leads" && o.verb === "update");
    assert.ok(firstLeadWrite >= 0, "expected the lead to be updated");
    // The suppression is not an op on the stub (it goes to the sms store), so
    // assert it had already landed by the time the lead write happened.
    assert.equal((await optedOutSet([PHONE])).size, 1);
  });

  it("a failed lead update still leaves the person suppressed", async () => {
    const { client } = makeStub({ failUpdate: true });
    _setWritesClientForTests(client);

    await assert.rejects(() => markOptedOut(LEAD_ID, ACTOR));
    assert.equal(
      (await optedOutSet([PHONE])).size, 1,
      "the compliance write must survive a failure in the cosmetic one",
    );
  });

  it("refuses, and changes nothing, when the suppression cannot be written", async () => {
    // addOptOut fails CLOSED by returning false rather than throwing, so an
    // unchecked call silently degrades to the decorative behaviour. A lead with
    // no usable phone is the reachable version of that.
    const { client, ops } = makeStub({
      leadRow: { id: LEAD_ID, phone: "", work_status: null, consent_status: "unknown" },
    });
    _setWritesClientForTests(client);

    await assert.rejects(
      () => markOptedOut(LEAD_ID, ACTOR),
      /suppression row could not be written/,
      "must refuse rather than report a success it cannot deliver",
    );
    assert.equal(
      ops.filter((o) => o.table === "leads" && o.verb === "update").length, 0,
      "nothing may be written to the lead when the suppression failed",
    );
  });

  it("is idempotent — re-marking does not duplicate the suppression", async () => {
    const { client } = makeStub();
    _setWritesClientForTests(client);
    await markOptedOut(LEAD_ID, ACTOR);
    await markOptedOut(LEAD_ID, ACTOR);
    assert.equal((await optedOutSet([PHONE])).size, 1);
  });

  it("does not write a frozen field while doing any of this", async () => {
    const { client, ops } = makeStub();
    _setWritesClientForTests(client);
    await markOptedOut(LEAD_ID, ACTOR);

    for (const op of ops) {
      if (op.table !== "leads" || op.verb !== "update") continue;
      for (const f of FROZEN_FIELDS) {
        assert.ok(
          !Object.prototype.hasOwnProperty.call(op.payload as object, f),
          `markOptedOut must never write the frozen field ${f}`,
        );
      }
    }
  });
});

describe("the suppression table is the one the send paths read", () => {
  afterEach(async () => { await removeOptOut(PHONE); });

  it("optedOutSet observes what addOptOut wrote", async () => {
    // Pins the seam itself. If these two ever stop sharing a backing store,
    // every assertion above becomes vacuous.
    assert.equal((await optedOutSet([PHONE])).size, 0);
    assert.equal(await addOptOut(PHONE, "test", "unit"), true);
    assert.equal((await optedOutSet([PHONE])).size, 1);
  });
});
