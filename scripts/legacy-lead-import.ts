#!/usr/bin/env tsx
/**
 * Legacy-lead import CLI. Invoked manually.
 *
 * Usage:
 *   npx tsx scripts/legacy-lead-import.ts --dry-run \
 *     --service-account-path=/absolute/path/to/service_account.json
 *
 *   # Once the operator has reviewed the dry-run report and set
 *   #   LEGACY_IMPORT_ENABLED=true
 *   #   GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON=<single-line-json-or-base64>
 *   # in the environment, run the write:
 *   LEGACY_IMPORT_ENABLED=true npx tsx scripts/legacy-lead-import.ts --commit --batch-size=500
 *
 * The dry-run runs regardless of any flag; only `--commit` is gated. Nothing in
 * this script writes to Google Sheets — reads only.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSupabaseAdmin } from "../lib/supabase";
import { isLegacyImportEnabled } from "../lib/legacy-migration/flags";
import { runImporter, renderReportMarkdown, buildLegacyAttributionJSON } from "../lib/legacy-migration/importer";
import { INCLUDED_TABS, LEGACY_WORKBOOK_SPREADSHEET_ID, type LegacyTab } from "../lib/legacy-migration/tabRegistry";
import type { StagedLead } from "../lib/legacy-migration/types";

interface CliOptions {
  mode: "dry-run" | "commit";
  batchSize: number;
  tabs: LegacyTab[];
  spreadsheetId: string;
  serviceAccountPath?: string;
  reportOutPath: string;
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  const has = (name: string) => args.some((a) => a === name || a.startsWith(`${name}=`));
  const val = (name: string): string | undefined => {
    const a = args.find((x) => x.startsWith(`${name}=`));
    return a ? a.slice(name.length + 1) : undefined;
  };
  const mode: "dry-run" | "commit" = has("--commit") ? "commit" : "dry-run";
  const batchSize = Math.max(50, Math.min(5000, Number(val("--batch-size") ?? "500") || 500));
  const rawTabs = val("--tabs");
  const tabs: LegacyTab[] = rawTabs
    ? (rawTabs.split(",").map((t) => t.trim()).filter(Boolean) as LegacyTab[])
    : ([...INCLUDED_TABS] as LegacyTab[]);
  for (const t of tabs) {
    if (!(INCLUDED_TABS as readonly string[]).includes(t)) {
      throw new Error(`Unknown tab: ${t}`);
    }
  }
  const reportOutPath = val("--report") ?? "docs/naman-ai/reports/lead-migration-dry-run.md";
  return {
    mode,
    batchSize,
    tabs,
    spreadsheetId: val("--spreadsheet-id") ?? LEGACY_WORKBOOK_SPREADSHEET_ID,
    serviceAccountPath: val("--service-account-path"),
    reportOutPath,
  };
}

function log(line: string): void {
  const stamp = new Date().toISOString();
  process.stdout.write(`[${stamp}] ${line}\n`);
}

/** Tiny .env parser — enough for the SUPABASE_* + GOOGLE_SHEETS_* keys the script needs. */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const body = readFileSync(path, "utf-8");
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

async function commitStagedLeads(staged: StagedLead[], batchSize: number, importBatch: string): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("Supabase admin client unavailable — cannot commit.");
  log(`Commit mode: ${staged.length} leads to write in chunks of ${batchSize}.`);

  // Fetch existing (id, phone, attribution) for every phone in the batch so we can distinguish
  // collision NULL-fills from pure inserts and snapshot the pre-state.
  const targetPhones = staged.map((s) => s.canonical_phone);
  const existingByPhone = new Map<string, { id: string; attribution: unknown; source: string | null; channel: string | null }>();
  const chunkFetch = 200;
  for (let i = 0; i < targetPhones.length; i += chunkFetch) {
    const chunk = targetPhones.slice(i, i + chunkFetch);
    const orFilter = chunk.map((v) => `phone.ilike.%${v}`).join(",");
    const { data, error } = await db.from("leads").select("id, phone, attribution, source, channel").or(orFilter);
    if (error) throw new Error(`Fetch existing leads failed: ${error.message}`);
    const rows = (data as Array<{ id: string; phone: string | null; attribution: unknown; source: string | null; channel: string | null }>) ?? [];
    for (const r of rows) {
      const last10 = (r.phone ?? "").replace(/\D/g, "").slice(-10);
      if (/^[6-9]\d{9}$/.test(last10) && !existingByPhone.has(last10)) {
        existingByPhone.set(last10, r);
      }
    }
  }

  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < staged.length; i += batchSize) {
    const chunk = staged.slice(i, i + batchSize);
    const insertRows: Array<Record<string, unknown>> = [];
    const snapshotRows: Array<Record<string, unknown>> = [];
    for (const s of chunk) {
      const attribution = buildLegacyAttributionJSON(s);
      const existing = existingByPhone.get(s.canonical_phone);
      if (existing) {
        const preState = existing.attribution;
        const mergedAttribution =
          preState && typeof preState === "object" && !Array.isArray(preState)
            ? { ...(preState as Record<string, unknown>), legacy_touches: attribution.legacy_touches, legacy: true, legacy_source_tab: attribution.legacy_source_tab }
            : attribution;
        const { error: uerr } = await db
          .from("leads")
          .update({ attribution: mergedAttribution, import_source: "legacy_sheet", import_batch: importBatch, external_lead_id: s.external_lead_id, channel_legacy: s.channel_legacy })
          .eq("id", existing.id);
        if (uerr) throw new Error(`Update failed for id=${existing.id}: ${uerr.message}`);
        snapshotRows.push({ id: existing.id, import_batch: importBatch, was_collision: true, pre_state: preState ?? null });
        updated += 1;
      } else {
        const id = cryptoRandomId();
        const createdAt = s.timestamp_iso ?? importBatch;
        insertRows.push({
          id,
          name: s.name ?? "Legacy Lead",
          phone: s.canonical_phone,
          city: s.city_hint,
          state: s.state_hint,
          source: s.channel_legacy,
          campaign: s.campaign_clean,
          course_interest: null,
          target_year: null,
          mode_pref: null,
          called: false,
          status: "New",
          temperature: "Cold",
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
          created_at: createdAt,
          updated_at: importBatch,
          sources: [{ source: s.channel_legacy, campaign: s.campaign_clean, at: createdAt, lead_id: id }],
          first_source: s.channel_legacy,
          first_campaign: s.campaign_clean,
          merged_count: 0,
          channel: null,
          channel_legacy: s.channel_legacy,
          import_source: "legacy_sheet",
          import_batch: importBatch,
          external_lead_id: s.external_lead_id,
          first_seen_at: s.timestamp_iso,
          attribution,
        });
        snapshotRows.push({ id, import_batch: importBatch, was_collision: false, pre_state: null });
      }
    }
    if (snapshotRows.length > 0) {
      const { error: serr } = await db.from("leads_backfill_snapshot").upsert(snapshotRows, { onConflict: "id" });
      if (serr) throw new Error(`Snapshot write failed: ${serr.message}`);
    }
    if (insertRows.length > 0) {
      const { error: ierr } = await db.from("leads").insert(insertRows);
      if (ierr) throw new Error(`Insert failed at chunk starting ${i}: ${ierr.message}`);
      inserted += insertRows.length;
    }
    log(`Committed chunk ${Math.floor(i / batchSize) + 1}: inserted so far ${inserted}, updated so far ${updated}`);
  }
  log(`Done. Inserted ${inserted}, updated ${updated}.`);
}

function cryptoRandomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `legacy-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  }
}

async function main(): Promise<void> {
  try {
    const here = fileURLToPath(import.meta.url);
    loadEnvFile(pathResolve(dirname(here), "../.env.local"));
    loadEnvFile(pathResolve(dirname(here), "../.env"));
  } catch {
    // No env files found — env vars may be set another way; do not fail here.
  }

  const opts = parseArgs(process.argv);
  log(`Mode: ${opts.mode}`);
  log(`Tabs: ${opts.tabs.join(", ")}`);
  log(`Spreadsheet: ${opts.spreadsheetId}`);
  if (opts.mode === "commit") {
    if (!isLegacyImportEnabled()) {
      throw new Error(
        "Refusing --commit: LEGACY_IMPORT_ENABLED is not \"true\". Set the env var and re-run to write.",
      );
    }
  }

  const result = await runImporter({
    mode: opts.mode,
    batchSize: opts.batchSize,
    tabs: opts.tabs,
    spreadsheetId: opts.spreadsheetId,
    serviceAccountPath: opts.serviceAccountPath,
    onLog: log,
  });

  const notes: string[] = [];
  if (opts.serviceAccountPath) {
    notes.push("Service-account key read from an ephemeral local path; NOT copied into the workspace, NOT logged.");
  }
  if (opts.mode === "commit") notes.push("`--commit` was executed — rollback: see the Phase 3 shipment report.");
  else notes.push("`--commit` was NOT executed. Zero writes were performed against Supabase in this run.");
  const md = renderReportMarkdown(result.report, notes);
  mkdirSync(dirname(opts.reportOutPath), { recursive: true });
  writeFileSync(opts.reportOutPath, md, "utf-8");
  log(`Report written: ${opts.reportOutPath}`);

  if (opts.mode === "commit" && result.stagedLeadsForCommit) {
    await commitStagedLeads(result.stagedLeadsForCommit, opts.batchSize, result.report.import_batch);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
  process.stderr.write(`[legacy-lead-import] FAILED:\n${msg}\n`);
  process.exit(1);
});
