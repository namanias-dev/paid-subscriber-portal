import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { issueRecoveryLink, listCheckoutLeads, updateCheckoutLeadSales } from "@/lib/store/checkoutLeads";
import { SALES_STATUSES, type SalesStatus } from "@/lib/store/checkoutLeadLogic";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const filter = new URL(req.url).searchParams.get("filter") || "open";
  const leads = await listCheckoutLeads(filter);
  return NextResponse.json({ ok: true, leads }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: Request) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (body.recovery === true && id) {
    const url = await issueRecoveryLink(id);
    return NextResponse.json({ ok: Boolean(url), url });
  }
  const sales = body.sales_status as SalesStatus;
  if (!id || !SALES_STATUSES.includes(sales)) {
    return NextResponse.json({ ok: false, error: "Invalid update" }, { status: 400 });
  }
  const ok = await updateCheckoutLeadSales(id, sales, typeof body.sales_note === "string" ? body.sales_note : undefined);
  return NextResponse.json({ ok });
}
