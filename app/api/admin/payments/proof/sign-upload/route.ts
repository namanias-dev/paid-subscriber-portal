import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAdmin, requirePermission } from "@/lib/adminGuard";
import { getPaymentById, isPaidStatus } from "@/lib/dataProvider";
import { getProofByPaymentId, PROOF_ALLOWED_TYPES, PROOF_MAX_BYTES, PROOF_MAX_FILES } from "@/lib/paymentProofs";
import { r2Configured, signPutUrl, paymentProofKey } from "@/lib/r2";

export const dynamic = "force-dynamic";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * Staff/admin: mint a short-lived signed PUT so the browser uploads payment proof
 * (on a student's behalf) straight to the private R2 payment-proofs bucket. Gated
 * by manage_payments. Mirrors the student sign-upload but with no phone-ownership
 * check (staff act on any payment).
 */
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!(await requirePermission("manage_payments"))) {
    return NextResponse.json({ ok: false, error: "Forbidden — manage_payments required." }, { status: 403 });
  }
  if (!r2Configured()) return NextResponse.json({ ok: false, error: "Uploads are temporarily unavailable." }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as {
    paymentId?: string;
    fileName?: string;
    contentType?: string;
    size?: number;
  };
  if (!body.paymentId) return NextResponse.json({ ok: false, error: "Missing payment." }, { status: 400 });
  const contentType = (body.contentType || "").toLowerCase();
  if (!PROOF_ALLOWED_TYPES.includes(contentType)) {
    return NextResponse.json({ ok: false, error: "Only images and PDF are allowed." }, { status: 400 });
  }
  if ((body.size || 0) > PROOF_MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "Each file must be 8 MB or smaller." }, { status: 400 });
  }

  const payment = await getPaymentById(body.paymentId);
  if (!payment) return NextResponse.json({ ok: false, error: "Payment not found." }, { status: 404 });
  if (isPaidStatus(payment.status)) {
    return NextResponse.json({ ok: false, error: "This payment is already confirmed." }, { status: 400 });
  }

  const existing = await getProofByPaymentId(body.paymentId);
  if ((existing?.files.length ?? 0) >= PROOF_MAX_FILES) {
    return NextResponse.json({ ok: false, error: `Up to ${PROOF_MAX_FILES} files only.` }, { status: 400 });
  }

  const fileId = randomUUID();
  const key = paymentProofKey(body.paymentId, fileId, EXT[contentType] || "bin");
  try {
    const uploadUrl = await signPutUrl(key, contentType, 600);
    return NextResponse.json({
      ok: true,
      uploadUrl,
      file: {
        key,
        name: (body.fileName || "proof").slice(0, 180),
        content_type: contentType,
        size: body.size || 0,
        uploaded_at: new Date().toISOString(),
      },
    });
  } catch (e) {
    console.error("[admin/payments/proof/sign-upload] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: "Could not start the upload." }, { status: 500 });
  }
}
