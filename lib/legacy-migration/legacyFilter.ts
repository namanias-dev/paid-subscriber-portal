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

import type { Lead } from "../types";

/** Public options bag threaded through every lead-fetching function. */
export interface LegacyOptions {
  /** Default false. When false, legacy-imported rows are hidden. */
  includeLegacy?: boolean;
}

/** True when the row was created by the legacy backfill or the Sheets-sync cron. */
export function hasLegacyFlag(lead: Pick<Lead, "attribution">): boolean {
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
