import { NextResponse } from "next/server";
import { getBuyerSession } from "@/lib/session";
import { studentPopupEnabledForPhone } from "@/lib/installmentProofFlags";
import { buildInstallmentProofPrompt } from "@/lib/installmentPaymentProofs";

export const dynamic = "force-dynamic";

/** Serializable prompt props for the portal popup. Flag-gated. */
export async function GET() {
  const session = await getBuyerSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const enabled = await studentPopupEnabledForPhone(session.phone);
  if (!enabled) return NextResponse.json({ ok: true, enabled: false, prompt: null });
  const prompt = await buildInstallmentProofPrompt(session.phone);
  return NextResponse.json({ ok: true, enabled: true, prompt });
}
