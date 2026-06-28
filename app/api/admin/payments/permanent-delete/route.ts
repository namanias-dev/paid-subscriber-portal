import { NextResponse } from "next/server";
import { requireAdmin, requireSuperAdmin, getActionActor } from "@/lib/adminGuard";
import { permanentDeletePaymentById } from "@/lib/dataProvider";
import { logPaymentAction } from "@/lib/paymentActions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * PERMANENTLY delete a payment row. SUPER ADMIN ONLY. Only allowed for rows that
 * are already in Trash (soft-deleted). Irreversible — logged to payment_action_log
 * BEFORE the row is removed so the audit trail survives the deletion.
 */
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!(await requireSuperAdmin())) return NextResponse.json({ ok: false, error: "Forbidden — Super Admin only." }, { status: 403 });
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { paymentId?: string; reason?: string };
  if (!body.paymentId) return NextResponse.json({ ok: false, error: "Missing payment." }, { status: 400 });
  if (!(body.reason || "").trim()) return NextResponse.json({ ok: false, error: "A reason is required to permanently delete a payment." }, { status: 400 });

  try {
    const { getPaymentById } = await import("@/lib/dataProvider");
    const target = await getPaymentById(body.paymentId);
    if (target) {
      // Log first so the immutable audit survives even though the row is removed.
      await logPaymentAction({
        action: "permanent_delete",
        payment: target,
        actor,
        oldStatus: target.status,
        newStatus: "DELETED",
        reason: body.reason ?? null,
        metadata: { item: target.item, item_type: target.item_type, amount: target.amount, reference_no: target.reference_no },
      });
    }
    const r = await permanentDeletePaymentById(body.paymentId);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
