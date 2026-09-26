import { NextResponse } from "next/server";
import { getActionActor, requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { validateGstin } from "@/lib/store/invoice/gstin";

export const dynamic = "force-dynamic";

const FIELDS = ["display_name", "legal_name", "trade_name", "address_line", "city", "state", "state_code", "pincode", "gstin", "pan", "support_phone", "support_email", "invoice_prefix", "price_tax_mode", "document_mode", "legal_footer", "signatory_name", "logo_url", "constitution", "gst_registration_status", "registration_type"] as const;

export async function GET() {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const { data } = await db.from("store_invoice_settings").select("*").eq("id", 1).maybeSingle();
  const row = (data || {}) as Record<string, string | null>;
  const missing = !row.legal_name || !row.address_line || !row.gstin;
  const { data: products } = await db.from("store_products").select("name,tax_configuration_status").is("archived_at", null);
  const pending = (products || []).filter((product) => product.tax_configuration_status !== "CONFIRMED").map((product) => product.name);
  const classification = pending.length ? `${pending.join(", ")} still need a confirmed HSN/tax classification.` : null;
  return NextResponse.json({
    ok: true,
    settings: row,
    warning: missing ? "Legal supplier name, address, or GSTIN is not complete." : classification,
    futureOnly: "Changing these settings affects future invoices only. Issued invoices keep their snapshot.",
  });
}

export async function POST(req: Request) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, string | boolean | null> = {};
  patch.updated_at = new Date().toISOString();
  for (const key of FIELDS) {
    if (body[key] !== undefined) patch[key] = body[key] == null ? null : String(body[key]).trim() || null;
  }
  if (typeof body.show_bank_details === "boolean") patch.show_bank_details = body.show_bank_details;
  if (typeof patch.gstin === "string" && patch.gstin) {
    const checked = validateGstin(patch.gstin);
    if (!checked.ok) return NextResponse.json({ ok: false, error: checked.error }, { status: 400 });
    patch.gstin = checked.gstin;
    patch.pan = checked.pan;
    if (patch.state_code && patch.state_code !== checked.stateCode) {
      return NextResponse.json({ ok: false, error: "State code does not match the GSTIN." }, { status: 400 });
    }
    patch.state_code = checked.stateCode;
  }
  const actor = await getActionActor();
  void actor;
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const { error } = await db.from("store_invoice_settings").update(patch).eq("id", 1);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
