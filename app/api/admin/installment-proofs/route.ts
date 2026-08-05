import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import { requireAnyPermission, currentAdminId } from "@/lib/adminGuard";
import {
  listPendingProofs,
  getProofById,
  listProofsForPhone,
  listProofsForEnrollment,
  approveInstallmentProof,
  rejectInstallmentProof,
  signedProofFileUrl,
} from "@/lib/installmentPaymentProofs";
import {
  approveAndRecordInstallmentProof,
  getProofRecordPreview,
  reverseProofRecordedPayment,
  markProofPaymentFinanceVerified,
  listProofPaymentsAwaitingFinance,
} from "@/lib/installmentProofRecordPayment";

export const dynamic = "force-dynamic";

const PERMS = ["view_revenue", "manage_payments"] as const;

export async function GET(req: Request) {
  if (!(await requireAnyPermission([...PERMS]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const phone = url.searchParams.get("phone");
  const enrollmentId = url.searchParams.get("enrollmentId");
  const filePath = url.searchParams.get("file");

  if (filePath && id) {
    const proof = await getProofById(id);
    if (!proof) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (!proof.files.some((f) => f.path === filePath)) {
      return NextResponse.json({ ok: false, error: "File not on this proof" }, { status: 404 });
    }
    const signed = await signedProofFileUrl(filePath);
    if (!signed) return NextResponse.json({ ok: false, error: "Could not sign URL" }, { status: 503 });
    return NextResponse.json({ ok: true, url: signed, expiresIn: 300 });
  }

  if (id) {
    const proof = await getProofById(id);
    if (!proof) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (url.searchParams.get("preview") === "1") {
      const preview = await getProofRecordPreview(id);
      if (!preview.ok) return NextResponse.json({ ok: false, error: preview.error }, { status: 400 });
      return NextResponse.json(preview);
    }
    return NextResponse.json({ ok: true, proof });
  }
  if (url.searchParams.get("finance_queue") === "1") {
    const rows = await listProofPaymentsAwaitingFinance();
    return NextResponse.json({ ok: true, rows, count: rows.length });
  }
  if (phone) {
    return NextResponse.json({ ok: true, proofs: await listProofsForPhone(phone) });
  }
  if (enrollmentId) {
    return NextResponse.json({ ok: true, proofs: await listProofsForEnrollment(enrollmentId) });
  }
  const pending = await listPendingProofs();
  return NextResponse.json({ ok: true, pending, count: pending.length });
}

export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session || !(await requireAnyPermission([...PERMS]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const actor = {
    id: (await currentAdminId()) || null,
    name: session.username || "admin",
  };

  if (action === "approve") {
    // Legacy alias → grant access only (safe fallback).
    const r = await approveInstallmentProof({ proofId: String(body.proof_id || ""), actor });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, proof: r.proof });
  }
  if (action === "approve_record") {
    const decisionRaw = String(body.decision || "record_keep_open");
    const decision =
      decisionRaw === "accept_as_partial" || decisionRaw === "record_keep_open" || decisionRaw === "reject"
        ? decisionRaw
        : "record_keep_open";
    if (decision === "reject") {
      return NextResponse.json(
        { ok: false, error: "Use action=reject for rejections." },
        { status: 400 },
      );
    }
    const r = await approveAndRecordInstallmentProof({
      proofId: String(body.proof_id || ""),
      actor,
      amount: Number(body.amount),
      paymentDate: body.payment_date ? String(body.payment_date) : null,
      referenceUtr: body.reference_utr ? String(body.reference_utr) : null,
      seenProofConfirmed: body.seen_proof === true,
      decision,
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error, code: r.code }, { status: 400 });
    return NextResponse.json({
      ok: true,
      proof: r.proof,
      payment: r.payment,
      alreadyRecorded: r.alreadyRecorded || false,
      alreadyPaidSuperseded: r.alreadyPaidSuperseded || false,
      decision,
    });
  }
  if (action === "grant_only") {
    const r = await approveInstallmentProof({ proofId: String(body.proof_id || ""), actor });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, proof: r.proof });
  }
  if (action === "reject") {
    const r = await rejectInstallmentProof({
      proofId: String(body.proof_id || ""),
      actor,
      reason: String(body.reason || ""),
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, proof: r.proof });
  }
  if (action === "finance_verify") {
    const r = await markProofPaymentFinanceVerified({ paymentId: String(body.payment_id || "") });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  if (action === "reverse_proof_payment") {
    const r = await reverseProofRecordedPayment({
      paymentId: String(body.payment_id || ""),
      actor,
      reason: String(body.reason || ""),
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, reversal: r.reversal });
  }
  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}
