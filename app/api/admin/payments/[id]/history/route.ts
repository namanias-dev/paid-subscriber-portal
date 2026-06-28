import { NextResponse } from "next/server";
import { requireAdmin, requireSuperAdmin } from "@/lib/adminGuard";
import { getPaymentActionHistory } from "@/lib/paymentActions";

export const dynamic = "force-dynamic";

/**
 * Super-admin-only per-payment lifecycle history (uploaded by X -> approved by Y
 * -> reversed by Z, with reasons + times). Read straight from the immutable
 * payment_action_log ledger.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!(await requireSuperAdmin())) {
    return NextResponse.json({ ok: false, error: "Forbidden — Super Admin only." }, { status: 403 });
  }
  try {
    const history = await getPaymentActionHistory(params.id);
    return NextResponse.json({ ok: true, history });
  } catch (e) {
    console.error("[admin/payments/:id/history] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
