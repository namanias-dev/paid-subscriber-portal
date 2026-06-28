import { NextResponse } from "next/server";
import { requireAdmin, requireSuperAdmin, getActionActor } from "@/lib/adminGuard";
import { editPaymentById } from "@/lib/dataProvider";
import { logPaymentAction } from "@/lib/paymentActions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Edit safe fields on a payment (amount, status, reference_no, student_name,
 * payment_mode). SUPER ADMIN ONLY. Re-syncs the affected course enrollment and
 * writes an immutable payment_action_log entry with old->new values.
 */
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!(await requireSuperAdmin())) return NextResponse.json({ ok: false, error: "Forbidden — Super Admin only." }, { status: 403 });
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    paymentId?: string;
    reason?: string;
    patch?: { amount?: number; status?: string; reference_no?: string; student_name?: string; payment_mode?: string };
  };
  if (!body.paymentId || !body.patch) return NextResponse.json({ ok: false, error: "Missing payment or changes." }, { status: 400 });
  if (!(body.reason || "").trim()) return NextResponse.json({ ok: false, error: "A reason is required to edit a payment." }, { status: 400 });

  try {
    const r = await editPaymentById(body.paymentId, body.patch as never);
    if (r.ok && !r.noop && r.payment) {
      await logPaymentAction({
        action: "edit",
        payment: r.payment,
        actor,
        oldStatus: (r.oldValues?.status as string) ?? r.payment.status,
        newStatus: r.payment.status,
        reason: body.reason ?? null,
        metadata: { old: r.oldValues ?? {}, new: r.newValues ?? {} },
      });
    }
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
