/**
 * Phase 2B — ongoing Google Sheets sync scaffold. Reuses the same transformer +
 * dedupe helpers as the one-time importer so drift between "backfill" and
 * "ongoing feed" is impossible.
 *
 * NOT ACTIVE in production. The route handler at /api/cron/legacy-sheets-sync
 * short-circuits to 501 unless SHEETS_SYNC_ENABLED=true. Even then, the sync
 * updates the watermark in `legacy_import_sync_state` but never fires
 * `lead_created` events — legacy rows arriving via SHEET (not the portal's own
 * forms) MUST NOT trigger the Journey Automation, or a 175k-phone mass send is
 * one flag flip away.
 */

import { getSupabaseAdmin } from "../supabase";
import { INCLUDED_TABS, LEGACY_WORKBOOK_SPREADSHEET_ID, TAB_SPECS, type LegacyTab } from "./tabRegistry";
import { fetchTabAsRecords, loadServiceAccountAuth, makeSheetsClient } from "./sheetsClient";
import { transformRow } from "./transform";
import { dedupeCrossTab, dedupeIntraTab } from "./dedupe";
import { buildLegacyAttributionJSON } from "./importer";
import type { StagedLead } from "./types";

export interface SheetsSyncOutcome {
  tab: LegacyTab;
  rows_new: number;
  rows_written: number;
  rows_skipped_existing_phone: number;
  last_row_index: number;
  error?: string;
}

/** Read the current watermark for one tab; returns 0 if never synced. */
async function getWatermark(spreadsheetId: string, tab: LegacyTab): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) return 0;
  const { data } = await db
    .from("legacy_import_sync_state")
    .select("last_row_index")
    .eq("spreadsheet_id", spreadsheetId)
    .eq("tab_name", tab)
    .maybeSingle();
  const row = data as { last_row_index?: number } | null;
  return row?.last_row_index ?? 0;
}

async function setWatermark(spreadsheetId: string, tab: LegacyTab, nextIndex: number): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.from("legacy_import_sync_state").upsert({
    spreadsheet_id: spreadsheetId,
    tab_name: tab,
    last_row_index: nextIndex,
    last_synced_at: new Date().toISOString(),
    last_error: null,
  });
}

/**
 * Sync one tab. Reads rows after `watermark`, applies the exact same transform
 * as the one-time importer, upserts. Idempotent: re-running immediately after
 * a successful pass finds no new rows and no-ops.
 *
 * NOTE: This helper is intentionally called only from the /api/cron/legacy-sheets-sync
 * route. Do NOT call it from anywhere else — the watermark is a single-writer contract.
 */
export async function syncOneTab(
  tab: LegacyTab,
  opts?: { spreadsheetId?: string; serviceAccountPath?: string },
): Promise<SheetsSyncOutcome> {
  const spreadsheetId = opts?.spreadsheetId ?? LEGACY_WORKBOOK_SPREADSHEET_ID;
  const spec = TAB_SPECS[tab];
  const { auth } = loadServiceAccountAuth({ path: opts?.serviceAccountPath });
  const sheets = makeSheetsClient(auth);

  const watermark = await getWatermark(spreadsheetId, tab);
  const allRows = await fetchTabAsRecords(sheets, spreadsheetId, tab);
  const newRows = allRows.slice(watermark);
  if (newRows.length === 0) return { tab, rows_new: 0, rows_written: 0, rows_skipped_existing_phone: 0, last_row_index: allRows.length };

  const staged: StagedLead[] = [];
  for (let i = 0; i < newRows.length; i++) {
    const sourceRow = watermark + i + 2; // +2 for header row & 1-index
    const t = transformRow(spec, newRows[i], sourceRow, { importBatch: new Date().toISOString() });
    if (t.ok) staged.push(t.lead);
  }
  const { kept: intra } = dedupeIntraTab(staged);
  const { kept: final } = dedupeCrossTab(intra);

  const db = getSupabaseAdmin();
  if (!db) {
    return {
      tab,
      rows_new: newRows.length,
      rows_written: 0,
      rows_skipped_existing_phone: 0,
      last_row_index: allRows.length,
      error: "no-supabase-admin",
    };
  }

  const insertRows: Array<Record<string, unknown>> = [];
  for (const s of final) {
    // Skip if phone already exists to preserve first-touch. The one-time importer's
    // collision NULL-fill semantics are heavier-weight than we want here.
    const { count } = await db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .ilike("phone", `%${s.canonical_phone}`);
    if ((count ?? 0) > 0) continue;
    const id = cryptoRandomId();
    insertRows.push({
      id,
      name: s.name ?? "Legacy Lead",
      phone: s.canonical_phone,
      source: s.channel_legacy,
      campaign: s.campaign_clean,
      status: "New",
      temperature: "Cold",
      created_at: s.timestamp_iso ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
      sources: [{ source: s.channel_legacy, campaign: s.campaign_clean, at: s.timestamp_iso ?? new Date().toISOString(), lead_id: id }],
      first_source: s.channel_legacy,
      first_campaign: s.campaign_clean,
      merged_count: 0,
      channel_legacy: s.channel_legacy,
      import_source: "sheets_sync",
      import_batch: new Date().toISOString(),
      external_lead_id: `${spreadsheetId}:${tab}:${s.source_row}`,
      first_seen_at: s.timestamp_iso,
      attribution: buildLegacyAttributionJSON(s),
    });
  }

  if (insertRows.length > 0) {
    const { error } = await db.from("leads").insert(insertRows);
    if (error) {
      await db.from("legacy_import_sync_state").upsert({
        spreadsheet_id: spreadsheetId,
        tab_name: tab,
        last_row_index: watermark, // do NOT advance watermark on failure
        last_synced_at: new Date().toISOString(),
        last_error: error.message,
      });
      return {
        tab,
        rows_new: newRows.length,
        rows_written: 0,
        rows_skipped_existing_phone: 0,
        last_row_index: watermark,
        error: error.message,
      };
    }
  }

  await setWatermark(spreadsheetId, tab, allRows.length);
  return {
    tab,
    rows_new: newRows.length,
    rows_written: insertRows.length,
    rows_skipped_existing_phone: staged.length - insertRows.length,
    last_row_index: allRows.length,
  };
}

/** Sync every included tab in a fixed order (priority order). Used by the cron. */
export async function syncAllTabs(opts?: { spreadsheetId?: string }): Promise<SheetsSyncOutcome[]> {
  const outcomes: SheetsSyncOutcome[] = [];
  for (const tab of INCLUDED_TABS) {
    try {
      outcomes.push(await syncOneTab(tab, opts));
    } catch (err) {
      outcomes.push({
        tab,
        rows_new: 0,
        rows_written: 0,
        rows_skipped_existing_phone: 0,
        last_row_index: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return outcomes;
}

function cryptoRandomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `legacy-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }
}
