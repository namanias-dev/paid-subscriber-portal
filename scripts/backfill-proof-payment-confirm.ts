/**
 * One-shot: for proof-accepted PAID rows missing payment_confirmed_notified_at,
 * call notifyPaymentConfirmedOnce (same path as proof approve / Verify PAID).
 * Idempotent via DB claim + SMS dedupe_key.
 *
 * Usage: npx tsx --env-file=.env.local scripts/backfill-proof-payment-confirm.ts [--dry-run]
 */
import { getSupabaseAdmin } from "../lib/supabase";
import { notifyPaymentConfirmedOnce } from "../lib/paymentOutcome/confirmOnce";
import type { Payment } from "../lib/types";

async function main() {
  const dry = process.argv.includes("--dry-run");
  const db = getSupabaseAdmin();
  if (!db) throw new Error("no_db");

  const { data, error } = await db
    .from("payments")
    .select("*, payment_proofs!inner(status)")
    .eq("status", "PAID")
    .is("payment_confirmed_notified_at", null)
    .eq("payment_proofs.status", "accepted")
    .gte("created_at", "2026-06-01T00:00:00.000Z")
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) throw error;
  const rows = (data || []) as Payment[];
  console.log(JSON.stringify({ count: rows.length, dry, refs: rows.map((r) => r.reference_no) }, null, 2));
  if (dry) return;

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const p of rows) {
    try {
      const ok = await notifyPaymentConfirmedOnce(p);
      if (ok) sent += 1;
      else skipped += 1;
      console.log(JSON.stringify({ ref: p.reference_no, ok, phone: p.phone }));
    } catch (e) {
      failed += 1;
      console.log(JSON.stringify({ ref: p.reference_no, error: (e as Error).message }));
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(JSON.stringify({ sent, skipped, failed, total: rows.length }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
