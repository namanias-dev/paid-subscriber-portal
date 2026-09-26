import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { HISTORICAL_INVOICE_ORDER, issueHistoricalStoreInvoice } from "@/lib/store/invoice/issue";

export const dynamic = "force-dynamic";

/** One authorized historical bill. Every other order number is refused. */
export async function POST(req: Request) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { orderNo?: string };
  if (body.orderNo !== HISTORICAL_INVOICE_ORDER) {
    return NextResponse.json({ ok: false, error: "This issuer only accepts NIAS-N-2026-001001." }, { status: 400 });
  }
  const result = await issueHistoricalStoreInvoice(body.orderNo);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
