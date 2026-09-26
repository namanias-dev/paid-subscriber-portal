import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { correctInvoiceSellerDisplay, SELLER_DISPLAY_CORRECTION_REASON } from "@/lib/store/invoice/correct";

export const dynamic = "force-dynamic";

const CORRECTABLE_INVOICE = "NIA/26-27/00001";

/** One clerical presentation correction. Does not allocate an invoice number. */
export async function POST(req: Request) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { invoiceNumber?: string; reason?: string };
  if (body.invoiceNumber !== CORRECTABLE_INVOICE || body.reason !== SELLER_DISPLAY_CORRECTION_REASON) {
    return NextResponse.json({ ok: false, error: "This correction is not available for that document." }, { status: 400 });
  }
  const result = await correctInvoiceSellerDisplay(body.invoiceNumber);
  if (!result.ok) console.info(`[store/invoice] display_correction_refused number=${body.invoiceNumber}`);
  return NextResponse.json(
    { ok: result.ok, invoiceNumber: result.invoiceNumber, error: result.ok ? undefined : "Unable to correct the invoice." },
    { status: result.ok ? 200 : 409 },
  );
}
