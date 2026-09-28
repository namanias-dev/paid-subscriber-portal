import { NextResponse } from "next/server";
import { requireStoreOrderRead, requireSuperAdmin } from "@/lib/adminGuard";
import { issueRecoveryLink, listCheckoutLeads, updateCheckoutLeadSales } from "@/lib/store/checkoutLeads";
import { SALES_STATUSES, type SalesStatus } from "@/lib/store/checkoutLeadLogic";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await requireStoreOrderRead())) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const canUpdate = await requireSuperAdmin();
  const filter = new URL(req.url).searchParams.get("filter") || "open";
  const leads = await listCheckoutLeads(filter);
  let activity: Record<string, { lines: string[] }> = {};
  try {
    const { loadLeadAlertActivity } = await import("@/lib/telegram/notesLeadAlert");
    const ids = leads.map((lead) => String(lead.id || "")).filter(Boolean);
    activity = await loadLeadAlertActivity(ids);
  } catch { /* the lead list still renders */ }
  const withAlert = leads.map((lead) => ({ ...lead, sales_alert: activity[String(lead.id)] || { lines: [] } }));
  return NextResponse.json({ ok: true, leads: withAlert, can_update: canUpdate }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: Request) {
  if (!(await requireSuperAdmin())) {
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
