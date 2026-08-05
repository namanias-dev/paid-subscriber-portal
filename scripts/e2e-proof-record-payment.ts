/**
 * E2E: approve & record payment on qa_blocked (non-armed).
 * Uses recordOfflineCoursePayment path; tears down compensating reverse.
 *
 *   npx tsx --require ./scripts/react-cache-shim.cjs scripts/e2e-proof-record-payment.ts
 */
import { readFileSync, existsSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { QA_INSTALLMENT_PROOF_STUDENTS } from "../lib/qaInstallmentProofStudents";
import {
  submitInstallmentProof,
  uploadInstallmentProofFile,
  getPendingProofForEnrollment,
  listProofsForEnrollment,
} from "../lib/installmentPaymentProofs";
import {
  approveAndRecordInstallmentProof,
  reverseProofRecordedPayment,
  getProofRecordPreview,
} from "../lib/installmentProofRecordPayment";
import { getCourseEnrollmentsByPhone, getPaymentsByPhone } from "../lib/dataProvider";
import { deriveEnrollment } from "../lib/installments";

function loadEnv() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    const v = m[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const actor = { id: "e2e", name: "e2e-proof-record" };

async function main() {
  const qa = QA_INSTALLMENT_PROOF_STUDENTS.qa_blocked;
  if (!qa) throw new Error("qa_blocked missing");
  const phone = qa.phone;

  const enrollments = await getCourseEnrollmentsByPhone(phone);
  const e = enrollments.find((x) => x.status !== "cancelled" && x.status !== "transferred_out");
  if (!e) throw new Error("no enrollment");

  const before = deriveEnrollment(e);
  console.log(JSON.stringify({ step: "before", remaining: before.remaining, paid: before.paid }, null, 2));

  // Minimal 1x1 PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const up = await uploadInstallmentProofFile({
    phone,
    studentId: null,
    installmentNo: before.nextPayable?.no || 1,
    originalName: "e2e.png",
    buffer: png,
  });
  if (!up.ok) throw new Error(up.error);

  const sub = await submitInstallmentProof({
    phone,
    enrollmentId: e.id,
    installmentNo: before.nextPayable?.no || 1,
    files: [up.file],
    claimedAmount: before.nextPayable?.amount || null,
    studentComment: "e2e approve&record — reverse after",
  });
  if (!sub.ok) throw new Error(sub.error);
  const proofId = sub.proof.id;

  const preview = await getProofRecordPreview(proofId);
  if (!preview.ok) throw new Error(preview.error);

  const amount = preview.expected.amount;
  const r1 = await approveAndRecordInstallmentProof({
    proofId,
    actor,
    amount,
    paymentDate: new Date().toISOString().slice(0, 10),
    seenProofConfirmed: true,
  });
  if (!r1.ok) throw new Error(r1.error);
  console.log(JSON.stringify({ step: "record", paymentId: r1.payment.id, amount: r1.payment.amount, already: r1.alreadyRecorded }, null, 2));

  // Idempotency
  const r2 = await approveAndRecordInstallmentProof({
    proofId,
    actor,
    amount,
    seenProofConfirmed: true,
  });
  if (!r2.ok) throw new Error(r2.error);
  if (r2.payment.id !== r1.payment.id) throw new Error("idempotency broken — two payments");
  console.log(JSON.stringify({ step: "idempotent", sameId: true }, null, 2));

  const afterEnr = (await getCourseEnrollmentsByPhone(phone)).find((x) => x.id === e.id)!;
  const after = deriveEnrollment(afterEnr);
  console.log(JSON.stringify({ step: "after_record", remaining: after.remaining, paid: after.paid }, null, 2));

  const payments = await getPaymentsByPhone(phone);
  const proofPay = payments.find((p) => p.proof_id === proofId);
  if (!proofPay) throw new Error("payment not tagged with proof_id");

  const rev = await reverseProofRecordedPayment({
    paymentId: proofPay.id,
    actor,
    reason: "e2e teardown reverse",
  });
  if (!rev.ok) throw new Error(rev.error);
  console.log(JSON.stringify({ step: "reversed", reversalId: rev.reversal.id }, null, 2));

  const finalEnr = (await getCourseEnrollmentsByPhone(phone)).find((x) => x.id === e.id)!;
  const finalD = deriveEnrollment(finalEnr);
  console.log(JSON.stringify({ step: "after_reverse", remaining: finalD.remaining, paid: finalD.paid, ok: true }, null, 2));

  // Armed sends untouched check
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const cohorts = ["pilot_10", "queued_53", "classic_grace_10"];
  const armed: Record<string, number> = {};
  for (const c of cohorts) {
    const { data } = await sb.from("grandfather_notice_queue").select("armed").eq("cohort", c);
    armed[c] = (data || []).filter((r: { armed: boolean }) => r.armed).length;
  }
  const { data: settings } = await sb
    .from("access_reminder_settings")
    .select("enabled,dry_run")
    .eq("id", 1)
    .maybeSingle();
  console.log(JSON.stringify({ step: "armed", armed, settings }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
