import { createHash } from "node:crypto";
import { storeDb } from "../db";
import { getObject, putObject } from "@/lib/r2";
import { formatRegisteredAddress } from "./address";
import { loadInvoiceLogo } from "./logo";
import { invoiceAuditObjectKey } from "./number";
import { renderInvoicePdf, type InvoicePdfModel } from "./pdf";
import { amountInWords, type TaxDocument } from "./tax";

export const SELLER_DISPLAY_CORRECTION_REASON =
  "Corrected GST registered address display and updated invoice branding.";

export interface SellerIdentity {
  legalName?: string | null;
  gstin?: string | null;
  stateCode?: string | null;
  displayName?: string | null;
}

export interface SellerSettingsAddress {
  address_floor_display?: string | null;
  address_floor_raw?: string | null;
  address_line?: string | null;
  address_sector?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  logo_url?: string | null;
}

/** Ready documents only. This never allocates a number. */
export function clericalCorrectionAllowed(input: { status: string; hasKey: boolean; hasTaxLines: boolean }): boolean {
  return input.status === "READY" && input.hasKey && input.hasTaxLines;
}

/** Customer-facing seller lines. Refuses a settings address that is not the corrected certificate display. */
export function correctedSellerDisplay(identity: SellerIdentity, settings: SellerSettingsAddress): { ok: boolean; lines: string[] } {
  const address = formatRegisteredAddress({
    floorDisplay: settings.address_floor_display,
    building: settings.address_line,
    sector: settings.address_sector,
    city: settings.city,
    state: settings.state,
    pincode: settings.pincode,
  });
  const joined = address.join(" ");
  const ok = joined.includes("Second Floor")
    && joined.includes("Sector 17C")
    && joined.includes("160030")
    && !joined.includes("160017")
    && !joined.includes("SECOUND")
    && !/\bSector 17,/.test(joined);
  const lines = [
    identity.legalName ? `Legal name: ${identity.legalName}` : "",
    identity.gstin ? `GSTIN: ${identity.gstin}` : "",
    ...address,
    identity.stateCode ? `State code: ${identity.stateCode}` : "",
  ].filter(Boolean);
  return { ok, lines };
}

async function readObjectBytes(key: string): Promise<Buffer | null> {
  const object = await getObject(key);
  if (!object) return null;
  const reader = object.body.transformToWebStream().getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    if (step.value) chunks.push(step.value);
  }
  return Buffer.concat(chunks);
}

/**
 * Replace the PDF for an existing invoice. Financial columns, issue date, and the
 * invoice number stay as stored. The previous PDF is kept on a private audit key.
 */
export async function correctInvoiceSellerDisplay(
  invoiceNumber: string,
  opts?: { logoPng?: Uint8Array | null },
): Promise<{ ok: boolean; invoiceNumber: string | null; error?: string; previousSha?: string; sha?: string }> {
  const db = storeDb();
  if (!db) return { ok: false, invoiceNumber: null, error: "unavailable" };
  const { data: row } = await db
    .from("store_invoices")
    .select("id,order_id,invoice_number,financial_year,status,issued_at,paid_at,seller_snapshot,seller_snapshot_original,buyer_snapshot,shipping_snapshot,tax_summary,document_type,grand_total_minor,r2_object_key,pdf_sha256,pdf_size,pdf_generated_at,pdf_version,gateway_reference")
    .eq("invoice_number", invoiceNumber)
    .maybeSingle();
  const tax = row?.tax_summary as TaxDocument | undefined;
  if (!row || !clericalCorrectionAllowed({ status: row.status, hasKey: Boolean(row.r2_object_key), hasTaxLines: Boolean(tax?.lines?.length) })) {
    return { ok: false, invoiceNumber: row?.invoice_number || null, error: "This invoice cannot be corrected." };
  }
  if (row.grand_total_minor !== tax!.grandTotalPaise) {
    return { ok: false, invoiceNumber: row.invoice_number, error: "Stored totals do not match the financial snapshot." };
  }

  const { data: settings } = await db.from("store_invoice_settings").select("*").eq("id", 1).maybeSingle();
  const seller = (row.seller_snapshot || {}) as SellerIdentity & { legal_name?: string; display_name?: string; gstin?: string; state_code?: string; address?: string };
  const display = correctedSellerDisplay(
    {
      legalName: seller.legal_name,
      gstin: seller.gstin,
      stateCode: seller.state_code,
      displayName: seller.display_name,
    },
    settings || {},
  );
  if (!display.ok) return { ok: false, invoiceNumber: row.invoice_number, error: "Seller settings are not the corrected registered address." };

  const logoPng = opts?.logoPng === undefined ? await loadInvoiceLogo(settings?.logo_url || null) : opts.logoPng;
  if (!logoPng) return { ok: false, invoiceNumber: row.invoice_number, error: "Invoice logo could not be loaded." };

  const { data: order } = await db.from("store_orders").select("order_no,placed_at").eq("id", row.order_id).maybeSingle();
  const ship = (row.shipping_snapshot || {}) as { name?: string; line1?: string; line2?: string; city?: string; state?: string; pincode?: string; courier?: string; awb?: string };
  const buyer = (row.buyer_snapshot || {}) as { name?: string };
  const model: InvoicePdfModel = {
    documentType: row.document_type,
    invoiceNumber: row.invoice_number,
    orderNumber: order?.order_no || "",
    issuedAt: `Issued ${new Date(row.issued_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    sellerName: seller.display_name || "NAMAN SHARMA IAS ACADEMY",
    sellerLines: display.lines,
    buyerLines: [buyer.name || "Customer"],
    shipLines: [ship.name, ship.line1, ship.line2, ship.city ? `${ship.city}, ${ship.state} ${ship.pincode}` : "", "India"].filter(Boolean) as string[],
    orderDate: order?.placed_at ? new Date(order.placed_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : null,
    courier: ship.courier || null,
    awb: ship.awb || null,
    paymentReference: row.gateway_reference,
    paidAt: row.paid_at ? new Date(row.paid_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : null,
    tax: tax!,
    words: amountInWords(row.grand_total_minor),
    footer: null,
    attention: null,
    logoPng,
  };

  const previous = await readObjectBytes(row.r2_object_key);
  if (!previous?.length) return { ok: false, invoiceNumber: row.invoice_number, error: "The current PDF could not be archived." };
  const previousSha = createHash("sha256").update(previous).digest("hex");
  const archivedRevision = Number(row.pdf_version) || 1;
  const auditKey = invoiceAuditObjectKey(row.financial_year, row.invoice_number, archivedRevision);
  await putObject(auditKey, previous, "application/pdf");

  let pdf: Buffer;
  try {
    pdf = Buffer.from(await renderInvoicePdf(model));
  } catch {
    return { ok: false, invoiceNumber: row.invoice_number, error: "The corrected PDF could not be rendered." };
  }
  await putObject(row.r2_object_key, pdf, "application/pdf");
  const sha = createHash("sha256").update(pdf).digest("hex");
  const now = new Date().toISOString();
  const original = row.seller_snapshot_original || row.seller_snapshot;
  const nextSeller = {
    ...(row.seller_snapshot || {}),
    address: formatRegisteredAddress({
      floorDisplay: settings?.address_floor_display,
      building: settings?.address_line,
      sector: settings?.address_sector,
      city: settings?.city,
      state: settings?.state,
      pincode: settings?.pincode,
    }).join("\n"),
    floor_display: settings?.address_floor_display || null,
    floor_raw: settings?.address_floor_raw || null,
    sector: settings?.address_sector || null,
    address_line: settings?.address_line || null,
    pincode: settings?.pincode || null,
  };
  const { error } = await db.from("store_invoices").update({
    seller_snapshot: nextSeller,
    seller_snapshot_original: original,
    seller_display_correction: { reason: SELLER_DISPLAY_CORRECTION_REASON, address: display.lines, corrected_at: now },
    pdf_revision_reason: SELLER_DISPLAY_CORRECTION_REASON,
    pdf_regenerated_at: now,
    previous_pdf_sha256: previousSha,
    previous_pdf_object_key: auditKey,
    previous_pdf_size: previous.length,
    previous_pdf_generated_at: row.pdf_generated_at,
    pdf_sha256: sha,
    pdf_size: pdf.length,
    pdf_generated_at: now,
    pdf_version: archivedRevision + 1,
    updated_at: now,
  }).eq("id", row.id).eq("invoice_number", row.invoice_number);
  if (error) {
    await putObject(row.r2_object_key, previous, "application/pdf");
    return { ok: false, invoiceNumber: row.invoice_number, error: "The invoice record was not updated." };
  }
  console.info(`[store/invoice] display_corrected number=${row.invoice_number} bytes=${pdf.length}`);
  return { ok: true, invoiceNumber: row.invoice_number, previousSha, sha };
}
