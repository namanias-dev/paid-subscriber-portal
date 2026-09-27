import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { applyStoreVerify } from "@/lib/store/payments/verify";

export const dynamic = "force-dynamic";

/**
 * Re-check the gateway and finalize the existing checkout. Never marks an
 * order paid from the click itself — EazyPGVerify remains the only authority.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  const { data: payment } = await db
    .from("store_order_payments")
    .select("reference_no,status")
    .eq("order_id", params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!payment?.reference_no) {
    return NextResponse.json({ ok: false, error: "No payment to reconcile" }, { status: 404 });
  }

  const result = await applyStoreVerify(payment.reference_no, { source: "admin-reconcile" });
  return NextResponse.json(
    {
      ok: true,
      outcome: result.outcome,
      status: result.status,
      changed: result.changed,
      order_no: result.orderNo || null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
