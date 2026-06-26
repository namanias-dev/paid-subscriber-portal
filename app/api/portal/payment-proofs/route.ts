import { NextResponse } from "next/server";
import { getBuyerSession } from "@/lib/session";
import {
  getRecoveryItemsForPhone,
  submitPaymentProof,
  PROOF_MAX_FILES,
  PROOF_ALLOWED_TYPES,
  PROOF_MAX_BYTES,
} from "@/lib/paymentProofs";
import type { PaymentProofFile } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Unresolved recovery items for the logged-in buyer (popup + banner source). */
export async function GET() {
  const session = await getBuyerSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  try {
    const items = await getRecoveryItemsForPhone(session.phone);
    return NextResponse.json({ ok: true, items });
  } catch (e) {
    console.error("[portal/payment-proofs] GET failed:", (e as Error).message);
    return NextResponse.json({ ok: true, items: [] });
  }
}

/** Submit (or re-submit) proof for one of the buyer's own unresolved payments. */
export async function POST(req: Request) {
  const session = await getBuyerSession();
  if (!session) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    paymentId?: string;
    note?: string;
    files?: PaymentProofFile[];
  };
  if (!body.paymentId) return NextResponse.json({ ok: false, error: "Missing payment." }, { status: 400 });

  const files = (body.files || []).filter((f) => f && f.key).slice(0, PROOF_MAX_FILES);
  if (!files.length) return NextResponse.json({ ok: false, error: "Attach at least one file." }, { status: 400 });
  for (const f of files) {
    if (!PROOF_ALLOWED_TYPES.includes(f.content_type)) {
      return NextResponse.json({ ok: false, error: "Only images and PDF are allowed." }, { status: 400 });
    }
    if ((f.size || 0) > PROOF_MAX_BYTES) {
      return NextResponse.json({ ok: false, error: "Each file must be 8 MB or smaller." }, { status: 400 });
    }
  }

  const res = await submitPaymentProof({
    paymentId: body.paymentId,
    phone: session.phone,
    files,
    note: typeof body.note === "string" ? body.note.slice(0, 1000) : null,
  });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true, proof: res.proof });
}
