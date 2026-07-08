#!/usr/bin/env node
/**
 * De-duplicate existing Lead CRM rows by normalized phone (reversible / soft).
 *
 * For each phone with more than one ACTIVE lead:
 *   • keep the EARLIEST-created row as the canonical lead,
 *   • attach every touchpoint (source/campaign/interest/date) to canonical.sources,
 *   • set canonical source/campaign to the LAST touch (last-touch attribution),
 *   • preserve first-touch in first_source / first_campaign,
 *   • merge scalar fields (fill blanks), OR engagement flags, keep the most
 *     ADVANCED pipeline status (never regress), keep money fields,
 *   • re-point lead_activities from duplicates to the canonical lead,
 *   • mark duplicates merged_into=<canonical id> (SOFT — never a hard delete).
 * Singleton leads are left in place; their sources/first_touch are backfilled so
 * the CRM source-history UI works uniformly.
 *
 *   node scripts/dedupe-leads.mjs            # DRY-RUN (default) — writes nothing
 *   node scripts/dedupe-leads.mjs --apply    # perform the merge
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { readFileSync } from "node:fs";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* rely on shell env */ }

const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();

const STATUS_RANK = { "New": 0, "Contacted": 1, "Demo Booked": 2, "Demo Attended": 3, "Negotiation": 4, "Admitted": 5, "Lost": -1 };

/** Normalize to a 10-digit Indian mobile, or null if not a valid mobile. */
function normDigits(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

async function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key, { auth: { persistSession: false } });
}

function touchOf(l) {
  return { source: l.source ?? null, campaign: l.campaign ?? null, course_interest: l.course_interest ?? null, at: l.created_at, lead_id: l.id };
}

/** Fetch ALL leads (Supabase caps a single select at 1000 rows — paginate). */
async function fetchAllLeads(supa) {
  const all = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa
      .from("leads").select("*")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`leads read failed: ${error.message}`);
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

async function main() {
  const supa = await db();
  const leads = await fetchAllLeads(supa);

  const active = (leads || []).filter((l) => !l.merged_into);
  const groups = new Map(); // digits10 -> lead[]
  const unmatched = []; // no valid phone — left untouched
  for (const l of active) {
    const d = normDigits(l.phone);
    if (!d) { unmatched.push(l); continue; }
    const arr = groups.get(d);
    if (arr) arr.push(l); else groups.set(d, [l]);
  }

  const dupeGroups = [...groups.entries()].filter(([, arr]) => arr.length > 1);
  const singletonGroups = [...groups.entries()].filter(([, arr]) => arr.length === 1);

  let dupRowsToMerge = 0;
  for (const [, arr] of dupeGroups) dupRowsToMerge += arr.length - 1;

  console.log(`\nLead de-dup — ${APPLY ? "APPLY" : "DRY-RUN"}`);
  console.log(`  active leads: ${active.length}   distinct phones: ${groups.size}   no-phone: ${unmatched.length}`);
  console.log(`  phones with duplicates: ${dupeGroups.length}   duplicate rows to merge: ${dupRowsToMerge}`);
  console.log(`  singleton leads to backfill history: ${singletonGroups.filter(([, a]) => !(Array.isArray(a[0].sources) && a[0].sources.length)).length}\n`);

  // ---- plan + optionally apply ----
  const ops = { canonicalUpdates: 0, dupeUpdates: 0, activityRepoints: 0, singletonBackfills: 0 };

  // Merge duplicate groups.
  for (const [digits, arr] of dupeGroups) {
    const sorted = [...arr].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const canonical = sorted[0];
    const dupes = sorted.slice(1);
    const desc = [...sorted].reverse(); // most-recent first for fills
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    const pick = (field, isDefault = () => false) => {
      if (canonical[field] != null && canonical[field] !== "" && !isDefault(canonical[field])) return canonical[field];
      for (const l of desc) if (l[field] != null && l[field] !== "" && !isDefault(l[field])) return l[field];
      return canonical[field] ?? null;
    };
    const orFlag = (field) => sorted.some((l) => !!l[field]);
    const maxNum = (field) => {
      const vals = sorted.map((l) => Number(l[field])).filter((n) => Number.isFinite(n));
      return vals.length ? Math.max(...vals) : null;
    };
    const bestStatus = sorted.reduce((best, l) => {
      const r = STATUS_RANK[l.status] ?? 0;
      return r > (STATUS_RANK[best] ?? 0) ? l.status : best;
    }, canonical.status || "New");

    const patch = {
      name: pick("name", (v) => v === "New Lead"),
      email: pick("email"),
      city: pick("city"),
      state: pick("state"),
      course_interest: pick("course_interest"),
      target_year: pick("target_year"),
      counsellor: pick("counsellor"),
      mode_pref: pick("mode_pref"),
      source: last.source ?? canonical.source,
      campaign: last.campaign ?? canonical.campaign ?? null,
      first_source: first.source ?? canonical.first_source ?? null,
      first_campaign: first.campaign ?? canonical.first_campaign ?? null,
      sources: sorted.map(touchOf),
      status: bestStatus,
      called: orFlag("called"),
      demo_booked: orFlag("demo_booked"),
      demo_attended: orFlag("demo_attended"),
      webinar_registered: orFlag("webinar_registered"),
      webinar_attended: orFlag("webinar_attended"),
      admitted: orFlag("admitted"),
      total_fee: canonical.total_fee ?? maxNum("total_fee"),
      amount_collected: canonical.amount_collected ?? maxNum("amount_collected"),
      pending_balance: canonical.pending_balance ?? maxNum("pending_balance"),
      merged_count: dupes.length,
      updated_at: last.created_at,
    };

    console.log(`  phone ${digits}: canonical ${canonical.id} (${canonical.created_at.slice(0, 10)}) ← ${dupes.length} dupe(s); status=${patch.status}; touches=${patch.sources.length}`);

    if (APPLY) {
      const { error: cErr } = await supa.from("leads").update(patch).eq("id", canonical.id);
      if (cErr) { console.error(`    ✗ canonical update: ${cErr.message}`); continue; }
      ops.canonicalUpdates++;
      for (const d of dupes) {
        // Re-point activities so notes stay visible on the canonical lead.
        const { error: aErr } = await supa.from("lead_activities").update({ lead_id: canonical.id }).eq("lead_id", d.id);
        if (!aErr) ops.activityRepoints++;
        const { error: dErr } = await supa.from("leads").update({ merged_into: canonical.id, updated_at: NOW }).eq("id", d.id);
        if (dErr) console.error(`    ✗ dupe ${d.id}: ${dErr.message}`); else ops.dupeUpdates++;
      }
    }
  }

  // Backfill singleton history so the source-history UI is uniform.
  for (const [, arr] of singletonGroups) {
    const l = arr[0];
    if (Array.isArray(l.sources) && l.sources.length) continue;
    const patch = {
      sources: [touchOf(l)],
      first_source: l.first_source ?? l.source ?? null,
      first_campaign: l.first_campaign ?? l.campaign ?? null,
      updated_at: l.updated_at ?? l.created_at,
    };
    if (APPLY) {
      const { error: e } = await supa.from("leads").update(patch).eq("id", l.id);
      if (!e) ops.singletonBackfills++;
    } else {
      ops.singletonBackfills++;
    }
  }

  console.log(`\n  ${APPLY ? "Applied" : "Would apply"}: ${dupeGroups.length} merges (${ops.dupeUpdates || dupRowsToMerge} dupes soft-merged), ${ops.singletonBackfills} singleton backfills, ${ops.activityRepoints} activity re-points.`);
  if (!APPLY) console.log("  Dry-run only. Re-run with --apply to perform the merge.\n");
  else console.log("  Done.\n");
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
