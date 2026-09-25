import { createHash } from "node:crypto";
import { storeDb } from "../db";
import { putObject, signGetUrl } from "@/lib/r2";
import { financialYearLabel, formatInvoiceNumber, invoiceObjectKey } from "./number";
import { amountInWords, chooseDocumentType, computeTaxDocument, stateCodeFromName, type TaxLineInput } from "./tax";
import { renderInvoicePdf, type InvoicePdfModel } from "./pdf";

export interface InvoicePublic {
  invoice_number: string | null;
  document_type: string | null;
  status: "NOT_REQUIRED" | "PENDING" | "GENERATING" | "READY" | "FAILED";
  issued_at: string | null;
  grand_total_label: string | null;
  attention: string | null;
}

/** Issue one invoice for a captured order. Repeat calls keep the same number. */
export async function ensureStoreInvoice(orderId: string, opts?: { namespace?: "production" | "test" }): Promise<{ ok: boolean; status: string; invoiceNumber: string | null }> {
  const db = storeDb();
  if (!db) return { ok: false, status: "FAILED", invoiceNumber: null };
  const { data: existing } = await db.from("store_invoices").select("id,invoice_number,status,r2_object_key").eq("order_id", orderId).maybeSingle();
  if (existing?.status === "READY" && existing.r2_object_key) {
    return { ok: true, status: "READY", invoiceNumber: existing.invoice_number };
  }
  if (existing && existing.status !== "FAILED" && existing.status !== "PENDING") {
    return { ok: true, status: existing.status, invoiceNumber: existing.invoice_number };
  }

  const { data: order } = await db
    .from("store_orders")
    .select("id,order_no,status,total_paise,subtotal_paise,discount_paise,shipping_paise,paid_at,customer_name,phone,shipping_address_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || !order.paid_at) return { ok: false, status: "NOT_REQUIRED", invoiceNumber: null };

  const { data: payment } = await db
    .from("store_order_payments")
    .select("status,reference_no,gateway_ref,captured_at,amount_paise")
    .eq("order_id", orderId)
    .eq("status", "CAPTURED")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!payment) return { ok: false, status: "NOT_REQUIRED", invoiceNumber: null };
  if (Number(payment.amount_paise) !== Number(order.total_paise)) {
    return { ok: false, status: "FAILED", invoiceNumber: existing?.invoice_number || null };
  }

  const { data: settings } = await db.from("store_invoice_settings").select("*").eq("id", 1).maybeSingle();
  const { data: items } = await db
    .from("store_order_items")
    .select("name_snapshot,sku_snapshot,qty,line_total_paise,line_discount_paise,tax_treatment_snapshot,tax_rate_bps_snapshot,hsn_snapshot")
    .eq("order_id", orderId);
  const { data: address } = order.shipping_address_id
    ? await db.from("store_addresses").select("name,line1,line2,city,state,pincode,phone").eq("id", order.shipping_address_id).maybeSingle()
    : { data: null };

  const lines: TaxLineInput[] = (items || []).map((item) => ({
    name: item.name_snapshot,
    sku: item.sku_snapshot,
    hsn: item.hsn_snapshot,
    qty: item.qty,
    lineTotalPaise: item.line_total_paise,
    discountPaise: item.line_discount_paise || 0,
    taxTreatment: item.tax_treatment_snapshot || "exempt",
    taxRateBps: item.tax_rate_bps_snapshot || 0,
  }));
  const inclusive = (settings?.price_tax_mode || "inclusive") !== "exclusive";
  const placeCode = stateCodeFromName(address?.state);
  const tax = computeTaxDocument({
    lines,
    shippingPaise: order.shipping_paise || 0,
    pricesIncludeTax: inclusive,
    supplierStateCode: settings?.state_code || null,
    placeOfSupplyCode: placeCode,
    chargedTotalPaise: order.total_paise,
  });
  const chosen = chooseDocumentType({
    gstin: settings?.gstin || null,
    anyTaxable: tax.anyTaxable,
    requested: settings?.document_mode,
  });
  const namespace = opts?.namespace || "production";
  const fy = financialYearLabel(new Date(order.paid_at));
  let invoiceNumber = existing?.invoice_number || null;
  let sequence = 0;
  if (!existing) {
    const { data: seq, error } = await db.rpc("next_store_invoice_seq", {
      p_namespace: namespace,
      p_fy: fy,
    });
    if (error || !seq) {
      console.info(`[store/invoice] sequence_failed order=${order.order_no}`);
      return { ok: false, status: "FAILED", invoiceNumber: null };
    }
    sequence = Number(seq);
    const prefix = namespace === "test" ? "TEST" : settings?.invoice_prefix || "NIA";
    invoiceNumber = formatInvoiceNumber(prefix, fy, sequence);
    const { error: insertError } = await db.from("store_invoices").insert({
      order_id: orderId,
      invoice_number: invoiceNumber,
      financial_year: fy,
      sequence_number: sequence,
      namespace,
      document_type: chosen.type,
      status: "PENDING",
      attention: chosen.attention,
      seller_snapshot: {
        display_name: settings?.display_name || "Naman IAS Academy",
        legal_name: settings?.legal_name || null,
        address: [settings?.address_line, settings?.city, settings?.state, settings?.pincode].filter(Boolean).join(", ") || null,
        gstin: settings?.gstin || null,
        pan: settings?.pan || null,
      },
      buyer_snapshot: { name: order.customer_name, phone_present: Boolean(order.phone) },
      shipping_snapshot: address
        ? { line1: address.line1, line2: address.line2, city: address.city, state: address.state, pincode: address.pincode }
        : {},
      line_items_snapshot: tax.lines,
      tax_summary: tax,
      subtotal_minor: tax.subtotalPaise,
      discount_minor: tax.discountPaise,
      shipping_minor: tax.shippingPaise,
      taxable_minor: tax.taxablePaise,
      cgst_minor: tax.cgstPaise,
      sgst_minor: tax.sgstPaise,
      igst_minor: tax.igstPaise,
      rounding_minor: tax.roundingPaise,
      grand_total_minor: tax.grandTotalPaise,
      place_of_supply_state: address?.state || null,
      place_of_supply_state_code: placeCode,
      payment_gateway: "icici_eazypay",
      gateway_transaction_id: payment.gateway_ref,
      gateway_reference: payment.reference_no,
      paid_at: payment.captured_at || order.paid_at,
    });
    if (insertError) {
      const { data: raced } = await db.from("store_invoices").select("invoice_number,status").eq("order_id", orderId).maybeSingle();
      return { ok: Boolean(raced), status: raced?.status || "FAILED", invoiceNumber: raced?.invoice_number || null };
    }
    console.info(`[store/invoice] allocated order=${order.order_no} number=${invoiceNumber}`);
  }

  const model: InvoicePdfModel = {
    documentType: chosen.type,
    invoiceNumber: invoiceNumber || "",
    orderNumber: order.order_no,
    issuedAt: new Date(order.paid_at).toLocaleDateString("en-IN"),
    sellerName: settings?.legal_name || settings?.display_name || "Naman IAS Academy",
    sellerLines: [settings?.address_line, [settings?.city, settings?.state, settings?.pincode].filter(Boolean).join(", "), settings?.gstin ? `GSTIN ${settings.gstin}` : ""].filter(Boolean) as string[],
    buyerLines: [order.customer_name || "Customer"].filter(Boolean),
    shipLines: address ? [address.line1, address.line2, `${address.city}, ${address.state} ${address.pincode}`].filter(Boolean) as string[] : ["Address on order"],
    paymentReference: payment.reference_no,
    paidAt: payment.captured_at ? new Date(payment.captured_at).toLocaleString("en-IN") : null,
    tax,
    words: amountInWords(tax.grandTotalPaise),
    footer: settings?.legal_footer || null,
    attention: chosen.attention,
  };

  try {
    await db.from("store_invoices").update({ status: "GENERATING", updated_at: new Date().toISOString() }).eq("order_id", orderId);
    const pdf = Buffer.from(await renderInvoicePdf(model));
    const key = invoiceObjectKey(fy, invoiceNumber || order.order_no);
    await putObject(key, pdf, "application/pdf");
    const sha = createHash("sha256").update(pdf).digest("hex");
    await db.from("store_invoices").update({
      status: "READY",
      r2_object_key: key,
      pdf_sha256: sha,
      pdf_size: pdf.length,
      pdf_generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("order_id", orderId);
    console.info(`[store/invoice] ready order=${order.order_no} bytes=${pdf.length}`);
    return { ok: true, status: "READY", invoiceNumber };
  } catch (error) {
    await db.from("store_invoices").update({
      status: "FAILED",
      attention: error instanceof Error ? error.message.slice(0, 160) : "PDF was not stored.",
      updated_at: new Date().toISOString(),
    }).eq("order_id", orderId);
    console.info(`[store/invoice] failed order=${order.order_no}`);
    return { ok: false, status: "FAILED", invoiceNumber };
  }
}

export async function invoiceDownloadUrl(orderId: string): Promise<{ url: string; invoiceNumber: string } | null> {
  const db = storeDb();
  if (!db) return null;
  const { data } = await db.from("store_invoices").select("invoice_number,status,r2_object_key").eq("order_id", orderId).maybeSingle();
  if (!data || data.status !== "READY" || !data.r2_object_key) return null;
  const url = await signGetUrl(data.r2_object_key, 600);
  return { url, invoiceNumber: data.invoice_number };
}
