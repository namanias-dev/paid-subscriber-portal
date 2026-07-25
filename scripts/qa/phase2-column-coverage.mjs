/**
 * LOCAL QA ONLY — read-only column coverage for the Phase 2 worklist columns.
 *
 * Answers the questions the UI has to answer honestly: how often is
 * `campaign_clean` actually empty, and is it empty on LIVE rows too (in which
 * case the "Legacy — no campaign" phrasing would be a lie on those rows)?
 *
 * Counts only. Selects no name, phone, or email.
 *
 *   node scripts/qa/phase2-column-coverage.mjs
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function count(label, build) {
  const q = build(db.from("leads").select("id", { count: "exact", head: true }));
  const { count: n, error } = await q;
  if (error) throw new Error(`${label}: ${JSON.stringify(error)}`);
  console.log(`${label.padEnd(52)} ${String(n).padStart(8)}`);
  return n;
}

const legacy = await count("legacy total", (q) => q.eq("is_legacy", true));
const legacyNoCampaign = await count("legacy · campaign_clean IS NULL", (q) =>
  q.eq("is_legacy", true).is("campaign_clean", null),
);
await count("legacy · campaign_clean = '' (empty string)", (q) =>
  q.eq("is_legacy", true).eq("campaign_clean", ""),
);
await count("legacy · legacy_call_status_raw IS NULL", (q) =>
  q.eq("is_legacy", true).is("legacy_call_status_raw", null),
);
await count("legacy · first_seen_at IS NULL", (q) =>
  q.eq("is_legacy", true).is("first_seen_at", null),
);
await count("legacy · assigned_to IS NULL", (q) =>
  q.eq("is_legacy", true).is("assigned_to", null),
);
await count("legacy · consent_status <> 'unknown'", (q) =>
  q.eq("is_legacy", true).neq("consent_status", "unknown"),
);

const live = await count("live total", (q) => q.eq("is_legacy", false));
const liveNoCampaign = await count("live · campaign_clean IS NULL", (q) =>
  q.eq("is_legacy", false).is("campaign_clean", null),
);
await count("live · first_seen_at IS NULL", (q) =>
  q.eq("is_legacy", false).is("first_seen_at", null),
);
await count("live · consent_status <> 'unknown'", (q) =>
  q.eq("is_legacy", false).neq("consent_status", "unknown"),
);
await count("any · consent_status = 'opted_out'", (q) => q.eq("consent_status", "opted_out"));

console.log("");
console.log(`legacy rows with no campaign_clean: ${((legacyNoCampaign / legacy) * 100).toFixed(1)}%`);
console.log(`live   rows with no campaign_clean: ${((liveNoCampaign / live) * 100).toFixed(1)}%`);
