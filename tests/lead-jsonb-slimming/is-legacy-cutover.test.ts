/**
 * PHASE 1d REGRESSION SUITE — the `is_legacy` cutover and JSONB slimming.
 *
 * The legacy boundary gates EVERY live surface: the CRM's default-hidden
 * behaviour, the Payments page, Analytics, and the SMS bulk audiences. If it
 * is wrong in either direction the failure is severe and silent — either
 * 178,183 legacy leads leak into live surfaces and SMS sends, or 987 real
 * leads vanish from the CRM. Everything below pins one half of that boundary.
 *
 *  S1. `hasLegacyFlag` reads the promoted column, and still falls back to the
 *      JSONB key for rows that do not carry it (fixtures, mock.leads, narrow
 *      projections). Both branches must agree.
 *  S2. Bucket reconciliation. The JSONB predicate did not partition the table;
 *      the boolean does. Assert the arithmetic, including the exact
 *      production numbers the cutover was gated on.
 *  S3. Both predicate spellings stay pinned. The old JSONB forms are STILL
 *      load-bearing — the live CRM read uses them against an index that was
 *      deliberately left untouched.
 *  S4. `splitLegacyTouches` — the side-table move must not lose a touch.
 *  S5. The worklist row shape after the swap: campaign fields present, no
 *      `utm_*` surface, no `attribution` blob.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  hasLegacyFlag,
  excludeLegacy,
  applyLegacyFilter,
  cohortForLead,
  assertLegacyBucketsReconcile,
  NON_LEGACY_POSTGREST_OR,
  LEGACY_POSTGREST_FILTER,
  LEADS_IS_LEGACY_COLUMN,
  LEGACY_COLUMN_FILTER,
  NON_LEGACY_COLUMN_FILTER,
} from "../../lib/legacy-migration/legacyFilter";
import { splitLegacyTouches } from "../../lib/legacy-migration/importer";
import type { Lead, LeadWorklistRow } from "../../lib/types";

// Production truth at cutover, 2026-07-24. The migration did not switch a
// single reader until the database reproduced every one of these exactly.
const PROD = {
  total: 179493,
  legacy: 178183,
  nonLegacy: 1310,
  activeTotal: 179170,
  activeLegacy: 178183,
  activeNonLegacy: 987,
} as const;

type Leadish = Pick<Lead, "attribution"> & { is_legacy?: boolean | null };

// ---------------------------------------------------------------------------
// (S1) hasLegacyFlag: column first, JSONB fallback.
// ---------------------------------------------------------------------------

describe("(S1) hasLegacyFlag prefers the promoted column", () => {
  it("reads is_legacy when the row carries it", () => {
    assert.equal(hasLegacyFlag({ attribution: null, is_legacy: true } as Leadish), true);
    assert.equal(hasLegacyFlag({ attribution: null, is_legacy: false } as Leadish), false);
  });

  it("falls back to the JSONB key when the column is absent", () => {
    // mock.leads, fixtures and any projection that does not select the column
    // arrive here without it. Treating those as non-legacy by default would be
    // the "178k legacy rows leak into an SMS audience" failure in miniature.
    assert.equal(hasLegacyFlag({ attribution: { legacy: true } as never }), true);
    assert.equal(hasLegacyFlag({ attribution: { legacy: "true" } as never }), true);
    assert.equal(hasLegacyFlag({ attribution: {} as never }), false);
    assert.equal(hasLegacyFlag({ attribution: null }), false);
  });

  it("treats an explicitly null column as absent, not as false", () => {
    // `is_legacy: null` means "not projected", not "not legacy". Reading it as
    // false would silently unhide a legacy row.
    assert.equal(hasLegacyFlag({ attribution: { legacy: true } as never, is_legacy: null }), true);
  });

  it("agrees with the JSONB key on every shape the backfill reconciled", () => {
    // Mirrors the SQL cross-check that had to return zero disagreeing rows:
    //   is_legacy <> (((attribution->>'legacy') = 'true') is true)
    const shapes: Array<{ attribution: unknown; expected: boolean }> = [
      { attribution: { legacy: true }, expected: true },
      { attribution: { legacy: "true" }, expected: true },
      { attribution: { legacy: false }, expected: false },
      { attribution: { legacy: null }, expected: false },
      { attribution: { first_touch: { source: "Google Ads" } }, expected: false },
      { attribution: {}, expected: false },
      { attribution: null, expected: false },
    ];
    for (const s of shapes) {
      const fromJson = hasLegacyFlag({ attribution: s.attribution as never });
      const fromColumn = hasLegacyFlag({ attribution: null, is_legacy: s.expected } as Leadish);
      assert.equal(fromJson, s.expected, `JSONB branch disagreed for ${JSON.stringify(s.attribution)}`);
      assert.equal(fromColumn, fromJson, `column and JSONB branches disagreed for ${JSON.stringify(s.attribution)}`);
    }
  });

  it("filters lists by the column without consulting attribution", () => {
    const rows = [
      { id: "a", attribution: null, is_legacy: true },
      { id: "b", attribution: null, is_legacy: false },
      { id: "c", attribution: null, is_legacy: true },
    ] as Array<Leadish & { id: string }>;
    assert.deepEqual(excludeLegacy(rows).map((r) => r.id), ["b"]);
    assert.deepEqual(applyLegacyFilter(rows, { includeLegacy: true }).map((r) => r.id), ["a", "b", "c"]);
    assert.deepEqual(applyLegacyFilter(rows).map((r) => r.id), ["b"]);
  });

  it("keeps the 110 legacy_sheet-without-flag rows on the LIVE side", () => {
    // Enriched pre-existing live leads. The promoted column must not change
    // this: reclassifying them would retroactively rewrite published channel
    // numbers, which is exactly what a frozen cohort exists to prevent.
    const enriched = { attribution: { first_touch: { source: "Google Ads" } } as never, is_legacy: false };
    assert.equal(hasLegacyFlag(enriched), false);
    assert.equal(cohortForLead(enriched), "live_captured");
  });

  it("still classifies cohort from the flag alone", () => {
    assert.equal(cohortForLead({ attribution: { legacy: true } as never }), "legacy_promoted");
    assert.equal(cohortForLead({ attribution: null }), "live_captured");
  });
});

// ---------------------------------------------------------------------------
// (S2) Bucket reconciliation.
// ---------------------------------------------------------------------------

describe("(S2) legacy buckets must partition their population", () => {
  it("accepts the production split the cutover was gated on", () => {
    assertLegacyBucketsReconcile({ legacy: PROD.legacy, nonLegacy: PROD.nonLegacy, total: PROD.total });
    assertLegacyBucketsReconcile({
      legacy: PROD.activeLegacy,
      nonLegacy: PROD.activeNonLegacy,
      total: PROD.activeTotal,
    });
  });

  it("pins the exact production numbers", () => {
    assert.equal(PROD.legacy + PROD.nonLegacy, PROD.total);
    assert.equal(PROD.activeLegacy + PROD.activeNonLegacy, PROD.activeTotal);
    assert.equal(PROD.total - PROD.activeTotal, 323, "soft-merged rows");
  });

  it("throws when rows fall out of both buckets — the JSONB NULL trap", () => {
    // 1,076 rows have a null attribution. Under the old predicate pair they
    // satisfied neither arm and simply disappeared from the split.
    assert.throws(
      () => assertLegacyBucketsReconcile({ legacy: PROD.legacy, nonLegacy: 234, total: PROD.total }),
      /do not reconcile/,
    );
  });

  it("throws when buckets double-count", () => {
    assert.throws(() => assertLegacyBucketsReconcile({ legacy: 100, nonLegacy: 100, total: 150 }), /do not reconcile/);
  });

  it("rejects malformed counts rather than silently coercing them", () => {
    assert.throws(() => assertLegacyBucketsReconcile({ legacy: -1, nonLegacy: 2, total: 1 }), /non-negative integer/);
    assert.throws(
      () => assertLegacyBucketsReconcile({ legacy: 1.5, nonLegacy: 2, total: 3.5 }),
      /non-negative integer/,
    );
  });

  it("names the context so a failure says which count broke", () => {
    assert.throws(
      () => assertLegacyBucketsReconcile({ legacy: 1, nonLegacy: 1, total: 3 }, "SMS audience"),
      /SMS audience/,
    );
  });
});

// ---------------------------------------------------------------------------
// (S3) Both spellings stay pinned.
// ---------------------------------------------------------------------------

describe("(S3) predicate spellings", () => {
  it("keeps the three-arm OR character-identical", () => {
    // STILL load-bearing. `getLeads()` — the live CRM read — deliberately
    // still fires this against idx_leads_active_nonlegacy_created, which this
    // migration did not touch. Re-measured after the slimming: same index,
    // 987 rows, 2.97 ms warm.
    assert.equal(
      NON_LEGACY_POSTGREST_OR,
      "attribution.is.null,attribution->>legacy.is.null,attribution->>legacy.neq.true",
    );
    assert.ok(!NON_LEGACY_POSTGREST_OR.includes("is distinct from"));
  });

  it("keeps the legacy-only filter as plain equality", () => {
    assert.deepEqual({ ...LEGACY_POSTGREST_FILTER }, {
      column: "attribution->>legacy",
      operator: "eq",
      value: "true",
    });
  });

  it("exposes the promoted column form for new readers", () => {
    assert.equal(LEADS_IS_LEGACY_COLUMN, "is_legacy");
    assert.deepEqual({ ...LEGACY_COLUMN_FILTER }, { column: "is_legacy", operator: "is", value: true });
    assert.deepEqual({ ...NON_LEGACY_COLUMN_FILTER }, { column: "is_legacy", operator: "is", value: false });
  });

  it("the column form needs no NULL arm — that is the whole point", () => {
    // The OR form has three arms purely because the JSONB expression is
    // three-valued. `is_legacy` is NOT NULL, so one term is total.
    assert.equal(NON_LEGACY_POSTGREST_OR.split(",").length, 3);
    assert.equal(NON_LEGACY_COLUMN_FILTER.column, LEGACY_COLUMN_FILTER.column);
    assert.notEqual(NON_LEGACY_COLUMN_FILTER.value, LEGACY_COLUMN_FILTER.value);
  });
});

// ---------------------------------------------------------------------------
// (S4) The side-table move.
// ---------------------------------------------------------------------------

describe("(S4) splitLegacyTouches routes the audit trail out of the blob", () => {
  it("removes legacy_touches and returns it separately", () => {
    const touch = { source: "FB LEADS", at: "2023-06-07T03:21:17.000Z", winner: true };
    const { attribution, touches } = splitLegacyTouches({
      legacy: true,
      legacy_source_tab: "FB LEADS",
      first_touch: { campaign_clean: "ssc 2023 batch" },
      legacy_touches: [touch],
    });
    assert.equal("legacy_touches" in attribution, false, "the blob must not keep the trail");
    assert.deepEqual(touches, [touch]);
  });

  it("preserves every other key untouched", () => {
    const { attribution } = splitLegacyTouches({
      legacy: true,
      legacy_source_tab: "WhatsApp",
      first_touch: { campaign_clean: "cc" },
      origin_review_needed: true,
      legacy_touches: [{ a: 1 }],
    });
    assert.deepEqual(attribution, {
      legacy: true,
      legacy_source_tab: "WhatsApp",
      first_touch: { campaign_clean: "cc" },
      origin_review_needed: true,
    });
  });

  it("loses nothing when a lead has several touches", () => {
    // 39,553 leads carry more than one touch and the trail totals 221,264
    // touchpoints. Truncating a multi-touch trail is the failure this guards.
    const touches = Array.from({ length: 7 }, (_v, i) => ({ n: i }));
    const split = splitLegacyTouches({ legacy: true, legacy_touches: touches });
    assert.equal(split.touches.length, 7);
    assert.deepEqual(split.touches, touches);
  });

  it("returns an empty array rather than undefined when the key is absent", () => {
    const { attribution, touches } = splitLegacyTouches({ legacy: true });
    assert.deepEqual(touches, []);
    assert.deepEqual(attribution, { legacy: true });
  });

  it("coerces a non-array legacy_touches to an empty array", () => {
    assert.deepEqual(splitLegacyTouches({ legacy_touches: "nonsense" }).touches, []);
    assert.deepEqual(splitLegacyTouches({ legacy_touches: null }).touches, []);
  });

  it("does not mutate its input", () => {
    const input = { legacy: true, legacy_touches: [{ a: 1 }] };
    splitLegacyTouches(input);
    assert.equal("legacy_touches" in input, true, "caller's object must be left alone");
  });
});

// ---------------------------------------------------------------------------
// (S5) Worklist row shape after the swap.
// ---------------------------------------------------------------------------

describe("(S5) the worklist row shape survives the column promotion", () => {
  const row: LeadWorklistRow = {
    id: "id-0001",
    name: "Person 1",
    phone: "9800000001",
    city: null,
    state: null,
    source: "Legacy Sheet",
    campaign: "SSC-2023-Batch",
    campaign_clean: "ssc 2023 batch",
    legacy_source_tab: "FB LEADS",
    status: "Not Replied",
    created_at: "2026-07-22T05:05:16.405Z",
    counsellor: null,
    assigned_to: null,
    worklist_queue: null,
    follow_up_at: null,
    last_worked_at: null,
    consent_status: "unknown",
    dnd_status: null,
    last_contacted_at: null,
    contact_attempt_count: 0,
    suppression_reason: null,
    cohort: "legacy_promoted",
    is_legacy: true,
    legacy_call_status: "Not Replied",
    legacy_call_status_raw: "Not Replied ",
    work_status: null,
    work_status_at: null,
    work_status_by: null,
    import_batch: "legacy_2026_07_21",
    first_seen_at: "2026-07-22T05:05:16.405Z",
    promoted_at: null,
  };

  it("still exposes campaign and campaign_clean", () => {
    const r = row as unknown as Record<string, unknown>;
    assert.ok("campaign" in r && "campaign_clean" in r);
    assert.equal(row.campaign_clean, "ssc 2023 batch");
    assert.equal(row.legacy_source_tab, "FB LEADS");
  });

  it("has no utm_* surface at all", () => {
    // utm_campaign is set on 4 of 178,183 legacy rows and gclid on 0. A
    // segment builder wired to UTM returns an empty set for the entire legacy
    // universe while looking perfectly healthy.
    const r = row as unknown as Record<string, unknown>;
    for (const banned of ["utm_campaign", "utm_source", "utm_medium", "utm_content", "utm_term", "gclid"]) {
      assert.ok(!(banned in r), `${banned} must not be the worklist's campaign source`);
    }
  });

  it("never carries the attribution blob", () => {
    // The whole point of the slimming. Bulk-reading it cost ~13.2 s.
    assert.ok(!("attribution" in (row as unknown as Record<string, unknown>)));
  });

  it("carries is_legacy so the UI need not re-derive the boundary", () => {
    assert.equal(row.is_legacy, true);
    assert.equal(hasLegacyFlag(row as unknown as Leadish), true);
  });

  it("keeps cohort and is_legacy as distinct fields", () => {
    // cohort is frozen at classification time; is_legacy is the live
    // boundary. They agree today, but conflating them would re-open the
    // 110-row reclassification hazard.
    const live = { ...row, cohort: "live_captured" as const, is_legacy: false };
    assert.notEqual(live.cohort, row.cohort);
    assert.equal(hasLegacyFlag(live as unknown as Leadish), false);
  });
});
