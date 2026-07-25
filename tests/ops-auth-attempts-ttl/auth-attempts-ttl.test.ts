/**
 * Pins the safety basis of the `auth_attempts` TTL.
 *
 * The retention only holds because it clears the widest `rateLimited()`
 * window in the codebase (careers/apply, 3,600 s). If someone later adds a
 * caller with a day-long window, the guard below is what stops the prune
 * from silently cutting their throttle short.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  pruneAuthAttempts,
  retainHoursAreSafe,
  MIN_RETAIN_HOURS,
  RETAIN_HOURS,
  WIDEST_RATE_LIMIT_WINDOW_SEC,
  type PruneSqlClient,
} from "../../lib/ops/authAttemptsTtl";

function fakeClient(
  impl: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null },
): { client: PruneSqlClient; calls: { fn: string; args: Record<string, unknown> }[] } {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    client: {
      async rpc(fn, args) {
        calls.push({ fn, args });
        return impl(fn, args);
      },
    },
  };
}

describe("retention guard", () => {
  it("accepts the shipped 24 h retention", () => {
    assert.equal(retainHoursAreSafe(RETAIN_HOURS), true);
    assert.ok(RETAIN_HOURS * 3600 > WIDEST_RATE_LIMIT_WINDOW_SEC);
  });

  it("rejects a retention shorter than the widest window", () => {
    // A caller counting 3,600 s back must still find its rows.
    assert.equal(retainHoursAreSafe(1, 7200), false);
  });

  it("rejects anything under the 2 h floor even when the window is tiny", () => {
    assert.equal(retainHoursAreSafe(MIN_RETAIN_HOURS - 1, 60), false);
    assert.equal(retainHoursAreSafe(MIN_RETAIN_HOURS, 60), true);
  });

  it("rejects nonsense input rather than pruning on NaN", () => {
    assert.equal(retainHoursAreSafe(Number.NaN), false);
  });
});

describe("prune", () => {
  it("calls the chunked RPC with the retention and returns the count", async () => {
    const { client, calls } = fakeClient(() => ({ data: 214512, error: null }));
    const r = await pruneAuthAttempts(client, 24);
    assert.deepEqual(r, { ok: true, deleted: 214512 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].fn, "prune_auth_attempts");
    assert.deepEqual(calls[0].args, { p_retain_hours: 24 });
  });

  it("is idempotent — a second sweep finding nothing is still a success", async () => {
    const { client } = fakeClient(() => ({ data: 0, error: null }));
    const r = await pruneAuthAttempts(client, 24);
    assert.equal(r.ok, true);
    assert.equal(r.deleted, 0);
  });

  it("never issues the delete when the retention is unsafe", async () => {
    const { client, calls } = fakeClient(() => ({ data: 999, error: null }));
    const r = await pruneAuthAttempts(client, 0.5);
    assert.equal(r.ok, false);
    assert.equal(r.deleted, 0);
    assert.match(r.error ?? "", /refusing to prune/);
    assert.equal(calls.length, 0, "no RPC may be sent once the guard fails");
  });

  it("reports a DB error instead of claiming a successful prune", async () => {
    const { client } = fakeClient(() => ({ data: null, error: { message: "permission denied" } }));
    const r = await pruneAuthAttempts(client, 24);
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /permission denied/);
  });

  it("no-ops without a client (demo mode / missing service key)", async () => {
    const r = await pruneAuthAttempts(null);
    assert.equal(r.ok, false);
    assert.equal(r.error, "no-db");
  });

  it("coerces a bigint returned as a string", async () => {
    // Supabase serialises bigint as a JSON string.
    const { client } = fakeClient(() => ({ data: "1234", error: null }));
    const r = await pruneAuthAttempts(client, 24);
    assert.equal(r.deleted, 1234);
  });
});
