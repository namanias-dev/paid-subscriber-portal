/**
 * ONE-TIME reconcile for the "Saarthi (Old)" legacy import.
 * (Cloned from reconcile-safalta-payments.ts — that script is left UNTOUCHED.)
 *
 * Fixes two bugs, both idempotent and safe to re-run:
 *
 *  BUG 1 — Imported payments not reflected in "Total Paid" / finance dashboard.
 *    The import wrote paid money onto the enrollment SCHEDULE only. The admin
 *    "Total Paid" tile, the payments ledger and the finance dashboard read the
 *    `payments` table (getBuyerPurchases), which had NO rows for these students.
 *    Fix: backfill ONE PAID ledger row per already-paid schedule line (no SMS /
 *    no Meta pixel / no schedule mutation) so every surface agrees.
 *
 *  BUG 2 — Abandoned checkouts left as PENDING.
 *    Pressing Back after opening the gateway left a spurious PENDING row. Fix
 *    (code): new checkouts are created as INITIATED and evidence-less open
 *    attempts expire to ABANDONED. This script also cleans up the pre-fix
 *    spurious PENDING rows across the whole payments table (evidence-less only).
 *
 * DRY-RUN by default; pass --commit to write. Needs Supabase creds in the env:
 *   node --env-file=.env.local --import tsx scripts/reconcile-saarthi-payments.ts
 *   node --env-file=.env.local --import tsx scripts/reconcile-saarthi-payments.ts --commit
 *
 * Flags:
 *   --commit             actually write (default: dry-run)
 *   --minutes <n>        abandon window for BUG 2 cleanup (default 30)
 *   --skip-abandon       run only the BUG 1 backfill
 *   --skip-backfill      run only the BUG 2 cleanup
 */
import {
  getCourseBySlug,
  getAllCourseEnrollments,
  getPaymentsByEnrollmentId,
  getBuyerPurchases,
  backfillCoursePaymentLedgerBySlug,
  abandonEvidencelessOpenPayments,
  isPaidStatus,
} from "../lib/dataProvider";
import { getSupabaseAdmin } from "../lib/supabase";
import { deriveEnrollment } from "../lib/installments";
import { formatINR } from "../lib/dates";
import type { CourseEnrollment } from "../lib/types";

const COURSE_SLUG = "saarthi-old";
const REFERENCE_PHONE = "7354132216"; // Egesh — the reported student

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
  const skipAbandon = args.includes("--skip-abandon");
  const skipBackfill = args.includes("--skip-backfill");
  const minutesArg = args.indexOf("--minutes");
  const minutes = minutesArg >= 0 ? Number(args[minutesArg + 1]) : 30;

  console.log(hr("="));
  console.log(`  SAARTHI (OLD) — PAYMENT RECONCILE   ${commit ? ">>> COMMIT (WRITES) <<<" : "DRY-RUN (writes nothing)"}`);
  console.log(hr("="));

  const db = getSupabaseAdmin();
  if (!db) {
    console.error("✗ Supabase not configured. Provide NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (e.g. --env-file=.env.local).");
    process.exit(1);
  }

  const course = await getCourseBySlug(COURSE_SLUG);
  if (!course) { console.error(`✗ Legacy course "${COURSE_SLUG}" not found.`); process.exit(1); }
  const all = await getAllCourseEnrollments();
  const enrollments = all.filter((e) => e.course_id === course.id && e.status !== "cancelled");
  console.log(`  Legacy course: ${course.title} (${course.id})`);
  console.log(`  Active enrollments: ${enrollments.length}`);
  console.log("");

  // -------------------- BUG 1: backfill payment ledger --------------------
  if (!skipBackfill) {
    console.log(hr());
    console.log(`BUG 1 — Backfill PAID ledger rows (${commit ? "writing" : "dry-run"})`);
    console.log(hr());
    const r = await backfillCoursePaymentLedgerBySlug(COURSE_SLUG, { dryRun: !commit });
    console.log(`  Enrollments scanned : ${r.enrollments}`);
    console.log(`  Ledger rows ${commit ? "created" : "to create"} : ${r.created}   (₹ ${money(r.amount)})`);
    console.log(`  Already present (skipped): ${r.skippedExisting}`);
    console.log("");
  }

  // -------------------- BUG 2: abandon evidence-less open attempts ---------
  if (!skipAbandon) {
    console.log(hr());
    console.log(`BUG 2 — Abandon evidence-less open checkouts older than ${minutes} min (${commit ? "writing" : "dry-run"})`);
    console.log(hr());
    const a = await abandonEvidencelessOpenPayments({ olderThanMinutes: minutes, dryRun: !commit });
    console.log(`  Open attempts scanned      : ${a.scanned}`);
    console.log(`  ${commit ? "Abandoned" : "Would abandon"}                : ${a.abandoned}`);
    console.log(`  Kept (had gateway evidence): ${a.keptEvidence}`);
    console.log(`  Kept (proof uploaded)      : ${a.keptProof}`);
    console.log(`  Kept (a paid sibling won)  : ${a.keptPaidSibling}`);
    if (a.referenceNos.length) console.log(`  Refs: ${a.referenceNos.slice(0, 30).join(", ")}${a.referenceNos.length > 30 ? " …" : ""}`);
    console.log("");
  }

  // -------------------- VERIFY: per-enrollment reconciliation -------------
  console.log(hr());
  console.log("VERIFICATION — Total Paid (payments ledger) vs schedule-derived paid, per enrollment");
  console.log(hr());
  console.log(`  ${pad("Name", 20)}${pad("Phone", 13)}${padL("Ledger paid", 13)}${padL("Sched paid", 12)}${padL("Outstanding", 13)}${padL("Eff.total", 12)}  ${pad("OK", 4)}`);
  let ok = 0, bad = 0;
  const fresh = (await getAllCourseEnrollments()).filter((e) => e.course_id === course.id && e.status !== "cancelled");
  let egesh: { e: CourseEnrollment; ledger: number } | null = null;
  for (const e of fresh) {
    const d = deriveEnrollment(e);
    const ledger = await ledgerPaidFor(e.id);
    const balances = ledger === d.paid && d.paid + d.remaining === e.total_fee;
    if (balances) ok++; else bad++;
    if ((e.phone || "").trim() === REFERENCE_PHONE) egesh = { e, ledger };
    if (!balances) {
      console.log(`  ${pad(e.student_name, 20)}${pad(e.phone, 13)}${padL(money(ledger), 13)}${padL(money(d.paid), 12)}${padL(money(d.remaining), 13)}${padL(money(e.total_fee), 12)}  ${pad("✗", 4)}`);
    }
  }
  console.log("");
  console.log(`  Reconciled: ${ok} / ${fresh.length}   Mismatched: ${bad}`);
  console.log("");

  // -------------------- Egesh spotlight -----------------------------------
  console.log(hr());
  console.log(`REFERENCE STUDENT — Egesh (${REFERENCE_PHONE})`);
  console.log(hr());
  if (egesh) {
    const d = deriveEnrollment(egesh.e);
    const buyerPurchases = await getBuyerPurchases(REFERENCE_PHONE);
    const profileTotalPaid = buyerPurchases.reduce((a, p) => a + p.amount, 0);
    console.log(`  Enrollment total (effective): ${money(egesh.e.total_fee)}`);
    console.log(`  Schedule-derived paid       : ${money(d.paid)}`);
    console.log(`  Ledger paid (this course)   : ${money(egesh.ledger)}`);
    console.log(`  Admin "Total Paid" (all)    : ${money(profileTotalPaid)}  ← getBuyerPurchases (what the profile tile reads)`);
    console.log(`  Outstanding                 : ${money(d.remaining)}`);
    console.log(`  Next due                    : ${d.nextPayable ? `${money(d.nextPayable.amount)} (${d.nextPayable.label})` : "—"}`);
    const good = egesh.ledger === d.paid && profileTotalPaid >= d.paid;
    console.log(`  ${good ? "✓ Egesh's Total Paid now reflects the imported money." : "✗ Egesh still mismatched — investigate."}`);
  } else {
    console.log("  (no active legacy enrollment found for this phone)");
  }
  console.log("");
  console.log(hr("="));
  console.log(commit ? "COMMIT COMPLETE." : "DRY-RUN COMPLETE — nothing written. Re-run with --commit to apply.");
  console.log(hr("="));
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
