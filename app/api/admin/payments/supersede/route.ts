import { NextResponse } from "next/server";
import { requireAdmin, requirePermission, getActionActor } from "@/lib/adminGuard";
import { getPaymentById } from "@/lib/dataProvider";
import { isPaidStatus } from "@/lib/paymentsAgg";
import { recomputeGroupSupersession } from "@/lib/paymentSupersede";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Manually mark the OTHER open unpaid attempts in a PAID/approved group as
 * superseded. Soft, logged and reversible (it self-clears if the paid attempt is
 * later reversed). Never deletes a row and never touches a paid attempt.
 * Requires manage_payments. The given paymentId must be a PAID row so we only
 * ever supersede unpaid siblings of a settled payment.
 */
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!(await requirePermission("manage_payments"))) {
    return NextResponse.json({ ok: false, error: "Forbidden — payment management access required." }, { status: 403 });
  }
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { paymentId?: string };
  if (!body.paymentId) return NextResponse.json({ ok: false, error: "Missing payment." }, { status: 400 });

  try {
    const payment = await getPaymentById(body.paymentId);
    if (!payment) return NextResponse.json({ ok: false, error: "Payment not found." }, { status: 404 });
    if (!isPaidStatus(payment.status)) {
      return NextResponse.json(
        { ok: false, error: "Only a paid/approved payment can supersede its sibling attempts." },
        { status: 400 },
      );
    }
    const r = await recomputeGroupSupersession(payment, actor);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error("[admin/payments/supersede] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
