/**
 * Single source of truth for "is this lead a legacy-imported row?" — every one
 * of the 7 legacy-aware call sites from the Phase 1 plan §4 delegates here so
 * the predicate can never drift between the CRM Kanban, source card, analytics
 * aggregator, and (critically) the SMS bulk audiences.
 *
 * A row is LEGACY iff `attribution.legacy === true`. `channel_legacy` /
 * `import_source` / `import_batch` are additional evidence but not authoritative —
 * only the JSONB flag is checked. That way a partial patch (e.g. a row with
 * `channel_legacy` set but `attribution.legacy` unset) fails HONEST-open (visible
 * as a normal lead) rather than silently disappearing from the CRM.
 */

import type { Lead, LeadCohort } from "../types";

// =====================================================================
// CANONICAL LEGACY-VS-LIVE BOUNDARY
// =====================================================================
// ONE definition, used by the CRM, the worklist, every analytical count,
// and every index predicate:
//
//     legacy  ==  (attribution ->> 'legacy') = 'true'
//
// THE NULL TRAP (this has already produced one confidently-wrong result)
// ----------------------------------------------------------------------
// In SQL, `(attribution->>'legacy') = 'true'` evaluates to NULL — not
// false — for any row where `attribution` is NULL or lacks the key. NULL
// is not true, so such rows are dropped by BOTH `= 'true'` and
// `<> 'true'`. Bucketing with those two predicates therefore silently
// loses rows and the two buckets do not sum to the table total.
//
// Hand-written analytical SQL MUST use `IS DISTINCT FROM 'true'` for the
// non-legacy side, and every count that is printed MUST assert
// legacy + non_legacy = total.
//
// THE TENSION WITH INDEX PREDICATES — and how it is resolved
// ----------------------------------------------------------------------
// `IS DISTINCT FROM` is correct in analytical SQL but WRONG in a partial
// index predicate that the app reaches through a PostgREST `.or(...)`
// filter: the planner cannot prove the two equivalent, silently picks a
// wider index, and the query went from 285 ms to 65,171 ms when we tried
// it. So:
//
//   * hand-written analytical SQL  -> `IS DISTINCT FROM 'true'`
//   * PostgREST filters + the index predicates that must match them
//                                  -> the three-arm OR / plain equality
//                                     spelled out below
//
// These two forms select exactly the same rows. They are spelled
// differently on purpose, and the constants below are the only place
// that spelling should ever be written.

/**
 * The exact PostgREST `.or()` argument selecting NON-LEGACY rows. Must stay
 * character-identical to the predicate of `idx_leads_active_nonlegacy_created`
 * or that index stops being chosen.
 *
 * STILL LOAD-BEARING after the `is_legacy` promotion. The live CRM read
 * (`getLeads`) deliberately still fires this filter against the untouched
 * `idx_leads_active_nonlegacy_created`, because that path's plan is a
 * non-negotiable invariant of the Phase 1 ship. See
 * `LEADS_IS_LEGACY_COLUMN` for the form new readers use.
 */
export const NON_LEGACY_POSTGREST_OR =
  "attribution.is.null,attribution->>legacy.is.null,attribution->>legacy.neq.true";

/** PostgREST column/operator/value triple selecting LEGACY-ONLY rows. */
export const LEGACY_POSTGREST_FILTER = {
  column: "attribution->>legacy",
  operator: "eq",
  value: "true",
} as const;

// =====================================================================
// THE PROMOTED COLUMN — what new readers should use
// =====================================================================
// `public.leads.is_legacy` is a real `boolean NOT NULL DEFAULT false`,
// backfilled 2026-07-24 from `attribution->>'legacy'` and reconciled
// row-for-row against it (178,183 legacy / 1,310 non-legacy / 179,493
// total, zero disagreements) before any reader was switched.
//
// Because it is NOT NULL, `is_legacy` and `NOT is_legacy` are a TOTAL,
// EXACT partition of the table. That is the whole point: the two
// spellings above exist only because the JSONB expression is
// three-valued. On the column there is no NULL arm, so analytical SQL
// and index predicates can use the same expression, and a partial index
// `WHERE ... AND is_legacy` is trivially planner-selectable.
//
// The JSONB `legacy` key is deliberately RETAINED as the write-side
// flag; `trg_leads_sync_legacy_columns` derives the column from it on
// every insert/update of `attribution`, so the two can never drift and
// either side can be rebuilt from the other.

/** The promoted boolean column. Prefer this over the JSONB spellings. */
export const LEADS_IS_LEGACY_COLUMN = "is_legacy" as const;

/** PostgREST triple selecting LEGACY-ONLY rows via the promoted column. */
export const LEGACY_COLUMN_FILTER = {
  column: "is_legacy",
  operator: "is",
  value: true,
} as const;

/** PostgREST triple selecting NON-LEGACY rows via the promoted column. */
export const NON_LEGACY_COLUMN_FILTER = {
  column: "is_legacy",
  operator: "is",
  value: false,
} as const;

/** The three counts any legacy/non-legacy split must produce. */
export interface LegacyBucketCounts {
  legacy: number;
  nonLegacy: number;
  total: number;
}

/**
 * Assert that a legacy/non-legacy split actually partitions its population.
 *
 * This exists because the JSONB predicate silently failed to. With
 * `(attribution->>'legacy') = 'true'` for one bucket and `<> 'true'` for the
 * other, rows lacking the key fall out of BOTH — the counts look plausible
 * and simply do not add up. Two published numbers in this program were wrong
 * for exactly that reason.
 *
 * `is_legacy boolean NOT NULL` makes the partition total by construction, so
 * this is now a cheap regression guard rather than a workaround: any future
 * reader that reintroduces a three-valued predicate trips it. Every printed
 * bucket count should be run through here.
 *
 * Returns the counts unchanged so it can wrap a call site inline.
 */
export function assertLegacyBucketsReconcile(
  counts: LegacyBucketCounts,
  context = "legacy bucket split",
): LegacyBucketCounts {
  const { legacy, nonLegacy, total } = counts;
  for (const [label, n] of [["legacy", legacy], ["nonLegacy", nonLegacy], ["total", total]] as const) {
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`${context}: ${label} must be a non-negative integer, got ${String(n)}`);
    }
  }
  if (legacy + nonLegacy !== total) {
    throw new Error(
      `${context}: buckets do not reconcile — ${legacy} legacy + ${nonLegacy} non-legacy = ` +
        `${legacy + nonLegacy}, expected ${total}. This is the JSONB NULL trap: a row whose ` +
        `'legacy' key is absent satisfies neither = 'true' nor <> 'true'.`,
    );
  }
  return counts;
}

/**
 * Canonical cohort for a lead. FROZEN at classification time and stored in
 * `leads.cohort` — never recomputed on read, and deliberately not a Postgres
 * GENERATED column, because a later edit to `attribution` would otherwise
 * reclassify the lead and move it between historical reporting buckets.
 *
 * THE 110 AMBIGUOUS ROWS
 * ----------------------
 * 110 active rows carry `import_source = 'legacy_sheet'` but NOT
 * `attribution.legacy = true`. They are pre-existing LIVE leads that the
 * importer matched and enriched, not rows the import created. They are
 * `live_captured`, because they have always been counted as live in published
 * channel reporting and reclassifying them would retroactively rewrite those
 * numbers — exactly what a frozen cohort field exists to prevent.
 *
 * `cohort` answers "how did this lead enter the CRM as a countable lead", NOT
 * "did legacy data ever touch it". The legacy touch stays discoverable via
 * `import_source`.
 */
export function cohortForLead(lead: Pick<Lead, "attribution">): LeadCohort {
  return hasLegacyFlag(lead) ? "legacy_promoted" : "live_captured";
}

/** Public options bag threaded through every lead-fetching function. */
export interface LegacyOptions {
  /** Default false. When false, legacy-imported rows are hidden. */
  includeLegacy?: boolean;
}

/**
 * True when the row was created by the legacy backfill or the Sheets-sync cron.
 *
 * Reads the promoted `is_legacy` column when the row carries one, and falls
 * back to the JSONB flag otherwise. The fallback is not vestigial: fixtures,
 * `mock.leads`, and any narrow projection that does not select the column all
 * arrive here without it, and silently treating those as non-legacy would be
 * the "987 real leads vanish / 178k legacy leak" failure in miniature.
 *
 * Both branches agree on live data by construction — `is_legacy` was
 * reconciled row-for-row against the JSONB key before cutover and is kept in
 * step by `trg_leads_sync_legacy_columns`.
 */
export function hasLegacyFlag(lead: Pick<Lead, "attribution"> & { is_legacy?: boolean | null }): boolean {
  if (typeof lead.is_legacy === "boolean") return lead.is_legacy;
  const a = lead.attribution as unknown;
  if (!a || typeof a !== "object") return false;
  const legacy = (a as { legacy?: unknown }).legacy;
  // Accept boolean true OR the string "true" — the Postgres JSONB round-trip
  // preserves booleans, but any SQL-side setter (`jsonb_set(..., 'true')`)
  // materializes it as a string; treat both as the same tag.
  return legacy === true || legacy === "true";
}

/**
 * Drop legacy rows from a plain JS array. Preserves order. Safe to call with an
 * empty array or `undefined`; returns [] in both cases.
 */
export function excludeLegacy<T extends Pick<Lead, "attribution">>(rows: T[] | null | undefined): T[] {
  if (!rows || rows.length === 0) return [];
  return rows.filter((r) => !hasLegacyFlag(r));
}

/**
 * Apply the includeLegacy contract to an already-fetched list. When the caller
 * opts in via `{ includeLegacy: true }` the list is returned as-is; otherwise
 * legacy rows are dropped. Used at every entry point that returns leads to the
 * CRM, dashboards, SMS audiences, and campaign analytics.
 */
export function applyLegacyFilter<T extends Pick<Lead, "attribution">>(
  rows: T[] | null | undefined,
  opts?: LegacyOptions,
): T[] {
  if (opts?.includeLegacy) return rows ? [...rows] : [];
  return excludeLegacy(rows);
}
