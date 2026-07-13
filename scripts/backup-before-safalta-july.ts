/**
 * PRE-IMPORT SAFETY BACKUP — run BEFORE committing the Safalta July Batch backfill.
 * (Cloned from backup-before-saarthi.ts — that script is left UNTOUCHED.)
 *
 * Takes a logical snapshot (full row dump → JSON) of every table the import /
 * reconcile can mutate, so the exact pre-import state can be restored if needed.
 * Read-only against the DB (SELECT only). Writes JSON files to ./backups/.
 *
 *   node --env-file=.env.local --import tsx scripts/backup-before-safalta-july.ts
 *
 * Output: backups/safalta-july-pre-import-<timestamp>/<table>.json  + _manifest.json
 */
import * as fs from "fs";
import * as path from "path";
import { getSupabaseAdmin } from "../lib/supabase";

const TABLES = ["courses", "buyers", "students", "course_enrollments", "payments"] as const;
const PAGE = 1000;

async function dumpTable(sb: ReturnType<typeof getSupabaseAdmin>, table: string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb!.from(table).select("*").range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed reading ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function main() {
  const sb = getSupabaseAdmin();
  if (!sb) {
    console.error("✗ Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env. Aborting.");
    process.exit(1);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(process.cwd(), "backups", `safalta-july-pre-import-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  const manifest: Record<string, unknown> = {
    label: "Safalta July Batch pre-import safety backup",
    takenAtISO: new Date().toISOString(),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    tables: {},
  };
  const counts: Record<string, number> = {};

  console.log(`Backup dir: ${dir}\n`);
  for (const t of TABLES) {
    const rows = await dumpTable(sb, t);
    const file = path.join(dir, `${t}.json`);
    fs.writeFileSync(file, JSON.stringify(rows, null, 2));
    counts[t] = rows.length;
    (manifest.tables as Record<string, unknown>)[t] = { rows: rows.length, file: `${t}.json` };
    console.log(`  ${t.padEnd(20)} ${String(rows.length).padStart(6)} rows  →  ${t}.json`);
  }

  fs.writeFileSync(path.join(dir, "_manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\n  _manifest.json written.`);
  console.log(`\nBACKUP COMPLETE @ ${manifest.takenAtISO}`);
  console.log(`  Row counts: ${TABLES.map((t) => `${t}=${counts[t]}`).join("  ")}`);
  console.log(`  Restore handle: ${dir}`);
}

main().catch((e) => {
  console.error("✗ Backup failed:", e);
  process.exit(1);
});
