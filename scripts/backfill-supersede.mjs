#!/usr/bin/env node
/**
 * Backfill payment supersession (safe, dry-run first).
 *
 * Finds every canonical group — phone + item_type + item(slug/title) + purpose
 * (seat / installment#n / full) — where at least one attempt is PAID and one or
 * more OTHER attempts are unpaid + open + not-yet-superseded, and marks those
 * unpaid attempts is_superseded = true. It NEVER deletes a row and NEVER touches
 * a paid attempt. Each applied change is written to payment_action_log
 * (action 'supersede'), exactly like the runtime auto-supersede.
 *
 * This mirrors lib/paymentSupersede.ts::backfillSupersession so a one-off run and
 * the live app produce identical results, and it reconciles with the already-
 * shipped duplicate-enrollment cleanup (that tool merges ENROLLMENTS; this only
 * flags moot PAYMENT attempts — they never conflict).
 *
 * Usage:
 *   node scripts/backfill-supersede.mjs --dry-run     # default; reports only
 *   node scripts/backfill-supersede.mjs --apply       # writes the changes
 *
 * Env (same as the app): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const APPLY = process.argv.includes("--apply");
const SUPERSEDE_REASON = "Another attempt for the same student/item was paid or approved";
const PAID = new Set(["captured", "PAID"]);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const itemKey = (p) => (p.item_slug || p.item || "").trim().toLowerCase();
const purposeOf = (p) =>
  p.payment_kind === "seat" ? "seat" : p.payment_kind === "installment" ? `inst:${p.installment_no ?? 0}` : "full";
const groupKeyOf = (p) => [(p.phone || "").trim(), p.item_type, itemKey(p), purposeOf(p)].join("|");
const isPaid = (p) => PAID.has(p.status);

async function main() {
  console.log(`\nPayment supersession backfill — mode: ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}\n`);

  const { data, error } = await db.from("payments").select("*").is("deleted_at", null);
  if (error) { console.error("Failed to read payments:", error.message); process.exit(1); }
  const rows = data ?? [];

  const byKey = new Map();
  for (const p of rows) {
    const k = groupKeyOf(p);
    (byKey.get(k) || byKey.set(k, []).get(k)).push(p);
  }

  let groupsAffected = 0;
  let attemptsToSupersede = 0;
  let duplicatePaidGroups = 0;
  const samples = [];

  for (const [groupKey, group] of byKey) {
    const paid = group.filter(isPaid);
    if (paid.length === 0) continue;
    if (paid.length >= 2) duplicatePaidGroups += 1;
    const toSupersede = group.filter((p) => !isPaid(p) && !p.is_superseded);
    if (!toSupersede.length) continue;

    groupsAffected += 1;
    attemptsToSupersede += toSupersede.length;
    const s = toSupersede[0];
    samples.push({ phone: (s.phone || "").trim(), item: s.item, paid: paid.length, supersede: toSupersede.length });

    if (APPLY) {
      const anchor = [...paid].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0];
      for (const p of toSupersede) {
        await db
          .from("payments")
          .update({
            is_superseded: true,
            superseded_by_payment_id: anchor.id,
            superseded_at: new Date().toISOString(),
            superseded_reason: SUPERSEDE_REASON,
          })
          .eq("id", p.id)
          .not("status", "in", "(captured,PAID)");
        await db.from("payment_action_log").insert({
          id: randomUUID(),
          action: "supersede",
          payment_id: p.id,
          reference_no: p.reference_no ?? null,
          enrollment_id: p.enrollment_id ?? null,
          phone: p.phone ?? null,
          actor_id: "backfill",
          actor_name: "Backfill script",
          actor_role: "system",
          actor_is_super: false,
          old_status: p.status,
          new_status: p.status,
          reason: SUPERSEDE_REASON,
          files: [],
          file_count: 0,
          metadata: { group_key: groupKey, superseded_by_payment_id: anchor.id, backfill: true },
          created_at: new Date().toISOString(),
        });
      }
    }
  }

  console.log(`Groups scanned:          ${byKey.size}`);
  console.log(`Groups affected:         ${groupsAffected}`);
  console.log(`Attempts to supersede:   ${attemptsToSupersede}`);
  console.log(`Duplicate-paid groups:   ${duplicatePaidGroups} (flagged for human review; NOT superseded)`);
  if (samples.length) {
    console.log(`\nAffected groups:`);
    for (const s of samples) console.log(`  • ${s.phone} — ${s.item} (paid:${s.paid}, supersede:${s.supersede})`);
  }
  console.log(APPLY ? "\nDone. Changes written + logged.\n" : "\nDry-run only. Re-run with --apply to write.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
