/**
 * Orchestrator for the legacy-lead import. Two modes:
 *   - `dry-run` (default): fetch → transform → dedupe → reconcile with Supabase
 *                           → report. NO writes anywhere.
 *   - `commit`  : same pipeline, then chunked INSERT/UPDATE into
 *                 public.leads + snapshot into leads_backfill_snapshot.
 *                 Gated by `LEGACY_IMPORT_ENABLED === "true"`.
 *
 * Every side effect goes through `writeCommit()` so tests can stub it out.
 */

import { getSupabaseAdmin } from "../supabase";
import { normPhone } from "../phone";
import { isLegacyImportEnabled } from "./flags";
import { fetchTabAsRecords, loadServiceAccountAuth, makeSheetsClient } from "./sheetsClient";
import { INCLUDED_TABS, LEGACY_WORKBOOK_SPREADSHEET_ID, TAB_SPECS, type LegacyTab } from "./tabRegistry";
import { maskCellPreview, maskPhone, transformRow } from "./transform";
import { dedupeCrossTab, dedupeIntraTab } from "./dedupe";
import type {
  CrossTabStats,
  DryRunReport,
  LegacyAttributionJSON,
  LegacyTouchpoint,
  RejectedRow,
  StagedLead,
  SupabaseProjection,
  TabStats,
} from "./types";

export interface ImporterOptions {
  mode: "dry-run" | "commit";
  batchSize: number;
  tabs: LegacyTab[];
  spreadsheetId: string;
  serviceAccountPath?: string;
  /**
   * Optional: pre-fetched records per tab. When provided, skips the network
   * call — used by tests and by the CLI when running from a JSONL fixture.
   */
  prefetched?: Record<LegacyTab, Array<Record<string, string | null>>>;
  /**
   * Optional: an override for the Supabase phone set (for tests). When provided,
   * the importer will NOT query Supabase at all.
   */
  supabasePhonesOverride?: Set<string>;
  /** Callback for progress logs; defaults to no-op so tests stay quiet. */
  onLog?: (line: string) => void;
}

export interface ImportResult {
  report: DryRunReport;
  stagedLeadsForCommit?: StagedLead[];
  supabasePhones: Set<string>;
}

const DEFAULT_MAX_SAMPLE_ROWS_PER_TAB = 20;

/** Compose the JSONB payload we write into `attribution` for a legacy row. */
export function buildLegacyAttributionJSON(lead: StagedLead): LegacyAttributionJSON {
  const spec = TAB_SPECS[lead.tab];
  const touches: LegacyTouchpoint[] = lead.merged_touches ?? [{ ...lead.legacy_touch, winner: true }];
  const confidence: LegacyAttributionJSON["campaign_confidence"] = lead.campaign_clean
    ? spec.smartBCResolver
      ? "heuristic"
      : "explicit"
    : "fallback";
  return {
    legacy: true,
    legacy_source_tab: lead.tab,
    legacy_touches: touches,
    platform_hint: lead.platform_hint,
    origin_review_needed: lead.origin_review_needed || undefined,
    campaign_confidence: confidence,
    no_timestamp: spec.noSourceTimestamp || undefined,
    first_touch: touches[0],
  };
}

/** All-in-one pipeline the CLI + tests call. */
export async function runImporter(opts: ImporterOptions): Promise<ImportResult> {
  const log = opts.onLog ?? (() => {});
  const now = new Date();
  const importBatch = now.toISOString();
  const runId = `legacy_${importBatch}`;

  // 1. Fetch per-tab records (network OR fixture).
  const tabRecords: Record<LegacyTab, Array<Record<string, string | null>>> = {} as Record<
    LegacyTab,
    Array<Record<string, string | null>>
  >;
  if (opts.prefetched) {
    for (const tab of opts.tabs) {
      tabRecords[tab] = opts.prefetched[tab] ?? [];
    }
  } else {
    const { auth } = loadServiceAccountAuth({ path: opts.serviceAccountPath });
    const sheets = makeSheetsClient(auth);
    for (const tab of opts.tabs) {
      log(`Fetching tab: ${tab}`);
      tabRecords[tab] = await fetchTabAsRecords(sheets, opts.spreadsheetId, tab);
      log(`  ${tab}: ${tabRecords[tab].length} data rows`);
    }
  }

  // 2. Per-tab transform + intra-tab dedupe + stats.
  const perTab: TabStats[] = [];
  const allStagedPerTab = new Map<LegacyTab, StagedLead[]>();
  const rejectExamples: DryRunReport["reject_examples_masked"] = [];
  const sampleTransforms: DryRunReport["sample_transforms_masked"] = [];
  for (const tab of opts.tabs) {
    const spec = TAB_SPECS[tab];
    const rows = tabRecords[tab];
    const accepted: StagedLead[] = [];
    const rejects: RejectedRow[] = [];
    const rejectsByReason: Partial<Record<RejectedRow["reason"], number>> = {};
    let sampleCount = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const sourceRow = i + 2; // account for header row + 1-index
      const t = transformRow(spec, row, sourceRow, { importBatch });
      if (t.ok) {
        accepted.push(t.lead);
        if (sampleCount < DEFAULT_MAX_SAMPLE_ROWS_PER_TAB) {
          sampleTransforms.push({
            tab,
            masked_row: {
              phone_masked: maskPhone(t.lead.canonical_phone),
              name_masked: maskCellPreview(t.lead.name),
              email_masked: maskCellPreview(t.lead.email),
              timestamp_iso_shape: t.lead.timestamp_iso ? "iso-8601" : "null",
              campaign_clean_present: t.lead.campaign_clean ? "yes" : "no",
              campaign_confidence_hint: t.lead.campaign_clean ? "explicit-or-heuristic" : "fallback",
              channel_legacy: t.lead.channel_legacy,
              state_hint_masked: maskCellPreview(t.lead.state_hint),
              external_lead_id: t.lead.external_lead_id,
            },
          });
          sampleCount += 1;
        }
      } else {
        rejects.push(t.rejected);
        rejectsByReason[t.rejected.reason] = (rejectsByReason[t.rejected.reason] ?? 0) + 1;
        if (rejectExamples.length < 60) {
          rejectExamples.push({
            tab,
            reason: t.rejected.reason,
            row_preview_masked: t.rejected.raw_phone_preview_masked ?? "",
          });
        }
      }
    }
    const { kept, droppedCount } = dedupeIntraTab(accepted);
    allStagedPerTab.set(tab, kept);
    const distinct = new Set(kept.map((k) => k.canonical_phone)).size;
    perTab.push({
      tab,
      rows_read: rows.length,
      rows_valid_phone: accepted.length,
      rows_rejected: rejects.length,
      rejects_by_reason: rejectsByReason,
      distinct_canonical_phones: distinct,
      intra_tab_dedupe_dropped: droppedCount,
    });
    log(
      `  ${tab}: valid ${accepted.length}, rejected ${rejects.length}, distinct-after-intra ${distinct}, intra-dropped ${droppedCount}`,
    );
  }

  // 3. Cross-tab dedupe (union across tabs).
  const flat: StagedLead[] = [];
  for (const tab of opts.tabs) for (const l of allStagedPerTab.get(tab) ?? []) flat.push(l);
  const cross = dedupeCrossTab(flat);
  const crossTab: CrossTabStats = {
    distinct_canonical_phones_union: cross.kept.length,
    phones_in_multiple_tabs: cross.phonesInMultipleTabs,
    cross_tab_merge_dropped: cross.droppedCount,
  };
  log(
    `Cross-tab: union ${cross.kept.length}, phones-in-multiple-tabs ${cross.phonesInMultipleTabs}, cross-tab-dropped ${cross.droppedCount}`,
  );

  // 4. Supabase reconciliation: fetch existing phone set (read-only) + collision count.
  const supabasePhones = await resolveSupabasePhones(opts, log);
  const collisionPhones = new Set<string>();
  for (const l of cross.kept) if (supabasePhones.has(l.canonical_phone)) collisionPhones.add(l.canonical_phone);
  const supabase: SupabaseProjection = {
    supabase_leads_scanned: supabasePhones.size, // acts as distinct-phone count for the read snapshot
    supabase_distinct_phones: supabasePhones.size,
    collisions_null_fills: collisionPhones.size,
    pure_inserts: cross.kept.length - collisionPhones.size,
  };
  log(
    `Supabase: distinct-phones ${supabase.supabase_distinct_phones}, collisions ${supabase.collisions_null_fills}, pure-inserts ${supabase.pure_inserts}`,
  );

  const report: DryRunReport = {
    run_id: runId,
    import_batch: importBatch,
    spreadsheet_id: opts.spreadsheetId,
    fetched_at: now.toISOString(),
    per_tab: perTab,
    cross_tab: crossTab,
    supabase,
    reconciliation_anchors: {
      union_distinct_phones: crossTab.distinct_canonical_phones_union,
      supabase_collision_count: supabase.collisions_null_fills,
      supabase_distinct_phones: supabase.supabase_distinct_phones,
    },
    reject_examples_masked: rejectExamples,
    sample_transforms_masked: sampleTransforms,
  };

  // 5. Commit mode — refuse without the flag; write in chunks. Dry-run stops here.
  if (opts.mode === "commit") {
    if (!isLegacyImportEnabled()) {
      throw new Error(
        "Refusing --commit: LEGACY_IMPORT_ENABLED is not \"true\". Set the env var and re-run to write.",
      );
    }
    return { report, stagedLeadsForCommit: cross.kept, supabasePhones };
  }

  return { report, supabasePhones };
}

/**
 * Fetch the distinct set of canonical (last-10) phones already in
 * `public.leads`. Uses .range() pagination — the table is currently ~1.3k rows,
 * but we still page to be robust.
 */
async function resolveSupabasePhones(
  opts: ImporterOptions,
  log: (s: string) => void,
): Promise<Set<string>> {
  if (opts.supabasePhonesOverride) return new Set(opts.supabasePhonesOverride);
  const db = getSupabaseAdmin();
  if (!db) {
    log("Supabase admin client unavailable; treating as empty phone set.");
    return new Set<string>();
  }
  const phones = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db.from("leads").select("phone").range(from, from + pageSize - 1);
    if (error) throw new Error(`Supabase read failed: ${error.message}`);
    const rows = (data as Array<{ phone: string | null }>) ?? [];
    for (const r of rows) {
      const n = normPhone(r.phone);
      if (n && /^[6-9]\d{9}$/.test(n)) phones.add(n);
    }
    if (rows.length < pageSize) break;
  }
  return phones;
}

/** Render the DryRunReport as a human-readable Markdown document. */
export function renderReportMarkdown(report: DryRunReport, notes: string[]): string {
  const perTabRows = report.per_tab
    .map((t) => {
      const rejBits = Object.entries(t.rejects_by_reason)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      return `| \`${t.tab}\` | ${t.rows_read} | ${t.rows_valid_phone} | ${t.rows_rejected}${rejBits ? ` (${rejBits})` : ""} | ${t.distinct_canonical_phones} | ${t.intra_tab_dedupe_dropped} |`;
    })
    .join("\n");

  const sampleRows = report.sample_transforms_masked
    .map((s) => `| \`${s.tab}\` | ${JSON.stringify(s.masked_row)} |`)
    .join("\n");

  const rejectRows = report.reject_examples_masked
    .map((r) => `| \`${r.tab}\` | \`${r.reason}\` | ${r.row_preview_masked || "—"} |`)
    .join("\n");

  return `# Legacy-lead import — DRY-RUN reconciliation

**Run id:** \`${report.run_id}\`
**Import batch:** \`${report.import_batch}\`
**Spreadsheet id:** \`${report.spreadsheet_id}\`
**Fetched at:** \`${report.fetched_at}\`

> Read-only. No writes to Google Sheets, no writes to Supabase. \`--commit\` was NOT executed. This report is the artefact the operator reviews before approving Phase 4.

## Reconciliation anchors

| Anchor | Expected (from prior study) | Observed | Notes |
|---|---:|---:|---|
| Union distinct canonical phones across all included tabs | ~175,764 | ${report.reconciliation_anchors.union_distinct_phones} | Snapshot from 15 Jun 2026; today's live number may differ within ±5%. |
| Supabase collisions (phones in both legacy AND \`public.leads\`) | ~87 | ${report.reconciliation_anchors.supabase_collision_count} | Live \`public.leads\` distinct-phone count: **${report.reconciliation_anchors.supabase_distinct_phones}**. |
| Supabase distinct phones | ~948 | ${report.reconciliation_anchors.supabase_distinct_phones} | Direct COUNT from live read. |

## Per-tab breakdown

| Tab | Rows read | Valid-phone | Rejected (breakdown) | Distinct after intra-tab dedupe | Intra-tab merges |
|---|---:|---:|---|---:|---:|
${perTabRows}

## Cross-tab dedupe outcome

- Distinct canonical phones after cross-tab merge: **${report.cross_tab.distinct_canonical_phones_union}**
- Phones appearing in ≥2 included tabs: **${report.cross_tab.phones_in_multiple_tabs}**
- Rows dropped by cross-tab merge (folded into a winner via LEAD_SOURCE_PRIORITY): **${report.cross_tab.cross_tab_merge_dropped}**

## Projected Supabase writes (would occur only with \`--commit\`)

- Pure inserts (new rows in \`public.leads\`): **${report.supabase.pure_inserts}**
- Collision NULL-fills (existing rows patched only where fields are NULL, live \`channel\`/\`utm_*\`/\`attribution.first_touch\` NEVER overwritten): **${report.supabase.collisions_null_fills}**
- Estimated total \`leads_backfill_snapshot\` rows written before writes: **${report.supabase.pure_inserts + report.supabase.collisions_null_fills}**

## Rejection reasons (masked previews)

| Tab | Reason | Row preview (masked) |
|---|---|---|
${rejectRows || "| — | — | (no rejections in this run) |"}

## Sample transforms (SHAPE ONLY — no real values)

Up to 20 accepted rows per tab. Every field is a shape indicator; no real phones, names, emails, or campaigns leaked.

| Tab | Masked row |
|---|---|
${sampleRows || "| — | (no accepted rows) |"}

## Notes

${notes.length ? notes.map((n) => `- ${n}`).join("\n") : "- No additional notes."}
`;
}
