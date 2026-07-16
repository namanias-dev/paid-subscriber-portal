/**
 * Legacy attribution backfill CLI — REVERSIBLE, IDEMPOTENT, DRY-RUN by default.
 *
 * Re-derives the marketing-attribution scalar columns (`channel`, `utm_source`,
 * `utm_medium`, `utm_campaign`) on legacy `leads` rows using a signal ALREADY
 * STORED in the row's `attribution` JSONB. Never invents a source. Never
 * touches any non-attribution column. Never touches money / enrolment / student
 * data. Preserves first-touch integrity: rows whose first_touch already carries
 * an acquisition signal are LEFT UNCHANGED.
 *
 * Usage:
 *   # 1) DRY-RUN (default). Prints the report + writes a backup file that WOULD
 *   #    become the rollback. NO DB WRITES executed.
 *   node --env-file=.env.local --import tsx scripts/backfill-attribution.ts
 *
 *   # 2) EXECUTE. Applies the corrected values. Requires --execute AND
 *   #    --backup-out=<path>. Refuses to run without the explicit flag pair.
 *   node --env-file=.env.local --import tsx scripts/backfill-attribution.ts \
 *     --execute --backup-out=./backups/attribution-<yyyymmdd-hhmm>.json
 *
 *   # 3) ROLLBACK. Restores the exact old values from a backup file created by
 *   #    an execute run. Idempotent — safe to run twice.
 *   node --env-file=.env.local --import tsx scripts/backfill-attribution.ts \
 *     --rollback --backup-in=./backups/attribution-<yyyymmdd-hhmm>.json
 *
 * Safety:
 *   - --execute REQUIRES --backup-out. The backup is written BEFORE the update
 *     is applied. If backup write fails, the update is not attempted.
 *   - Only columns in BACKFILL_SCALARS are ever written. Nothing else.
 *   - Every write is scoped to `.eq("id", <row.id>)`.
 */
import * as fs from "fs";
import * as path from "path";
import { getSupabaseAdmin } from "../lib/supabase";
import {
  BACKFILL_SCALARS,
  buildBackup,
  computeDryRunReport,
  computeRowDiff,
  patchFromDiff,
  type BackfillScalar,
  type BackupFile,
  type LegacyLeadRow,
} from "../lib/marketing/backfillAttribution";

interface Args {
  execute: boolean;
  rollback: boolean;
  backupOut: string | null;
  backupIn: string | null;
  showSample: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { execute: false, rollback: false, backupOut: null, backupIn: null, showSample: 20 };
  for (const raw of argv.slice(2)) {
    if (raw === "--execute") a.execute = true;
    else if (raw === "--rollback") a.rollback = true;
    else if (raw.startsWith("--backup-out=")) a.backupOut = raw.slice("--backup-out=".length);
    else if (raw.startsWith("--backup-in=")) a.backupIn = raw.slice("--backup-in=".length);
    else if (raw.startsWith("--sample=")) a.showSample = Math.max(1, Number(raw.slice("--sample=".length)) || 20);
  }
  return a;
}

function requireDb() {
  const db = getSupabaseAdmin();
  if (!db) {
    console.error("ERR: Supabase admin client unavailable. Set SUPABASE_* env vars (.env.local).");
    process.exit(2);
  }
  return db;
}

async function loadLegacyRows(): Promise<LegacyLeadRow[]> {
  const db = requireDb();
  const { data, error } = await db
    .from("leads")
    .select("id, phone, channel, utm_source, utm_medium, utm_campaign, attribution")
    .not("attribution", "is", null);
  if (error) {
    console.error("ERR: failed to load leads:", error.message);
    process.exit(3);
  }
  return (data as LegacyLeadRow[]) ?? [];
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, " ");
}

async function runDryRun(args: Args): Promise<void> {
  console.log("── backfill-attribution: DRY RUN (no DB writes) ─────────────");
  const rows = await loadLegacyRows();
  const rep = computeDryRunReport(rows);

  console.log(`scanned_total                 : ${pad(rep.scanned_total, 6)}`);
  console.log(`no_attribution_json (untouched): NOT INCLUDED — filtered by query`);
  console.log(`already_correct               : ${pad(rep.already_correct, 6)}`);
  console.log(`matches_current               : ${pad(rep.matches_current, 6)}`);
  console.log(`no_signal_stays_unchanged     : ${pad(rep.no_signal_stays_unchanged, 6)}`);
  console.log(`would_change                  : ${pad(rep.would_change, 6)}   ← execute would rewrite`);
  console.log("");
  console.log("by_proposed_channel:");
  for (const [ch, n] of Object.entries(rep.by_proposed_channel)) {
    console.log(`  ${ch.padEnd(15)} ${pad(n, 6)}`);
  }
  console.log("");

  const changes = rep.diffs.filter((d) => d.changes).slice(0, args.showSample);
  if (changes.length) {
    console.log(`Sample (up to ${args.showSample}) — id | phone | old.channel → proposed.channel | proposed.utm_campaign | from`);
    for (const d of changes) {
      console.log(
        `  ${d.id.slice(0, 8)}…  ${(d.phone || "").padEnd(12)}  ` +
          `${(d.old.channel || "—").padEnd(11)} → ${(d.proposed.channel || "—").padEnd(11)}  ` +
          `${(d.proposed.utm_campaign || "—").padEnd(24)}  ${d.source_touch}`,
      );
    }
    console.log("");
  }

  // Also write the "would-be" backup so the operator can inspect exactly what
  // an execute run would rewrite — never applied unless --execute is passed.
  if (args.backupOut) {
    const backup = buildBackup(rep.diffs);
    fs.mkdirSync(path.dirname(args.backupOut), { recursive: true });
    fs.writeFileSync(args.backupOut, JSON.stringify(backup, null, 2));
    console.log(`preview backup (NOT executed) written → ${args.backupOut}`);
  }

  console.log("");
  console.log("→ No DB writes performed. To execute, re-run with:");
  console.log("    --execute --backup-out=./backups/attribution-<timestamp>.json");
}

async function runExecute(args: Args): Promise<void> {
  if (!args.backupOut) {
    console.error("ERR: --execute requires --backup-out=<path> for the reversible backup.");
    process.exit(4);
  }
  const db = requireDb();
  const rows = await loadLegacyRows();
  const rep = computeDryRunReport(rows);
  const willChange = rep.diffs.filter((d) => d.changes);
  console.log(`── backfill-attribution: EXECUTE — ${willChange.length} row(s) will be rewritten ───`);

  // 1) Write backup FIRST — abort on any I/O failure.
  const backup = buildBackup(rep.diffs);
  fs.mkdirSync(path.dirname(args.backupOut), { recursive: true });
  fs.writeFileSync(args.backupOut, JSON.stringify(backup, null, 2));
  console.log(`backup written → ${args.backupOut} (${backup.rows.length} row(s))`);
  if (!willChange.length) {
    console.log("Nothing to do — no changes needed. Exiting.");
    return;
  }

  // 2) Apply per-row updates, scoped to marketing scalars ONLY.
  let ok = 0;
  const failures: { id: string; error: string }[] = [];
  for (const d of willChange) {
    const patch = patchFromDiff(d);
    // Belt-and-braces: assert the patch contains ONLY BACKFILL_SCALARS keys.
    for (const key of Object.keys(patch)) {
      if (!(BACKFILL_SCALARS as readonly string[]).includes(key)) {
        failures.push({ id: d.id, error: `patch contains disallowed key ${key}` });
        continue;
      }
    }
    const { error } = await db.from("leads").update(patch).eq("id", d.id);
    if (error) failures.push({ id: d.id, error: error.message });
    else ok += 1;
  }
  console.log(`applied: ${ok}, failed: ${failures.length}`);
  if (failures.length) {
    for (const f of failures) console.log(`  FAIL ${f.id}: ${f.error}`);
    console.log("Rollback command:");
    console.log(`  node --env-file=.env.local --import tsx scripts/backfill-attribution.ts --rollback --backup-in=${args.backupOut}`);
    process.exit(5);
  }
  console.log("");
  console.log("→ Rollback command (verbatim):");
  console.log(`  node --env-file=.env.local --import tsx scripts/backfill-attribution.ts --rollback --backup-in=${args.backupOut}`);
}

async function runRollback(args: Args): Promise<void> {
  if (!args.backupIn) {
    console.error("ERR: --rollback requires --backup-in=<path>.");
    process.exit(6);
  }
  const raw = fs.readFileSync(args.backupIn, "utf-8");
  const backup = JSON.parse(raw) as BackupFile;
  if (!backup?.rows?.length) {
    console.log("Backup contains no rows to restore.");
    return;
  }
  const db = requireDb();
  console.log(`── backfill-attribution: ROLLBACK — restoring ${backup.rows.length} row(s) from ${args.backupIn} ───`);
  let ok = 0;
  const failures: { id: string; error: string }[] = [];
  for (const r of backup.rows) {
    const patch: Partial<Record<BackfillScalar, string | null>> = {};
    for (const k of BACKFILL_SCALARS) patch[k] = r.old[k];
    const { error } = await db.from("leads").update(patch).eq("id", r.id);
    if (error) failures.push({ id: r.id, error: error.message });
    else ok += 1;
  }
  console.log(`restored: ${ok}, failed: ${failures.length}`);
  if (failures.length) {
    for (const f of failures) console.log(`  FAIL ${f.id}: ${f.error}`);
    process.exit(7);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.rollback) return runRollback(args);
  if (args.execute) return runExecute(args);
  return runDryRun(args);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
