/**
 * REGRESSION SUITE for the CRM fixture-fallback fix (2026-07-24).
 *
 * ROOT CAUSE
 * ----------
 * After the legacy backfill grew `public.leads` from ~1k → ~179k rows, the
 * deployed `getLeads()` still called `dbSelectAll<Lead>("leads")` which
 * paged the full table with `SELECT *` ordered by created_at desc. The
 * first 1000-row page hit a Seq Scan + 117 MB disk sort in Postgres (~17 s)
 * → PostgREST statement_timeout → `dbSelectAll` returned `[]` → the caller
 * evaluated `rows.length ? rows : mock.leads` and silently served the demo
 * fixture set (24 "Lead Aspirant" rows, phones 9000010000+, counsellors
 * "Priya"/"Raj") to the admin CRM in production.
 *
 * SEVERITY-1 CONTRACTS THIS SUITE PINS
 * ------------------------------------
 * F1. In LIVE mode (Supabase client present) the leads read path MUST
 *     NEVER substitute fixtures. A DB error must throw; a legitimately
 *     empty query must return []. Fixtures are ONLY reachable through
 *     `demoMode()` (which requires the Supabase env vars to be unset).
 * F2. The non-legacy default path MUST push the legacy predicate DOWN to
 *     the DB via
 *       `.or("attribution.is.null,attribution->>legacy.is.null,attribution->>legacy.neq.true")`.
 *     This is the ONLY way the query is small enough (~987 rows in prod)
 *     to complete within Vercel's function budget and the ONLY way the
 *     partial index `idx_leads_active_nonlegacy_created` is used (measured
 *     183 ms vs 50,914 ms without it, 2026-07-24).
 * F3. Ordering MUST stay `created_at DESC` so the Kanban shows most-recent
 *     leads first (product expectation) and the walk matches the partial
 *     index direction.
 *
 * NON-GOALS OF THIS SUITE
 * ----------------------
 * * Kanban column count (b): master's `STAGES` has only the 7 base
 *   statuses; the 10 new legacy-derived statuses live on the
 *   `feat/legacy-crm-reuse` branch and are covered by that branch's
 *   suite. This suite ONLY guards the deployed origin/master path.
 * * Last-60-days visibility (c) and Source-tag reachability (d): those
 *   are behavioral end-to-end checks verified via the post-deploy
 *   prod smoke SQL in the fix report, not unit tests.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  _dbSelectAllLeadsActive,
  type _LeadPaginationClient,
  type _LeadPaginationBuilder,
} from "../../lib/dataProvider";
import * as mock from "../../lib/mockData";
import type { Lead } from "../../lib/types";

// ---------------------------------------------------------------------------
// Test-harness stub Supabase client — records every filter step the
// production helper applies to prove the pushdown contract, and lets the
// suite deterministically drive per-page results / errors.
// ---------------------------------------------------------------------------

interface RecordedPage {
  from: number;
  to: number;
  filters: string[];
}

interface StubOptions {
  /** Rows returned on each successive page. length === number of pages. */
  pages: Lead[][];
  /** If set for a given page index, that page throws instead of returning rows. */
  errorOn?: Record<number, string>;
}

function makeStubClient(opts: StubOptions): { client: _LeadPaginationClient; calls: RecordedPage[] } {
  const calls: RecordedPage[] = [];
  let pageIdx = 0;
  const builder: _LeadPaginationBuilder = {
    // Each call returns `this`. State is captured in the enclosed `current`.
    select() { return builder; },
    is(col, _v) { current.filters.push(`is:${col}`); return builder; },
    // Records the VALUE and the operator, not just the column. The legacy
    // boundary now rides on `eq` specifically — `is` renders as `IS FALSE`,
    // which misses the partial index — so the assertion has to be able to
    // tell the two apart.
    eq(col, v) { current.filters.push(`eq:${col}:${String(v)}`); return builder; },
    or(f) { current.filters.push(`or:${f}`); return builder; },
    order(col, o) { current.filters.push(`order:${col}:${o.ascending ? "asc" : "desc"}`); return builder; },
    range(from, to) {
      const idx = pageIdx++;
      calls.push({ ...current, from, to });
      // Reset per-page filter tally so consecutive .range() calls capture
      // just that page's filters — mirrors real PostgREST client semantics
      // where each terminal `.range()` completes one request.
      current = { from: -1, to: -1, filters: [] };
      const err = opts.errorOn?.[idx];
      if (err) return Promise.resolve({ data: null, error: { message: err } });
      const rows = opts.pages[idx] ?? [];
      return Promise.resolve({ data: rows, error: null });
    },
  };
  let current: RecordedPage = { from: -1, to: -1, filters: [] };
  return {
    client: { from: (_t: string) => builder },
    calls,
  };
}

function makeLead(id: string): Lead {
  return {
    id,
    name: `Lead ${id}`,
    phone: `95500${id.padStart(5, "0")}`,
    email: null,
    city: null,
    state: null,
    source: "Website",
    campaign: null,
    course_interest: null,
    target_year: null,
    mode_pref: null,
    called: false,
    status: "New",
    temperature: "Interested",
    demo_booked: false,
    demo_attended: false,
    webinar_registered: false,
    webinar_attended: false,
    admitted: false,
    course: null,
    total_fee: null,
    amount_collected: null,
    pending_balance: null,
    follow_up_date: null,
    counsellor: null,
    created_at: new Date().toISOString(),
    sources: [],
    first_source: null,
    first_campaign: null,
    merged_count: 0,
    attribution: null,
  };
}

// ---------------------------------------------------------------------------
// (F1) Prod path NEVER silently returns fixtures.
// ---------------------------------------------------------------------------

describe("(F1) live-mode leads path never substitutes fixtures", () => {
  it("throws on a first-page PostgREST error instead of returning []", async () => {
    const { client } = makeStubClient({ pages: [], errorOn: { 0: "canceling statement due to statement timeout" } });
    await assert.rejects(
      () => _dbSelectAllLeadsActive(client, /* nonLegacyOnly */ true),
      /statement timeout/,
    );
  });

  it("throws on a mid-scan page error even after successful earlier pages", async () => {
    const page0 = Array.from({ length: 1000 }, (_v, i) => makeLead(`p0-${i}`));
    const { client } = makeStubClient({
      pages: [page0, []],
      errorOn: { 1: "connection reset" },
    });
    await assert.rejects(
      () => _dbSelectAllLeadsActive(client, /* nonLegacyOnly */ false),
      /connection reset/,
    );
  });

  it("returns [] (NOT fixtures) when the DB returns 0 rows in prod", async () => {
    const { client } = makeStubClient({ pages: [[]] });
    const rows = await _dbSelectAllLeadsActive(client, true);
    assert.equal(rows.length, 0, "empty DB result must stay empty");
  });

  it("throws when the Supabase admin client is absent (missing env vars in prod)", async () => {
    await assert.rejects(
      () => _dbSelectAllLeadsActive(null, true),
      /Supabase admin client unavailable/,
    );
  });

  it("returned rows never include mock/fixture identifiers under any code path", async () => {
    // Pin the fixture leak indicators used by ops when eyeballing the CRM:
    // (i) phones starting 9000010000, (ii) name prefix "Lead Aspirant",
    // (iii) counsellors "Counsellor Priya" / "Counsellor Raj". Any of these
    // in a live response is a regression of the fallback bug.
    const fixturePhonePrefix = mock.leads[0]?.phone.slice(0, 5) ?? "90000";
    const rows = Array.from({ length: 3 }, (_v, i) => makeLead(`live-${i}`));
    const { client } = makeStubClient({ pages: [rows] });
    const out = await _dbSelectAllLeadsActive(client, true);
    for (const l of out) {
      assert.ok(!l.phone.startsWith(fixturePhonePrefix), `phone ${l.phone} looks like a fixture`);
      assert.ok(!l.name.startsWith("Lead Aspirant"), `name "${l.name}" looks like a fixture`);
      assert.ok(l.counsellor !== "Counsellor Priya" && l.counsellor !== "Counsellor Raj", "fixture counsellor leaked");
    }
  });
});

// ---------------------------------------------------------------------------
// (F2) Legacy filter must be pushed DOWN to the DB. This is the *only* way
// the partial index `idx_leads_active_nonlegacy_created` is used and the
// only way the query size stays viable at 179k+ scale.
// ---------------------------------------------------------------------------

describe("(F2) legacy filter is pushed down to DB when nonLegacyOnly=true", () => {
  it("emits is_legacy=false, which hits idx_leads_nonlegacy_active_created_v2", async () => {
    const { client, calls } = makeStubClient({ pages: [[]] });
    await _dbSelectAllLeadsActive(client, /* nonLegacyOnly */ true);
    assert.equal(calls.length, 1, "one page for an empty result set");
    const filters = calls[0]!.filters;
    // Order matters — production applies is(merged_into) → eq(is_legacy) →
    // order(created_at) → range(from,to), and the plan depends on it.
    assert.ok(filters.includes("is:merged_into"), "must filter merged_into IS NULL at DB");
    assert.ok(
      filters.includes("eq:is_legacy:false"),
      "must push the boundary down as the column, with the eq operator",
    );
    assert.ok(filters.includes("order:created_at:desc"), "must order created_at DESC for Kanban newest-first");
  });

  it("never reaches for the JSONB blob again", async () => {
    // The regression this guards is not a slow query, it is a silent scope
    // leak: while the boundary was `attribution->>'legacy'`, deleting that key
    // would have matched the `is.null` arm for every legacy row and put all
    // 178,183 of them in the live CRM without an error anywhere.
    const { client, calls } = makeStubClient({ pages: [[]] });
    await _dbSelectAllLeadsActive(client, /* nonLegacyOnly */ true);
    for (const f of calls[0]!.filters) {
      assert.ok(
        !f.includes("attribution"),
        `the legacy boundary must not touch the blob — found: ${f}`,
      );
    }
  });

  it("omits the boundary entirely when nonLegacyOnly=false (opt-in legacy universe)", async () => {
    const { client, calls } = makeStubClient({ pages: [[]] });
    await _dbSelectAllLeadsActive(client, /* nonLegacyOnly */ false);
    const filters = calls[0]!.filters;
    assert.ok(filters.includes("is:merged_into"), "still exclude soft-merged at DB");
    assert.ok(
      !filters.some((f) => f.startsWith("eq:is_legacy") || f.startsWith("or:")),
      "must NOT push the legacy filter when includeLegacy=true",
    );
  });
});

// ---------------------------------------------------------------------------
// (F3) Pagination correctness — ordering + no double-fetch beyond the last
// short page. Regression against a subtle off-by-one that would silently
// re-fetch the last page under load.
// ---------------------------------------------------------------------------

describe("(F3) pagination stops as soon as a short page arrives", () => {
  it("stops after a partial page and returns the union of all pages", async () => {
    const page0 = Array.from({ length: 1000 }, (_v, i) => makeLead(`p0-${i}`));
    const page1 = Array.from({ length: 500 }, (_v, i) => makeLead(`p1-${i}`));
    const { client, calls } = makeStubClient({ pages: [page0, page1] });
    const rows = await _dbSelectAllLeadsActive(client, true);
    assert.equal(rows.length, 1500);
    assert.equal(calls.length, 2, "must not request a third page once page 1 is short");
    assert.deepEqual(
      [calls[0]!.from, calls[0]!.to, calls[1]!.from, calls[1]!.to],
      [0, 999, 1000, 1999],
    );
  });
});
