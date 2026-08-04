import { NextResponse } from "next/server";
import { getBuyerSession } from "@/lib/session";
import { findStudentByPhone } from "@/lib/dataProvider";
import {
  uploadInstallmentProofFile,
  submitInstallmentProof,
  getProofById,
  listProofsForEnrollment,
  INSTALLMENT_PROOF_MAX_FILES,
} from "@/lib/installmentPaymentProofs";
import { studentPopupEnabledForPhone } from "@/lib/installmentProofFlags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Upload one file (multipart) — magic-byte validated server-side. */
export async function PUT(req: Request) {
  const session = await getBuyerSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!(await studentPopupEnabledForPhone(session.phone))) {
    return NextResponse.json({ ok: false, error: "Not available." }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: "Invalid form." }, { status: 400 });
  const file = form.get("file");
  const installmentNo = Number(form.get("installmentNo") || 0);
  if (!(file instanceof File) || !installmentNo) {
    return NextResponse.json({ ok: false, error: "file and installmentNo required." }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const student = await findStudentByPhone(session.phone);
  const r = await uploadInstallmentProofFile({
    phone: session.phone,
    studentId: student?.id ?? null,
    installmentNo,
    originalName: file.name || "upload",
    buffer: buf,
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, file: r.file });
}

/** Submit / append proof metadata after files uploaded. */
export async function POST(req: Request) {
  const session = await getBuyerSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!(await studentPopupEnabledForPhone(session.phone))) {
    return NextResponse.json({ ok: false, error: "Not available." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const files = Array.isArray(body.files) ? body.files.slice(0, INSTALLMENT_PROOF_MAX_FILES) : [];
  const r = await submitInstallmentProof({
    phone: session.phone,
    enrollmentId: String(body.enrollmentId || ""),
    installmentNo: Number(body.installmentNo || 0),
    files,
    claimedAmount: body.claimedAmount != null ? Number(body.claimedAmount) : null,
    claimedPaidDate: body.claimedPaidDate ? String(body.claimedPaidDate).slice(0, 10) : null,
    referenceUtr: body.referenceUtr ? String(body.referenceUtr).slice(0, 80) : null,
    studentComment: body.studentComment ? String(body.studentComment).slice(0, 500) : null,
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, proof: r.proof });
}

export async function GET(req: Request) {
  const session = await getBuyerSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const enrollmentId = url.searchParams.get("enrollmentId");
  if (id) {
    const proof = await getProofById(id);
    if (!proof || proof.phone.replace(/\D/g, "").slice(-10) !== session.phone.replace(/\D/g, "").slice(-10)) {
      return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, proof });
  }
  if (enrollmentId) {
    const proofs = await listProofsForEnrollment(enrollmentId);
    const mine = proofs.filter(
      (p) => p.phone.replace(/\D/g, "").slice(-10) === session.phone.replace(/\D/g, "").slice(-10),
    );
    return NextResponse.json({ ok: true, proofs: mine });
  }
  return NextResponse.json({ ok: false, error: "id or enrollmentId required" }, { status: 400 });
}
