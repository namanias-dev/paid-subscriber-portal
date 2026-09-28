import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { ensureStoreInvoice, invoiceDownloadUrl } from "@/lib/store/invoice/issue";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const url = new URL(req.url);
  if (url.searchParams.get("download") === "1") {
    const file = await invoiceDownloadUrl(params.id, { attachment: url.searchParams.get("attachment") === "1" });
    if (!file) return NextResponse.json({ ok: false, error: "Unable to open invoice. Try again." }, { status: 409 });
    if (url.searchParams.get("format") === "json") {
      return NextResponse.json({ ok: true, url: file.url, invoiceNumber: file.invoiceNumber }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.redirect(file.url, 302);
  }
  const { data } = await db.from("store_invoices").select("invoice_number,document_type,status,issued_at,grand_total_minor,taxable_minor,cgst_minor,sgst_minor,utgst_minor,igst_minor,gateway_reference,attention,credit_note_status,seller_snapshot,line_items_snapshot,place_of_supply_state_code").eq("order_id", params.id).maybeSingle();
  return NextResponse.json({ ok: true, invoice: data || null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { retry?: boolean };
  if (!body.retry) return NextResponse.json({ ok: false, error: "Retry was not requested." }, { status: 400 });
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const { data } = await db.from("store_invoices").select("status,invoice_number").eq("order_id", params.id).maybeSingle();
  if (!data) return NextResponse.json({ ok: false, error: "There is no invoice to retry." }, { status: 404 });
  if (data.status !== "FAILED") return NextResponse.json({ ok: false, error: "Only a failed PDF can be regenerated." }, { status: 409 });
  await db.from("store_invoices").update({ status: "PENDING", updated_at: new Date().toISOString() }).eq("order_id", params.id);
  const result = await ensureStoreInvoice(params.id);
  const file = result.status === "READY" ? await invoiceDownloadUrl(params.id) : null;
  return NextResponse.json({ ...result, url: file?.url || null });
}
