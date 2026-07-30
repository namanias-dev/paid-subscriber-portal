/**
 * One-time historical backfill: behaviour-derived lead status.
 *
 * Usage:
 *   node --env-file=.env.local --import tsx --import ./scripts/_react-cache-shim.mjs \
 *     scripts/backfill-lead-behaviour-status.ts [--apply] [--batch=500]
 *
 * Default is DRY-RUN (prints cross-tab only). Pass --apply to write.
 * Re-runnable / idempotent: second apply changes nothing.
 *
 * Guardrails: never deletes leads; never demotes on behaviour ladder;
 * preserves prior status into manual_* when flipping; does not touch
 * payments / enrollments / fees / SMS.
 */

import { getSupabaseAdmin } from "../lib/supabase";
import {
  buildBehaviourPatch,
  deriveBehaviourStageFromEvents,
  type BehaviourStage,
  type StatusOrigin,
} from "../lib/leadBehaviourStatus";

const APPLY = process.argv.includes("--apply");
const batchArg = process.argv.find((a) => a.startsWith("--batch="));
const BATCH = Math.max(50, Math.min(2000, Number(batchArg?.split("=")[1] || 500)));

type LeadRow = {
  id: string;
  phone_key: string | null;
  status: string | null;
  status_origin: StatusOrigin | null;
  manual_status: string | null;
  is_legacy: boolean | null;
};

type EnrRow = {
  id: string;
  phone_key: string | null;
  status: string | null;
  amount_paid: number | null;
  created_at: string | null;
  schedule: unknown;
  course_title: string | null;
};
type PayRow = {
  id: string;
  phone_key: string | null;
  status: string | null;
  amount: number | null;
  item_type: string | null;
  payment_kind: string | null;
  created_at: string | null;
  item_name: string | null;
};
type RegRow = {
  id: string;
  phone_key: string | null;
  webinar_id: string | null;
  created_at: string | null;
};

async function fetchAll<T>(
  table: string,
  select: string,
  filter?: (q: ReturnType<NonNullable<ReturnType<typeof getSupabaseAdmin>>["from"]>) => unknown,
): Promise<T[]> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("No supabase");
  const out: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let q = db.from(table).select(select).range(from, from + page - 1);
    if (filter) q = filter(q as never) as typeof q;
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < page) break;
  }
  return out;
}

function crosstab(changes: { from: string; to: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of changes) {
    const k = `${c.from} → ${c.to}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function printTab(title: string, m: Map<string, number>) {
  console.log(`\n=== ${title} ===`);
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1]);
  if (!rows.length) {
    console.log("(none)");
    return;
  }
  for (const [k, n] of rows) console.log(`${String(n).padStart(7)}  ${k}`);
  console.log(`TOTAL ${rows.reduce((a, [, n]) => a + n, 0)}`);
}

async function main() {
  const t0 = Date.now();
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}  batch=${BATCH}`);

  const db = getSupabaseAdmin();
  if (!db) throw new Error("No supabase admin");

  // Probe new columns exist
  const probe = await db.from("leads").select("id,status_origin,manual_status").limit(1);
  if (probe.error) {
    console.error("Schema probe failed — apply migration 2026-07-30-lead-behaviour-status.sql first.");
    console.error(probe.error.message);
    process.exit(1);
  }

  console.log("Loading leads (unmerged)…");
  const leads = await fetchAll<LeadRow>(
    "leads",
    "id,phone_key,status,status_origin,manual_status,is_legacy",
    (q) => (q as { is: (c: string, v: null) => unknown }).is("merged_into", null),
  );
  console.log(`Leads: ${leads.length}`);

  console.log("Loading enrollments / payments / webinar_registrations…");
  const [enrollments, payments, registrations] = await Promise.all([
    fetchAll<EnrRow>("course_enrollments", "id,phone_key,status,amount_paid,created_at,schedule,course_title"),
    fetchAll<PayRow>("payments", "id,phone_key,status,amount,item_type,payment_kind,created_at,item_name"),
    fetchAll<RegRow>("webinar_registrations", "id,phone_key,webinar_id,created_at"),
  ]);
  console.log(`Enrollments=${enrollments.length} Payments=${payments.length} Regs=${registrations.length}`);

  const webinarIds = [...new Set(registrations.map((r) => r.webinar_id).filter(Boolean))] as string[];
  const webinarsById = new Map<string, { id: string; title: string | null; price: number | null }>();
  for (let i = 0; i < webinarIds.length; i += 200) {
    const chunk = webinarIds.slice(i, i + 200);
    const { data, error } = await db.from("webinars").select("id,title,price").in("id", chunk);
    if (error) throw new Error(error.message);
    for (const w of data || []) webinarsById.set(w.id, w);
  }

  // Index events by phone_key
  const ensBy = new Map<string, EnrRow[]>();
  for (const e of enrollments) {
    const k = e.phone_key || "";
    if (k.length !== 10) continue;
    (ensBy.get(k) || ensBy.set(k, []).get(k)!).push(e);
  }
  const payBy = new Map<string, PayRow[]>();
  for (const p of payments) {
    const k = p.phone_key || "";
    if (k.length !== 10) continue;
    (payBy.get(k) || payBy.set(k, []).get(k)!).push(p);
  }
  const regBy = new Map<string, RegRow[]>();
  for (const r of registrations) {
    const k = r.phone_key || "";
    if (k.length !== 10) continue;
    (regBy.get(k) || regBy.set(k, []).get(k)!).push(r);
  }

  // Derive once per phone_key
  const stageByPhone = new Map<string, BehaviourStage>();
  const phones = new Set<string>([
    ...ensBy.keys(),
    ...payBy.keys(),
    ...regBy.keys(),
  ]);
  for (const phoneKey of phones) {
    const ev = deriveBehaviourStageFromEvents({
      enrollments: ensBy.get(phoneKey) || [],
      payments: payBy.get(phoneKey) || [],
      registrations: regBy.get(phoneKey) || [],
      webinarsById,
    });
    if (ev.stage) stageByPhone.set(phoneKey, ev.stage);
  }
  console.log(`Phones with behaviour stage: ${stageByPhone.size}`);

  const planned: {
    id: string;
    from: string;
    to: string;
    patch: Record<string, unknown>;
    preservedManual: boolean;
    lackAttribution: boolean;
  }[] = [];

  let alreadyOk = 0;
  let noStage = 0;
  let wouldDemote = 0;

  for (const lead of leads) {
    const key = lead.phone_key || "";
    const stage = key ? stageByPhone.get(key) : undefined;
    if (!stage) {
      noStage++;
      continue;
    }
    const { patch, changed, preservedManual, skippedReason } = buildBehaviourPatch({
      currentStatus: lead.status,
      statusOrigin: lead.status_origin,
      manualStatus: lead.manual_status,
      derived: stage,
    });
    if (!changed) {
      if (skippedReason === "would_demote") wouldDemote++;
      else alreadyOk++;
      continue;
    }
    const lackAttribution =
      preservedManual &&
      !(patch.manual_status_by || lead.manual_status /* already had */);
    planned.push({
      id: lead.id,
      from: lead.status || "(null)",
      to: stage,
      patch,
      preservedManual,
      lackAttribution: !!(preservedManual && !lead.manual_status),
    });
  }

  const ct = crosstab(planned.map((p) => ({ from: p.from, to: p.to })));
  printTab(`${APPLY ? "WILL APPLY" : "DRY-RUN"} status changes`, ct);
  console.log(`\nSummary:`);
  console.log(`  total leads (unmerged): ${leads.length}`);
  console.log(`  no behaviour stage:     ${noStage}`);
  console.log(`  already correct:        ${alreadyOk}`);
  console.log(`  would demote (skip):    ${wouldDemote}`);
  console.log(`  to change:              ${planned.length}`);
  console.log(`  preserve manual (no attribution available): ${planned.filter((p) => p.lackAttribution).length}`);

  if (!APPLY) {
    console.log(`\nDry-run only. Re-run with --apply to write.`);
    console.log(`Elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return;
  }

  // Apply in batches
  let written = 0;
  let errors = 0;
  for (let i = 0; i < planned.length; i += BATCH) {
    const chunk = planned.slice(i, i + BATCH);
    await Promise.all(
      chunk.map(async (row) => {
        const { error } = await db.from("leads").update(row.patch).eq("id", row.id);
        if (error) {
          errors++;
          console.error(`FAIL ${row.id}: ${error.message}`);
        } else {
          written++;
        }
      }),
    );
    console.log(`  wrote ${Math.min(i + chunk.length, planned.length)}/${planned.length}`);
  }

  // Verify count unchanged
  const { count } = await db
    .from("leads")
    .select("id", { count: "exact", head: true })
    .is("merged_into", null);

  console.log(`\nApplied written=${written} errors=${errors}`);
  console.log(`Unmerged lead count after: ${count}`);
  console.log(`Elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
