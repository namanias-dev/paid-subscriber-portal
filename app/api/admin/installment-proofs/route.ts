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
    return NextResponse.json({ ok: true, proof });
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
  return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
}
