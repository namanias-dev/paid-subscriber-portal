import { NextResponse } from "next/server";
import { requireAdmin, requireSuperAdmin, getActionActor } from "@/lib/adminGuard";
import { reversePaymentAction } from "@/lib/paymentActions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reverse a previously-approved payment. SUPER ADMIN ONLY. Requires a reason.
 * Reverts the payment to its prior status, safely undoes downstream effects
 * (course schedule + receipt + access re-lock), and writes an immutable
 * payment_action_log entry. Never deletes the payment row or the proof file.
 */
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!(await requireSuperAdmin())) {
    return NextResponse.json({ ok: false, error: "Forbidden — Super Admin only." }, { status: 403 });
  }
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { paymentId?: string; reason?: string };
  if (!body.paymentId) return NextResponse.json({ ok: false, error: "Missing payment." }, { status: 400 });
  if (!(body.reason || "").trim()) {
    return NextResponse.json({ ok: false, error: "A reason is required to reverse an approval." }, { status: 400 });
  }

  try {
    const r = await reversePaymentAction({ paymentId: body.paymentId, reason: body.reason!, actor });
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    console.error("[admin/payments/reverse] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
