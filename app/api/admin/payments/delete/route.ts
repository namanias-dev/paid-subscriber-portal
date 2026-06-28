import { NextResponse } from "next/server";
import { requireAdmin, requireSuperAdmin, getActionActor } from "@/lib/adminGuard";
import { softDeletePaymentById } from "@/lib/dataProvider";
import { logPaymentAction } from "@/lib/paymentActions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Soft-delete a payment to the recoverable Trash. SUPER ADMIN ONLY. Never hard-
 * deletes: sets deleted_at/by/reason, drops the receipt + recomputes the enrollment
 * (re-locks access), and writes an immutable payment_action_log entry.
 */
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!(await requireSuperAdmin())) return NextResponse.json({ ok: false, error: "Forbidden — Super Admin only." }, { status: 403 });
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { paymentId?: string; reason?: string };
  if (!body.paymentId) return NextResponse.json({ ok: false, error: "Missing payment." }, { status: 400 });
  if (!(body.reason || "").trim()) return NextResponse.json({ ok: false, error: "A reason is required to delete a payment." }, { status: 400 });

  try {
    const r = await softDeletePaymentById(body.paymentId, body.reason!, actor.id);
    if (r.ok && !r.noop && r.payment) {
      await logPaymentAction({
        action: "soft_delete",
        payment: r.payment,
        actor,
        oldStatus: r.payment.status,
        newStatus: r.payment.status,
        reason: body.reason ?? null,
        metadata: { item: r.payment.item, item_type: r.payment.item_type, amount: r.payment.amount },
      });
    }
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
