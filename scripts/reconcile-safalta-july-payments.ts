/**
 * ONE-TIME payment-ledger backfill for the "Safalta July Batch" backfill import.
 * (Cloned from reconcile-safalta-payments.ts — that script is left UNTOUCHED.)
 *
 * WHY: the import writes the money already collected onto the enrollment SCHEDULE
 * only. The admin "Total Paid" tile, the payments ledger and the finance dashboard
 * read the `payments` table (getBuyerPurchases / getPaymentsByEnrollmentId), which
 * has NO rows for a freshly-imported student. This backfills ONE PAID ledger row
 * per already-paid schedule line so every finance surface agrees.
 *
 * PURE DB inserts — NEVER calls Razorpay/Eazypay, sends NO SMS/email, and mutates
 * NO schedule. Ledger rows are keyed by a deterministic reference_no
 * (LEGACY-IMPORT-<enrId>-<lineNo>) so re-runs are idempotent (skip existing).
 *
 * SCOPE — CRITICAL: the two July target courses (co-safalta / co-saarthi-off) are
 * SHARED, live courses with many pre-existing students. To stay strictly ADDITIVE
 * and never touch unrelated data, this backfills ONLY the enrollments created by
 * the July import — identified by their exact batch_label. It deliberately does
 * NOT use the whole-course backfillCoursePaymentLedgerBySlug (which would also scan
 * unrelated enrollments), and it OMITS the evidence-less "abandon PENDING" sweep.
 *
 * DRY-RUN by default; pass --commit to write. Needs Supabase creds in the env:
 *   node --env-file=.env.local --import tsx scripts/reconcile-safalta-july-payments.ts
 *   node --env-file=.env.local --import tsx scripts/reconcile-safalta-july-payments.ts --commit
 */
import {
  getCourseBySlug,
  getAllCourseEnrollments,
  getPaymentsByEnrollmentId,
  backfillEnrollmentPaymentLedger,
  isPaidStatus,
} from "../lib/dataProvider";
import { getSupabaseAdmin } from "../lib/supabase";
import { deriveEnrollment } from "../lib/installments";
import { formatINR } from "../lib/dates";

const COURSE_SLUGS = ["safalta-online-foundation", "saarthi-gs-foundation-offline"] as const;
// Exact batch_label written by scripts/import-safalta-july.ts — the scope key.
const BATCH_LABEL = "Safalta July Batch — starts 13 Jul 2026";
const SOURCE = "legacy-import";

function money(n: number): string { return formatINR(Math.round(n)); }
function hr(ch = "─", n = 100): string { return ch.repeat(n); }
function pad(s: string, n: number): string { return (s ?? "").toString().slice(0, n).padEnd(n); }
function padL(s: string, n: number): string { return (s ?? "").toString().slice(0, n).padStart(n); }

/** Ledger paid (payments table) for one enrollment — what "Total Paid" reads. */
async function ledgerPaidFor(enrollmentId: string): Promise<number> {
  const rows = await getPaymentsByEnrollmentId(enrollmentId);
  return rows.filter((p) => isPaidStatus(p.status) && !p.deleted_at).reduce((a, p) => a + p.amount, 0);
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");

  console.log(hr("="));
  console.log(`  SAFALTA JULY BATCH — PAYMENT LEDGER BACKFILL   ${commit ? ">>> COMMIT (WRITES) <<<" : "DRY-RUN (writes nothing)"}`);
  console.log(hr("="));

  const db = getSupabaseAdmin();
  if (!db) {
    console.error("✗ Supabase not configured. Provide NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (e.g. --env-file=.env.local).");
    process.exit(1);
  }

  const courseIds = new Set<string>();
  for (const slug of COURSE_SLUGS) {
    const c = await getCourseBySlug(slug);
    if (!c) { console.error(`✗ Course "${slug}" not found — skipping.`); continue; }
    courseIds.add(c.id);
  }

  // SCOPE: only enrollments created by the July import (exact batch_label).
  const all = await getAllCourseEnrollments();
  const mine = all.filter(
    (e) => courseIds.has(e.course_id) && e.status !== "cancelled" && (e.batch_label || "") === BATCH_LABEL,
  );

  console.log(`  Scope: batch_label "${BATCH_LABEL}"`);
  console.log(`  July enrollments in target courses: ${mine.length}`);
  console.log("");

  let totalCreated = 0;
  let totalAmount = 0;
  let totalSkipped = 0;
  for (const e of mine) {
    const r = await backfillEnrollmentPaymentLedger(e.id, { source: SOURCE, dryRun: !commit });
    totalCreated += r.created;
    totalAmount += r.amount;
    totalSkipped += r.skippedExisting;
  }
  console.log(hr());
  console.log(`LEDGER BACKFILL (${commit ? "written" : "dry-run"})`);
  console.log(hr());
  console.log(`  Enrollments scanned      : ${mine.length}`);
  console.log(`  Ledger rows ${commit ? "created" : "to create"}    : ${totalCreated}   (${money(totalAmount)})`);
  console.log(`  Already present (skipped): ${totalSkipped}`);
  console.log("");

  // Verify: ledger paid == schedule-derived paid, per July enrollment.
  console.log(hr());
  console.log("VERIFICATION — Total Paid (payments ledger) vs schedule-derived paid, per July enrollment");
  console.log(hr());
  console.log(`  ${pad("Name", 20)}${pad("Phone", 13)}${padL("Ledger paid", 13)}${padL("Sched paid", 12)}${padL("Outstanding", 13)}${padL("Eff.total", 12)}  ${pad("OK", 4)}`);
  let ok = 0, bad = 0;
  const fresh = (await getAllCourseEnrollments()).filter(
    (e) => courseIds.has(e.course_id) && e.status !== "cancelled" && (e.batch_label || "") === BATCH_LABEL,
  );
  for (const e of fresh) {
    const d = deriveEnrollment(e);
    const ledger = await ledgerPaidFor(e.id);
    const balances = commit ? (ledger === d.paid && d.paid + d.remaining === e.total_fee) : (d.paid + d.remaining === e.total_fee);
    if (balances) ok++; else bad++;
    console.log(`  ${pad(e.student_name, 20)}${pad(e.phone, 13)}${padL(money(ledger), 13)}${padL(money(d.paid), 12)}${padL(money(d.remaining), 13)}${padL(money(e.total_fee), 12)}  ${pad(balances ? "✓" : "✗", 4)}`);
  }
  console.log("");
  console.log(`  Reconciled: ${ok} / ${fresh.length}   Mismatched: ${bad}`);
  console.log("");
  console.log(hr("="));
  console.log(commit ? "COMMIT COMPLETE." : "DRY-RUN COMPLETE — nothing written. Re-run with --commit to apply.");
  console.log(hr("="));
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
