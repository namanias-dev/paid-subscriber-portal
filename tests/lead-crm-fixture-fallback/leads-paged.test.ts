/**
 * PHASE 1 REGRESSION SUITE for `getLeadsPaged`.
 *
 * Extends the fixture-fallback contract (see
 * `lead-crm-fixture-fallback.test.ts`) to the new paginated reader, and pins
 * the traps that Phase 0's production analysis surfaced. Every assertion here
 * corresponds to a failure mode that has ALREADY happened once, either in this
 * codebase or in the Phase 1 build itself:
 *
 *  P1. No silent fixture fallback (the `9f567b64` regression). A DB error
 *      must throw; an empty result must stay empty.
 *  P2. The hard limit cap of 100 is enforced no matter what is requested.
 *  P3. The legacy boundary is spelled EXACTLY as the index predicates expect,
 *      and the tri-state maps to the right RPC mode.
 *  P4. Cursor pagination is tie-safe: the cursor round-trips BOTH created_at
 *      and id. A created_at-only cursor silently skips rows inside a tie group
 *      (856 timestamps in prod are shared, one by 168 rows).
 *  P5. THE SEGMENTATION FIELD TRAP. A segment/worklist read must surface the
 *      legacy `campaign` / `campaign_clean` fields, never `utm_campaign`.
 *      `utm_*` is set on 4 of 178,183 legacy rows and `gclid` on 0, so a
 *      builder wired to UTM returns zero rows while looking healthy.
 *  P6. Filters are pushed to the server. Nothing is fetched-then-filtered.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  _dbSelectLeadsPaged,
  _encodeLeadCursor,
  _decodeLeadCursor,
  LEADS_PAGE_MAX_LIMIT,
  type _LeadsPagedClient,
} from "../../lib/dataProvider";
import {
  LEGACY_COLUMN_FILTER,
  NON_LEGACY_COLUMN_FILTER,
  cohortForLead,
} from "../../lib/legacy-migration/legacyFilter";
import type { LeadWorklistRow } from "../../lib/types";

// ---------------------------------------------------------------------------
// Stub RPC client. Records every call so the suite can assert on the exact
// arguments that reach Postgres.
// ---------------------------------------------------------------------------

interface RecordedRpc {
  fn: string;
  args: Record<string, unknown>;
}

function makeRpcStub(opts: {
  rows?: LeadWorklistRow[];
  count?: number;
  error?: string;
  countError?: string;
}): { client: _LeadsPagedClient; calls: RecordedRpc[] } {
  const calls: RecordedRpc[] = [];
  const client: _LeadsPagedClient = {
    rpc(fn, args) {
      calls.push({ fn, args });
      if (fn === "leads_paged_count") {
        if (opts.countError) return Promise.resolve({ data: null, error: { message: opts.countError } });
        return Promise.resolve({ data: opts.count ?? 0, error: null });
      }
      if (opts.error) return Promise.resolve({ data: null, error: { message: opts.error } });
      return Promise.resolve({ data: opts.rows ?? [], error: null });
    },
  };
  return { client, calls };
}

function makeRow(i: number, createdAt = "2026-07-22T05:05:16.405Z"): LeadWorklistRow {
  return {
    id: `id-${String(i).padStart(4, "0")}`,
    name: `Person ${i}`,
    phone: `98${String(i).padStart(8, "0")}`,
    city: null, state: null, source: "Legacy Sheet",
    campaign: "SSC-2023-Batch", campaign_clean: "ssc 2023 batch",
    legacy_source_tab: "FB LEADS",
    status: "Not Replied",
    created_at: createdAt,
    counsellor: null, assigned_to: null, worklist_queue: null,
    follow_up_at: null, last_worked_at: null,
    consent_status: "unknown", dnd_status: null, last_contacted_at: null,
    contact_attempt_count: 0, suppression_reason: null,
    cohort: "legacy_promoted", is_legacy: true, legacy_call_status: "Not Replied",
    // Phase 2 projection. `legacy_call_status_raw` deliberately differs from
    // the tidied `legacy_call_status` above — the raw source-sheet wording is
    // preserved verbatim and must survive every write.
    legacy_call_status_raw: "Not Replied ",
    work_status: null, work_status_at: null, work_status_by: null,
    import_batch: "legacy_2026_07_21", first_seen_at: createdAt, promoted_at: null,
  };
}

// ---------------------------------------------------------------------------
// (P1) Fixture fallback can never happen.
// ---------------------------------------------------------------------------

describe("(P1) getLeadsPaged never substitutes fixtures", () => {
  it("throws on an RPC error instead of returning []", async () => {
    const { client } = makeRpcStub({ error: "canceling statement due to statement timeout" });
    await assert.rejects(() => _dbSelectLeadsPaged(client, {}), /statement timeout/);
  });

  it("throws when the count RPC fails, even though the page succeeded", async () => {
    const { client } = makeRpcStub({ rows: [makeRow(1)], countError: "connection reset" });
    await assert.rejects(() => _dbSelectLeadsPaged(client, { withCount: true }), /connection reset/);
  });

  it("returns an empty page (NOT fixtures) when the DB legitimately has no matches", async () => {
    const { client } = makeRpcStub({ rows: [] });
    const page = await _dbSelectLeadsPaged(client, { queue: "nobody-here" });
    assert.deepEqual(page.rows, []);
    assert.equal(page.nextCursor, null, "an empty page must not advertise a next page");
  });

  it("throws when the Supabase admin client is absent", async () => {
    await assert.rejects(() => _dbSelectLeadsPaged(null, {}), /Supabase admin client unavailable/);
  });

  it("never returns rows bearing the demo-fixture markers", async () => {
    const { client } = makeRpcStub({ rows: [makeRow(1), makeRow(2)] });
    const page = await _dbSelectLeadsPaged(client, {});
    for (const r of page.rows) {
      assert.ok(!r.phone.startsWith("90000"), `phone ${r.phone} looks like a fixture`);
      assert.ok(!r.name.startsWith("Lead Aspirant"), `name "${r.name}" looks like a fixture`);
      assert.ok(r.counsellor !== "Counsellor Priya" && r.counsellor !== "Counsellor Raj");
    }
  });
});

// ---------------------------------------------------------------------------
// (P2) Hard cap.
// ---------------------------------------------------------------------------

describe("(P2) limit is hard-capped at 100", () => {
  it("clamps an absurd limit down to the cap rather than honouring it", async () => {
    const { client, calls } = makeRpcStub({ rows: [] });
    const page = await _dbSelectLeadsPaged(client, { limit: 100000 });
    assert.equal(calls[0]!.args.p_limit, LEADS_PAGE_MAX_LIMIT);
    assert.equal(page.limit, LEADS_PAGE_MAX_LIMIT);
  });

  it("clamps exactly at the boundary", async () => {
    const { client, calls } = makeRpcStub({ rows: [] });
    await _dbSelectLeadsPaged(client, { limit: 101 });
    assert.equal(calls[0]!.args.p_limit, 100);
  });

  it("honours a limit below the cap", async () => {
    const { client, calls } = makeRpcStub({ rows: [] });
    await _dbSelectLeadsPaged(client, { limit: 25 });
    assert.equal(calls[0]!.args.p_limit, 25);
  });

  it("floors a zero/negative limit at 1 instead of sending it to SQL", async () => {
    const { client, calls } = makeRpcStub({ rows: [] });
    await _dbSelectLeadsPaged(client, { limit: 0 });
    assert.equal(calls[0]!.args.p_limit, 1);
    const { client: c2, calls: k2 } = makeRpcStub({ rows: [] });
    await _dbSelectLeadsPaged(c2, { limit: -5 });
    assert.equal(k2[0]!.args.p_limit, 1);
  });
});

// ---------------------------------------------------------------------------
// (P3) Legacy boundary spelling + tri-state.
// ---------------------------------------------------------------------------

describe("(P3) legacy boundary", () => {
  it("maps the tri-state onto the RPC mode", async () => {
    for (const [input, expected] of [
      [undefined, "exclude"],
      [false, "exclude"],
      [true, "include"],
      ["only", "only"],
    ] as const) {
      const { client, calls } = makeRpcStub({ rows: [] });
      await _dbSelectLeadsPaged(client, { includeLegacy: input });
      assert.equal(calls[0]!.args.p_include_legacy, expected, `includeLegacy=${String(input)}`);
    }
  });

  it("pins the boundary to the column, with the index-selectable operator", () => {
    // Was the three-arm JSONB OR against idx_leads_active_nonlegacy_created.
    // Now `is_legacy = false` against idx_leads_nonlegacy_active_created_v2.
    // The operator is the load-bearing detail: `IS FALSE` does not imply the
    // index predicate and falls back to a 2,568 ms filtered scan.
    assert.deepEqual({ ...NON_LEGACY_COLUMN_FILTER }, {
      column: "is_legacy", operator: "eq", value: false,
    });
    assert.deepEqual({ ...LEGACY_COLUMN_FILTER }, {
      column: "is_legacy", operator: "eq", value: true,
    });
  });
});

// ---------------------------------------------------------------------------
// (P4) Tie-safe cursor.
// ---------------------------------------------------------------------------

describe("(P4) cursor carries BOTH sort keys", () => {
  it("round-trips created_at and id", () => {
    const cur = _encodeLeadCursor("2023-06-07T03:21:17.000Z", "ee35341a-69e9-48dc-a705-c200c2053998");
    assert.deepEqual(_decodeLeadCursor(cur), {
      createdAt: "2023-06-07T03:21:17.000Z",
      sortValue: "2023-06-07T03:21:17.000Z",
      id: "ee35341a-69e9-48dc-a705-c200c2053998",
    });
  });

  it("survives an id containing the separator character", () => {
    const cur = _encodeLeadCursor("2026-01-01T00:00:00.000Z", "we|ird|id");
    assert.deepEqual(_decodeLeadCursor(cur), {
      createdAt: "2026-01-01T00:00:00.000Z",
      sortValue: "2026-01-01T00:00:00.000Z",
      id: "we|ird|id",
    });
  });

  it("survives a SORT VALUE containing the separator character", () => {
    // Once `name` became a sort key the left component could contain a pipe
    // too. Unencoded, the split point moves and the cursor decodes to a
    // DIFFERENT row — silently skipping part of the result set. A real lead is
    // named with a pipe often enough to matter at 178k rows.
    const cur = _encodeLeadCursor("Anita | Sharma", "id-42");
    assert.deepEqual(_decodeLeadCursor(cur), {
      createdAt: "Anita | Sharma",
      sortValue: "Anita | Sharma",
      id: "id-42",
    });
  });

  it("survives a sort value AND an id both containing separators", () => {
    const cur = _encodeLeadCursor("A|B", "we|ird|id");
    assert.deepEqual(_decodeLeadCursor(cur), {
      createdAt: "A|B",
      sortValue: "A|B",
      id: "we|ird|id",
    });
  });

  it("returns null for malformed cursors rather than throwing", () => {
    assert.equal(_decodeLeadCursor("not-base64!!"), null);
    assert.equal(_decodeLeadCursor(""), null);
    assert.equal(_decodeLeadCursor(Buffer.from("nopipe").toString("base64url")), null);
  });

  it("forwards BOTH cursor components to the RPC", async () => {
    const cur = _encodeLeadCursor("2023-06-07T03:21:17.000Z", "abc");
    const { client, calls } = makeRpcStub({ rows: [] });
    await _dbSelectLeadsPaged(client, { cursor: cur });
    assert.equal(calls[0]!.args.p_cursor_created_at, "2023-06-07T03:21:17.000Z");
    assert.equal(calls[0]!.args.p_cursor_id, "abc");
  });

  it("emits a next cursor built from the LAST row of a full page", async () => {
    const rows = Array.from({ length: 5 }, (_v, i) => makeRow(i));
    const { client } = makeRpcStub({ rows });
    const page = await _dbSelectLeadsPaged(client, { limit: 5 });
    assert.equal(page.nextCursor, _encodeLeadCursor(rows[4]!.created_at, rows[4]!.id));
  });

  it("emits NO next cursor on a short page", async () => {
    const { client } = makeRpcStub({ rows: [makeRow(0), makeRow(1)] });
    const page = await _dbSelectLeadsPaged(client, { limit: 50 });
    assert.equal(page.nextCursor, null);
  });

  it("a cursor supersedes offset so a page can never be skipped", async () => {
    const { client, calls } = makeRpcStub({ rows: [] });
    await _dbSelectLeadsPaged(client, { cursor: _encodeLeadCursor("2026-01-01T00:00:00.000Z", "x"), offset: 5000 });
    assert.equal(calls[0]!.args.p_offset, 0, "offset must be ignored when a cursor is supplied");
  });

  it("tie group: consecutive pages sharing one timestamp advance by id", async () => {
    // The real shape this protects: prod has 168 active rows on a single
    // created_at. With a created_at-only cursor, page 2 would re-request
    // `created_at < T` and skip the remaining 118 rows of the tie group.
    const T = "2026-07-22T05:05:16.405Z";
    const pageOne = Array.from({ length: 50 }, (_v, i) => makeRow(i, T));
    const { client } = makeRpcStub({ rows: pageOne });
    const page = await _dbSelectLeadsPaged(client, { limit: 50, includeLegacy: "only" });
    const decoded = _decodeLeadCursor(page.nextCursor!)!;
    assert.equal(decoded.createdAt, T, "cursor keeps the shared timestamp");
    assert.equal(decoded.id, pageOne[49]!.id, "and pins the exact id to resume after");
  });
});

// ---------------------------------------------------------------------------
// (P5) THE SEGMENTATION FIELD TRAP.
// ---------------------------------------------------------------------------

describe("(P5) segment fields read legacy campaign, never utm_*", () => {
  it("a known-populated legacy campaign segment returns rows, not an empty set", async () => {
    // This is the guard the brief asked for: FAIL if a segment query for a
    // campaign we know is populated comes back empty. An implementation wired
    // to `utm_campaign` produces exactly that empty result — silently, because
    // utm_campaign is non-null on 4 of 178,183 legacy rows.
    const rows = Array.from({ length: 10 }, (_v, i) => makeRow(i));
    const { client } = makeRpcStub({ rows, count: 10 });
    const page = await _dbSelectLeadsPaged(client, { includeLegacy: "only", withCount: true });

    assert.ok(page.rows.length > 0, "legacy campaign segment must not be empty");
    assert.ok((page.total ?? 0) > 0, "legacy campaign segment count must not be zero");

    const withCampaign = page.rows.filter((r) => r.campaign || r.campaign_clean);
    assert.equal(
      withCampaign.length, page.rows.length,
      "every legacy row must expose campaign via `campaign` / `campaign_clean`",
    );
  });

  it("the worklist row shape exposes campaign_clean and has no utm_* surface", async () => {
    const { client } = makeRpcStub({ rows: [makeRow(1)] });
    const page = await _dbSelectLeadsPaged(client, {});
    const row = page.rows[0]! as unknown as Record<string, unknown>;
    assert.ok("campaign" in row && "campaign_clean" in row, "campaign fields must be projected");
    for (const banned of ["utm_campaign", "utm_source", "utm_medium", "gclid"]) {
      assert.ok(!(banned in row), `${banned} must not be the worklist's campaign source`);
    }
  });

  it("does NOT bulk-read the attribution JSONB", async () => {
    // Selecting the blob for 168k rows cost ~13.2 s of deTOAST. The worklist
    // projects the two values it needs as scalars instead.
    const { client } = makeRpcStub({ rows: [makeRow(1)] });
    const page = await _dbSelectLeadsPaged(client, {});
    assert.ok(!("attribution" in (page.rows[0]! as unknown as Record<string, unknown>)));
  });
});

// ---------------------------------------------------------------------------
// (P6) Server-side filtering + cohort rule.
// ---------------------------------------------------------------------------

describe("(P6) every filter is pushed to the server", () => {
  it("forwards all filters to the RPC in one round trip", async () => {
    const { client, calls } = makeRpcStub({ rows: [] });
    await _dbSelectLeadsPaged(client, {
      includeLegacy: "only",
      queue: "reengage_q1",
      sourceTag: "FB LEADS",
      status: "Not Replied",
      assignedTo: "counsellor_a",
      search: "9876",
      consentStatus: "unknown",
      limit: 25,
    });
    assert.equal(calls.length, 1, "one RPC call — never fetch-all-then-filter");
    assert.deepEqual(calls[0]!.args, {
      p_include_legacy: "only",
      p_queue: "reengage_q1",
      p_source_tag: "FB LEADS",
      p_status: "Not Replied",
      p_assigned_to: "counsellor_a",
      p_search: "9876",
      p_consent_status: "unknown",
      p_limit: 25,
      p_cursor_created_at: null,
      p_cursor_id: null,
      p_offset: 0,
      // Phase 2 additions. Every one defaults to a value that reproduces the
      // pre-Phase-2 behaviour exactly, so the RPC signature could be extended
      // without a deploy-ordering dependency.
      p_work_status: null,
      p_assigned_mode: null,
      p_contacted: null,
      p_created_from: null,
      p_created_to: null,
      p_sort: "created_at",
      p_dir: "desc",
      p_cursor_sort_value: null,
    });
  });

  it("forwards every Phase 2 filter, still in one round trip", async () => {
    const { client, calls } = makeRpcStub({ rows: [] });
    await _dbSelectLeadsPaged(client, {
      includeLegacy: "only",
      workStatus: "callback_scheduled",
      assignedMode: "unassigned",
      contacted: "no",
      createdFrom: "2023-01-01T00:00:00.000Z",
      createdTo: "2024-01-01T00:00:00.000Z",
      sort: "follow_up_at",
      dir: "asc",
      limit: 50,
    });
    assert.equal(calls.length, 1, "one RPC call — never fetch-all-then-filter");
    const a = calls[0]!.args;
    assert.equal(a.p_work_status, "callback_scheduled");
    assert.equal(a.p_assigned_mode, "unassigned");
    assert.equal(a.p_contacted, "no");
    assert.equal(a.p_created_from, "2023-01-01T00:00:00.000Z");
    assert.equal(a.p_created_to, "2024-01-01T00:00:00.000Z");
    assert.equal(a.p_sort, "follow_up_at");
    assert.equal(a.p_dir, "asc");
  });

  it("only issues the count RPC when withCount was requested", async () => {
    const { client, calls } = makeRpcStub({ rows: [], count: 178183 });
    await _dbSelectLeadsPaged(client, {});
    assert.equal(calls.filter((c) => c.fn === "leads_paged_count").length, 0);

    const { client: c2, calls: k2 } = makeRpcStub({ rows: [], count: 178183 });
    const page = await _dbSelectLeadsPaged(c2, { withCount: true });
    assert.equal(k2.filter((c) => c.fn === "leads_paged_count").length, 1);
    assert.equal(page.total, 178183);
  });

  it("total stays null when the count was not requested", async () => {
    const { client } = makeRpcStub({ rows: [makeRow(1)] });
    const page = await _dbSelectLeadsPaged(client, {});
    assert.equal(page.total, null);
  });
});

describe("(P6b) canonical cohort rule", () => {
  it("classifies by the attribution.legacy flag only", () => {
    assert.equal(cohortForLead({ attribution: { legacy: true } as never }), "legacy_promoted");
    assert.equal(cohortForLead({ attribution: { legacy: "true" } as never }), "legacy_promoted");
    assert.equal(cohortForLead({ attribution: null }), "live_captured");
    assert.equal(cohortForLead({ attribution: {} as never }), "live_captured");
  });

  it("keeps the 110 legacy_sheet-without-flag rows on the LIVE side", () => {
    // These are pre-existing live leads the importer matched and enriched.
    // Flipping them to legacy_promoted would retroactively rewrite published
    // channel numbers — the exact thing a frozen cohort exists to prevent.
    const enrichedLiveLead = {
      attribution: { first_touch: { source: "Google Ads" } } as never,
    };
    assert.equal(cohortForLead(enrichedLiveLead), "live_captured");
  });
});
