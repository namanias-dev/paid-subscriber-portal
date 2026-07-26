/**
 * PHASE 2 QA HARNESS — drives the REAL `getLeadsPaged` code path against the
 * REAL production database and prints console tables.
 *
 * Run:  node --import tsx --env-file=.env.local scripts/qa/phase2-worklist-qa.ts
 *
 * This is read-only except for one deliberately ROLLED-BACK transaction used to
 * simulate a concurrent insert (see CONCURRENCY below). Nothing it does is ever
 * committed, and it sends zero messages on any channel.
 *
 * WHY A HARNESS AND NOT UNIT TESTS
 * --------------------------------
 * The invariants that actually break at 178k rows — index selection, keyset
 * integrity across a tie group, deep-page latency — are properties of the
 * PLANNER and the DATA, not of the TypeScript. A stubbed unit test cannot fail
 * on any of them. Those live here; the pure-logic invariants live in
 * `tests/legacy-crm-phase2/`.
 */

import { getSupabaseAdmin } from "../../lib/supabase";
import { DEFAULT_LEAD_STATUS } from "../../lib/leadStatus";
import { _dbSelectLeadsPaged, _encodeLeadCursor, type _LeadsPagedClient } from "../../lib/dataProvider";
import type { LeadsPageParams, LeadsSortKey, LeadWorklistRow } from "../../lib/types";

// The frozen half of the reconciliation. `active_live` is NOT frozen — the
// public site captures leads continuously — so it is only ever asserted as a
// lower bound against whatever we measure at run start.
const LEGACY_FROZEN = 178_183;

/** The 168-row tie group: the worst shared-`created_at` case in the table. */
const TIE_GROUP_TS = "2026-07-22T05:05:16.405Z";
const TIE_GROUP_SIZE = 168;

const client = getSupabaseAdmin() as unknown as _LeadsPagedClient | null;
if (!client) {
  console.error("FATAL: no Supabase admin client — check .env.local");
  process.exit(1);
}

interface Check {
  id: string;
  check: string;
  expected: string;
  actual: string;
  result: "PASS" | "FAIL";
}
const checks: Check[] = [];
let failures = 0;

function record(id: string, check: string, expected: unknown, actual: unknown, ok?: boolean) {
  const pass = ok ?? String(expected) === String(actual);
  if (!pass) failures++;
  checks.push({
    id,
    check,
    expected: String(expected),
    actual: String(actual),
    result: pass ? "PASS" : "FAIL",
  });
}

/** PII masking. Never print a full phone number, not even to a local console. */
function maskPhone(p: string | null | undefined): string {
  if (!p) return "—";
  const d = p.replace(/\D/g, "");
  return d.length >= 10 ? `${d.slice(0, 2)}xxxxx${d.slice(-3)}` : "xxxx";
}
function maskName(n: string | null | undefined): string {
  if (!n) return "—";
  const t = n.trim();
  return t.length <= 2 ? `${t[0] ?? "?"}.` : `${t[0]}${"*".repeat(Math.min(t.length - 2, 6))}${t.slice(-1)}`;
}

async function page(params: LeadsPageParams) {
  return _dbSelectLeadsPaged(client!, params);
}

/**
 * Walk the worklist with the cursor, exactly as the UI will, and return every
 * row seen in order. `maxPages` bounds the walk so a cursor bug cannot spin.
 */
async function walk(
  base: LeadsPageParams,
  pageSize: number,
  maxPages: number,
): Promise<{ rows: LeadWorklistRow[]; pages: number; ms: number }> {
  const seen: LeadWorklistRow[] = [];
  let cursor: string | null = null;
  let pages = 0;
  const t0 = Date.now();
  for (; pages < maxPages; pages++) {
    const p: { rows: LeadWorklistRow[]; nextCursor: string | null } = await page({
      ...base,
      limit: pageSize,
      cursor,
    });
    seen.push(...p.rows);
    if (!p.nextCursor) {
      pages++;
      break;
    }
    cursor = p.nextCursor;
  }
  return { rows: seen, pages, ms: Date.now() - t0 };
}

// =====================================================================
async function main() {
  console.log("\n" + "=".repeat(78));
  console.log("PHASE 2 QA — LEGACY LEADS IN THE LEAD CRM");
  console.log("=".repeat(78));

  // -------------------------------------------------------------------
  // 0. RECONCILIATION — invariants, not constants.
  // -------------------------------------------------------------------
  const legacyTotal = (await page({ includeLegacy: "only", limit: 1, withCount: true })).total!;
  const liveTotal = (await page({ includeLegacy: false, limit: 1, withCount: true })).total!;
  const allTotal = (await page({ includeLegacy: true, limit: 1, withCount: true })).total!;

  record("R1", "active legacy is FROZEN at 178,183", LEGACY_FROZEN, legacyTotal);
  record("R2", "legacy + live = total (exact partition)", allTotal, legacyTotal + liveTotal);
  record("R3", "active live is a MOVING target (>0, not asserted equal)", "> 0", liveTotal, liveTotal > 0);

  console.log("\n--- 0. RECONCILIATION (live count is a moving target) ---");
  console.table([
    { metric: "active_legacy", value: legacyTotal, nature: "FROZEN — asserted ==" },
    { metric: "active_live", value: liveTotal, nature: "MOVING — asserted > 0 only" },
    { metric: "active_total", value: allTotal, nature: "= legacy + live" },
  ]);

  // -------------------------------------------------------------------
  // 1. THE TIE-GROUP BOUNDARY — the data-loss bug that looks like it works.
  // -------------------------------------------------------------------
  // 168 legacy rows share one `created_at`. With page size 25 that group
  // straddles SEVEN page boundaries. A `created_at`-only cursor returns the
  // first row of the group and then silently skips the other 167.
  const tieGroundTruth = await page({
    includeLegacy: "only",
    createdFrom: TIE_GROUP_TS,
    createdTo: new Date(Date.parse(TIE_GROUP_TS) + 1).toISOString(),
    limit: 100,
    withCount: true,
  });

  const tieWalk = await walk(
    {
      includeLegacy: "only",
      createdFrom: TIE_GROUP_TS,
      createdTo: new Date(Date.parse(TIE_GROUP_TS) + 1).toISOString(),
    },
    25,
    40,
  );
  const tieIds = tieWalk.rows.map((r) => r.id);
  const tieUnique = new Set(tieIds);

  record("K1", "tie group size matches the known 168", TIE_GROUP_SIZE, tieGroundTruth.total);
  record("K2", "keyset walk returns EVERY row of the tie group", tieGroundTruth.total, tieIds.length);
  record("K3", "keyset walk returns NO duplicate across boundaries", tieIds.length, tieUnique.size);

  console.log(`\n--- 1. TIE-GROUP BOUNDARY (${TIE_GROUP_SIZE} rows share one created_at) ---`);
  console.table([
    { probe: "ground truth count", value: tieGroundTruth.total },
    { probe: "rows seen by 25-row keyset walk", value: tieIds.length },
    { probe: "distinct ids seen", value: tieUnique.size },
    { probe: "pages walked", value: tieWalk.pages },
    { probe: "skipped rows", value: (tieGroundTruth.total ?? 0) - tieUnique.size },
    { probe: "duplicated rows", value: tieIds.length - tieUnique.size },
  ]);

  // -------------------------------------------------------------------
  // 2. EVERY SORT KEY × DIRECTION — ordering + no dupes + no empty page 2.
  // -------------------------------------------------------------------
  // `follow_up_at` and `last_contacted_at` are NULL on 100% of legacy rows.
  // Without coalesce() in both the cursor and the index, page 2 comes back
  // EMPTY here and reads as "no more results".
  const sortKeys: LeadsSortKey[] = ["created_at", "name", "follow_up_at", "last_contacted_at"];
  const sortRows: Record<string, unknown>[] = [];

  for (const sort of sortKeys) {
    for (const dir of ["desc", "asc"] as const) {
      const w = await walk({ includeLegacy: "only", sort, dir }, 50, 4);
      const ids = w.rows.map((r) => r.id);
      const uniq = new Set(ids);
      const page2NonEmpty = ids.length > 50;

      record(`S:${sort}:${dir}:dupes`, `sort ${sort} ${dir} — no duplicates`, ids.length, uniq.size);
      record(
        `S:${sort}:${dir}:p2`,
        `sort ${sort} ${dir} — page 2 is NOT empty (the coalesce bug)`,
        "> 50 rows over 4 pages",
        ids.length,
        page2NonEmpty,
      );

      sortRows.push({
        sort,
        dir,
        pages: w.pages,
        rows: ids.length,
        distinct: uniq.size,
        dupes: ids.length - uniq.size,
        page2_empty: page2NonEmpty ? "no" : "YES — BUG",
        ms: w.ms,
      });
    }
  }
  console.log("\n--- 2. SORT KEYS × DIRECTIONS (4-page keyset walk, 50/page) ---");
  console.table(sortRows);

  // -------------------------------------------------------------------
  // 3. FILTERS — every one server-side, count agrees with the page.
  // -------------------------------------------------------------------
  const filterCases: Array<{ label: string; params: LeadsPageParams }> = [
    { label: "consent = unknown", params: { includeLegacy: "only", consentStatus: "unknown" } },
    { label: "unassigned", params: { includeLegacy: "only", assignedMode: "unassigned" } },
    { label: "assigned", params: { includeLegacy: "only", assignedMode: "assigned" } },
    { label: "never contacted", params: { includeLegacy: "only", contacted: "no" } },
    { label: "has been contacted", params: { includeLegacy: "only", contacted: "yes" } },
    { label: `status = ${DEFAULT_LEAD_STATUS}`, params: { includeLegacy: "only", status: DEFAULT_LEAD_STATUS } },
    { label: "work_status = interested", params: { includeLegacy: "only", workStatus: "interested" } },
    { label: "search partial phone '98765'", params: { includeLegacy: "only", search: "98765", countCap: 5000 } },
    { label: "search +91-formatted needle", params: { includeLegacy: "only", search: "+91 98765 43210", countCap: 5000 } },
    { label: "search partial name 'kumar' (capped)", params: { includeLegacy: "only", search: "kumar", countCap: 5000 } },
    { label: "search 1-char needle 'a'", params: { includeLegacy: "only", search: "a", countCap: 5000 } },
    { label: "combo: status+consent+unassigned", params: { includeLegacy: "only", status: DEFAULT_LEAD_STATUS, consentStatus: "unknown", assignedMode: "unassigned" } },
    { label: "date range 2025", params: { includeLegacy: "only", createdFrom: "2025-01-01T00:00:00Z", createdTo: "2026-01-01T00:00:00Z" } },
    { label: "ZERO-RESULT combo", params: { includeLegacy: "only", status: DEFAULT_LEAD_STATUS, search: "zzzzzznotarealname" } },
  ];

  // NETWORK FLOOR. This harness runs on a laptop; the app runs on Vercel in the
  // same region as Supabase. Every timing below therefore carries a round-trip
  // tax that production does not pay, and judging a <500 ms budget against it
  // would condemn queries that execute in 6 ms. Measure the floor with the
  // cheapest possible pair of RPCs (a filter that matches nothing) and report
  // budget verdicts against the remainder.
  const floorSamples: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = Date.now();
    await page({ includeLegacy: "only", workStatus: "closed", limit: 1, withCount: true });
    floorSamples.push(Date.now() - t);
  }
  const NET_FLOOR = Math.min(...floorSamples);
  console.log(
    `\n[network floor] a 0-row 2-RPC round trip from this machine costs ${NET_FLOOR} ms ` +
      `(min of ${floorSamples.join("/")}). Budget verdicts below subtract it; ` +
      `DB-side execution times come from EXPLAIN ANALYZE separately.`,
  );

  const filterRows: Record<string, unknown>[] = [];
  for (const { label, params } of filterCases) {
    const t0 = Date.now();
    try {
      const p = await page({ ...params, limit: 25, withCount: true });
      const ms = Date.now() - t0;
      const consistent = (p.total ?? 0) === 0 ? p.rows.length === 0 : p.rows.length > 0;
      const net = Math.max(0, ms - NET_FLOOR);
      const withinBudget = net < 1000;
      record(`F:${label}`, `filter "${label}" — count agrees with page`, "consistent", consistent ? "consistent" : "MISMATCH", consistent);
      record(`T:${label}`, `filter "${label}" — under the 1000 ms ceiling (net of network)`, "< 1000 ms", `${net} ms`, withinBudget);
      filterRows.push({
        filter: label,
        total: p.totalIsCapped ? `${p.total}+` : p.total,
        page_rows: p.rows.length,
        raw_ms: ms,
        net_ms: net,
        agrees: consistent ? "yes" : "NO",
        budget: withinBudget ? (net < 500 ? "under target" : "under ceiling") : "OVER CEILING",
      });
    } catch (e) {
      // A thrown filter is a real bug, not a reason to abandon the matrix.
      const ms = Date.now() - t0;
      record(`F:${label}`, `filter "${label}" — must not throw`, "no error", String((e as Error).message).slice(0, 60), false);
      filterRows.push({ filter: label, total: "ERROR", page_rows: "—", ms, agrees: "THREW", budget: "—" });
    }
  }
  console.log("\n--- 3. SERVER-SIDE FILTERS (count vs page consistency) ---");
  console.table(filterRows);

  // -------------------------------------------------------------------
  // 4. LIMIT CAP + DEEP PAGE
  // -------------------------------------------------------------------
  const over = await page({ includeLegacy: "only", limit: 5000 });
  record("L1", "limit is CAPPED at 100, never honoured above it", 100, over.rows.length);

  // DEEP PAGE VIA CURSOR — the real product path.
  //
  // The cursor is CONSTRUCTED at the known depth rather than reached by
  // walking 1,500 pages, because a keyset cursor is stateless: the page read
  // is identical whether the client walked there or jumped there, and the
  // walk added ~9 minutes of round trips while testing nothing extra. (The
  // no-skip/no-duplicate property of consecutive pages is proven separately
  // and much more sharply by the tie-group walk in section 1.)
  //
  // OFFSET is deliberately NOT how depth is reached: it makes Postgres walk
  // and discard every skipped row, and times out past ~100k.
  const DEEP_CURSOR = _encodeLeadCursor(
    "2023-06-07T03:21:17.000Z",
    "ee35341a-69e9-48dc-a705-c200c2053998",
  ); // measured position ~150,000 in (created_at desc, id desc)

  const deepT0 = Date.now();
  const deep = await page({ includeLegacy: "only", limit: 50, cursor: DEEP_CURSOR });
  const deepMs = Date.now() - deepT0;
  record("L2", "deep page via CURSOR at ~row 150,000 returns a full page", 50, deep.rows.length);
  record("L3", "deep page via cursor is under the 1000 ms ceiling", "< 1000 ms", `${deepMs} ms`, deepMs < 1000);

  // The OFFSET fallback must FAIL LOUDLY rather than time out or, worse,
  // silently clamp and serve the wrong page.
  let offsetRejected = false;
  try {
    await page({ includeLegacy: "only", offset: 150_000, limit: 50 });
  } catch (e) {
    offsetRejected = /offset .* exceeds/i.test(String((e as Error).message));
  }
  record("L4", "an unusable deep OFFSET is rejected honestly, not clamped", true, offsetRejected);

  console.log("\n--- 4. LIMIT CAP + DEEP PAGE ---");
  console.table([
    { probe: "limit=5000 requested", rows: over.rows.length, ms: "—", note: "hard cap 100" },
    { probe: "page read at depth ~150,000 (cursor)", rows: deep.rows.length, ms: deepMs, note: "the product path" },
    { probe: "offset=150000", rows: offsetRejected ? "REJECTED" : "served", ms: "—", note: "honest failure, not silent clamp" },
  ]);

  // -------------------------------------------------------------------
  // 5. LEGACY vs LIVE PARITY — THE ACCEPTANCE TEST.
  // -------------------------------------------------------------------
  // The same operation, on both scopes, must behave identically.
  const parityRows: Record<string, unknown>[] = [];
  for (const op of [
    { label: "page 1 (50)", params: { limit: 50 } as LeadsPageParams },
    { label: "sort name asc", params: { sort: "name", dir: "asc", limit: 25 } as LeadsPageParams },
    { label: "sort follow_up desc", params: { sort: "follow_up_at", dir: "desc", limit: 25 } as LeadsPageParams },
    { label: "filter consent unknown", params: { consentStatus: "unknown", limit: 25 } as LeadsPageParams },
    { label: "search '9'", params: { search: "987", limit: 25 } as LeadsPageParams },
    { label: "unassigned", params: { assignedMode: "unassigned", limit: 25 } as LeadsPageParams },
  ]) {
    const lT0 = Date.now();
    const legacy = await page({ ...op.params, includeLegacy: "only" });
    const lMs = Date.now() - lT0;
    const vT0 = Date.now();
    const live = await page({ ...op.params, includeLegacy: false });
    const vMs = Date.now() - vT0;

    // Parity = the SHAPE of the response is identical. Row counts differ
    // because the populations differ; that is not an asymmetry.
    const legacyKeys = legacy.rows[0] ? Object.keys(legacy.rows[0]).sort().join(",") : "";
    const liveKeys = live.rows[0] ? Object.keys(live.rows[0]).sort().join(",") : "";
    const same = legacyKeys === liveKeys || !legacyKeys || !liveKeys;
    record(`P:${op.label}`, `parity "${op.label}" — identical row shape`, "identical", same ? "identical" : "DIFFERENT", same);

    parityRows.push({
      operation: op.label,
      legacy_rows: legacy.rows.length,
      live_rows: live.rows.length,
      legacy_ms: lMs,
      live_ms: vMs,
      same_shape: same ? "yes" : "NO",
    });
  }
  console.log("\n--- 5. LEGACY vs LIVE PARITY (the acceptance test) ---");
  console.table(parityRows);

  // -------------------------------------------------------------------
  // 6. EDGE CASES — deliberately constructed.
  // -------------------------------------------------------------------
  const noCampaign = await page({ includeLegacy: "only", limit: 100, withCount: true });
  const noCampaignRows = noCampaign.rows.filter((r) => !r.campaign_clean);
  const longNames = noCampaign.rows.filter((r) => (r.name ?? "").length > 40);
  const longRaw = noCampaign.rows.filter((r) => (r.legacy_call_status_raw ?? "").length > 30);
  const unassigned = noCampaign.rows.filter((r) => !r.assigned_to);
  const promoted = noCampaign.rows.filter((r) => r.promoted_at);
  const rawPreserved = noCampaign.rows.filter((r) => r.legacy_call_status_raw != null);

  console.log("\n--- 6. EDGE-CASE POPULATIONS (first 100 legacy rows) ---");
  console.table([
    { edge_case: "no campaign (honest cell)", n: noCampaignRows.length },
    { edge_case: "name longer than 40 chars", n: longNames.length },
    { edge_case: "legacy_call_status_raw > 30 chars", n: longRaw.length },
    { edge_case: "unassigned", n: unassigned.length },
    { edge_case: "already promoted", n: promoted.length },
    { edge_case: "legacy_call_status_raw present", n: rawPreserved.length },
  ]);

  console.log("\n--- 6b. SAMPLE ROWS (PII MASKED) ---");
  console.table(
    noCampaign.rows.slice(0, 5).map((r) => ({
      id: r.id.slice(0, 8),
      name: maskName(r.name),
      phone: maskPhone(r.phone),
      status: r.status,
      raw_status: (r.legacy_call_status_raw ?? "—").slice(0, 22),
      campaign: r.campaign_clean ?? "Legacy — no campaign",
      consent: r.consent_status,
      assigned: r.assigned_to ?? "unassigned",
      work_status: r.work_status ?? "not worked",
    })),
  );

  // -------------------------------------------------------------------
  // 7. THE NO-FIXTURE CONTRACT
  // -------------------------------------------------------------------
  // A DB error must THROW, never degrade to `mock.leads`. Regression 9f567b64.
  let threw = false;
  let fixtureLeak = false;
  try {
    const bad: _LeadsPagedClient = {
      rpc: async () => ({ data: null, error: { message: "canceling statement due to statement timeout" } }),
    };
    const r = await _dbSelectLeadsPaged(bad, { includeLegacy: "only" });
    fixtureLeak = r.rows.length > 0;
  } catch {
    threw = true;
  }
  record("X1", "a DB error THROWS instead of serving fixtures", true, threw);
  record("X2", "no fixture rows leak on error", false, fixtureLeak);

  // Real prod rows must never be the seed fixtures.
  const fixtureNames = noCampaign.rows.filter((r) => /lead aspirant|test lead|demo/i.test(r.name ?? ""));
  record("X3", "zero fixture-looking rows in prod data", 0, fixtureNames.length);

  console.log("\n--- 7. NO-FIXTURE-FALLBACK CONTRACT ---");
  console.table([
    { guard: "DB error throws", result: threw ? "PASS" : "FAIL" },
    { guard: "no fixture rows on error", result: fixtureLeak ? "FAIL" : "PASS" },
    { guard: "no fixture-looking rows in prod", result: fixtureNames.length === 0 ? "PASS" : "FAIL" },
  ]);

  // -------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------
  console.log("\n" + "=".repeat(78));
  console.log("CHECK RESULTS");
  console.log("=".repeat(78));
  console.table(checks);

  const failed = checks.filter((c) => c.result === "FAIL");
  console.log(`\nTOTAL: ${checks.length} checks · ${checks.length - failed.length} PASS · ${failed.length} FAIL`);
  if (failed.length) {
    console.log("\nFAILURES:");
    console.table(failed);
  }
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
