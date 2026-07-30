/**
 * Apply 2026-07-30 lead behaviour-status migration via Supabase Management API.
 *
 * Requires SUPABASE_ACCESS_TOKEN (Personal Access Token from
 * https://supabase.com/dashboard/account/tokens).
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... node --import tsx scripts/apply-lead-behaviour-migration.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT_REF = "xqwdfyzerzsllqiyzxem";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("Set SUPABASE_ACCESS_TOKEN (Supabase dashboard → Account → Access Tokens).");
  process.exit(1);
}

async function runSql(query: string, label: string) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`FAIL ${label}: ${res.status} ${text.slice(0, 500)}`);
    process.exit(1);
  }
  console.log(`OK ${label}`);
  return text;
}

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/2026-07-30-lead-behaviour-status.sql"),
  "utf8",
);

await runSql(migration, "migration DDL");
await runSql(
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_manual_system_disparity
     ON public.leads (manual_status, status)
     WHERE merged_into IS NULL AND manual_status IS NOT NULL AND status_origin = 'system';`,
  "idx disparity",
);
await runSql(
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_status_origin
     ON public.leads (status_origin)
     WHERE merged_into IS NULL AND status_origin IS NOT NULL;`,
  "idx status_origin",
);
await runSql(`notify pgrst, 'reload schema';`, "reload schema cache");

const verify = await runSql(
  `select column_name from information_schema.columns
   where table_schema='public' and table_name='leads'
     and column_name in (
       'status_origin','status_system_verified_at','manual_status',
       'manual_status_at','manual_status_by','manual_status_by_role','manual_status_note'
     )
   order by 1;`,
  "verify columns",
);
console.log(verify);
