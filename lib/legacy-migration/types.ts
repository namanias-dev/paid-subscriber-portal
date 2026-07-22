/**
 * Type surface shared by the legacy-migration importer, the Phase 2B Sheets
 * sync route, and the tests.
 *
 * The types are intentionally structural — the JSONB shape in Postgres has to
 * be legible to hand-written analytics SQL, so we prefer plain snake_case
 * property names and no discriminated unions.
 */

import type { LegacyTab } from "./tabRegistry";

/** One row exactly as pulled from Google Sheets, keyed by header. */
export type RawSheetRow = Record<string, string | null>;

/** A legacy touchpoint we stamp onto attribution.legacy_touches[]. */
export interface LegacyTouchpoint {
  tab: LegacyTab;
  /** ISO-8601. Undefined only for the Google Ads tab (no timestamp). */
  lead_timestamp?: string;
  campaign_raw?: string | null;
  campaign_clean?: string | null;
  source_type?: string | null;
  form_name?: string | null;
  platform_hint?: string | null;
  calling_status_raw?: string | null;
  /** 1-indexed row number in the source tab (for debugging + rollback lookup). */
  source_row?: number;
  /** True when this touch was itself the winner during intra-/cross-tab dedupe. */
  winner?: boolean;
}

/** The complete JSONB payload we write to `leads.attribution` for a legacy row. */
export interface LegacyAttributionJSON {
  legacy: true;
  legacy_source_tab: LegacyTab;
  legacy_touches: LegacyTouchpoint[];
  platform_hint?: string | null;
  origin_review_needed?: boolean;
  campaign_confidence?: "explicit" | "heuristic" | "fallback";
  no_timestamp?: boolean;
  first_touch?: LegacyTouchpoint;
}

/** Reject reason enum — every reason is enumerated so the report can count them. */
export type RejectReason =
  | "empty_row"
  | "no_phone_column_value"
  | "phone_not_indian_mobile"
  | "phone_extractor_no_match"
  | "phone_normalize_failed";

/** One accepted, transformed row — ready for dedupe. */
export interface StagedLead {
  canonical_phone: string;
  tab: LegacyTab;
  source_row: number;
  timestamp_iso: string | null;
  name: string | null;
  email: string | null;
  city_hint: string | null;
  state_hint: string | null;
  campaign_raw: string | null;
  campaign_clean: string | null;
  channel_legacy: string;
  platform_hint: string | null;
  status_raw: string | null;
  calling_status_raw: string | null;
  origin_review_needed: boolean;
  external_lead_id: string;
  legacy_touch: LegacyTouchpoint;
  /** Priority number from LEAD_SOURCE_PRIORITY — cached to avoid a lookup per cross-tab compare. */
  priority: number;
  /**
   * Populated only after intra-tab / cross-tab dedupe. When present, this array
   * IS the future `attribution.legacy_touches[]` — winner at index 0, losers
   * appended in the order they merged in.
   */
  merged_touches?: LegacyTouchpoint[];
}

/** One rejected row — kept for the report; NOT written anywhere. */
export interface RejectedRow {
  tab: LegacyTab;
  source_row: number;
  reason: RejectReason;
  raw_phone_preview_masked: string | null;
}

/** Per-tab counters emitted in the dry-run report. */
export interface TabStats {
  tab: LegacyTab;
  rows_read: number;
  rows_valid_phone: number;
  rows_rejected: number;
  rejects_by_reason: Partial<Record<RejectReason, number>>;
  distinct_canonical_phones: number;
  intra_tab_dedupe_dropped: number;
}

/** Cross-tab dedupe outcome. */
export interface CrossTabStats {
  distinct_canonical_phones_union: number;
  phones_in_multiple_tabs: number;
  cross_tab_merge_dropped: number;
}

/** Supabase collision + insert projection. */
export interface SupabaseProjection {
  supabase_leads_scanned: number;
  supabase_distinct_phones: number;
  collisions_null_fills: number;
  pure_inserts: number;
}

/** Final composite report structure — serialized to the .md report. */
export interface DryRunReport {
  run_id: string;
  import_batch: string;
  spreadsheet_id: string;
  fetched_at: string;
  per_tab: TabStats[];
  cross_tab: CrossTabStats;
  supabase: SupabaseProjection;
  reconciliation_anchors: {
    union_distinct_phones: number;
    supabase_collision_count: number;
    supabase_distinct_phones: number;
  };
  reject_examples_masked: Array<{ tab: LegacyTab; reason: RejectReason; row_preview_masked: string }>;
  sample_transforms_masked: Array<{ tab: LegacyTab; masked_row: Record<string, string | null> }>;
}
