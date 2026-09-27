import { createHash } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { storeDb } from "../db";
import { putObject, signGetUrl } from "@/lib/r2";
import { financialYearLabel, formatInvoiceNumber, invoiceObjectKey } from "./number";
import { PRINTED_NOTES_TAX_PROFILE } from "./profile";
import { amountInWords, chooseDocumentType, computeTaxDocument, stateCodeFromName, taxClassificationConfirmed, type TaxDocument, type TaxLineInput } from "./tax";
import { renderInvoicePdf, type InvoicePdfModel } from "./pdf";
import { formatRegisteredAddress } from "./address";
import { loadInvoiceLogo } from "./logo";

export interface InvoicePublic {
  invoice_number: string | null;
  document_type: string | null;
  status: "NOT_REQUIRED" | "PENDING" | "GENERATING" | "READY" | "FAILED";
  issued_at: string | null;
  grand_total_label: string | null;
  attention: string | null;
}

export const INVOICE_URL_TTL_SECONDS = 600;
const GENERATING_LEASE_MS = 120_000;

export type InvoiceWork = "return" | "wait" | "allocate" | "render";

/** Same number and snapshot are kept. A fresh PDF is rendered only for an unfinished row. */
export function invoiceWorkPlan(
  existing: { status: string; updatedAt: string | null; hasKey: boolean } | null,
  now = Date.now(),
): InvoiceWork {
  if (!existing) return "allocate";
  if (existing.status === "READY" && existing.hasKey) return "return";
  if (existing.status === "READY") return "render";
  if (existing.status === "GENERATING") {
    const updated = existing.updatedAt ? Date.parse(existing.updatedAt) : 0;
    if (Number.isFinite(updated) && now - updated < GENERATING_LEASE_MS) return "wait";
    return "render";
  }
  if (existing.status === "PENDING" || existing.status === "FAILED") return "render";
  return "return";
}

export function paymentAllowsInvoice(input: {
  paid: boolean;
  paymentStatus: string | null;
  paymentAmountPaise: number;
  orderTotalPaise: number;
}): "ok" | "unpaid" | "mismatch" {
  if (!input.paid || input.paymentStatus !== "CAPTURED") return "unpaid";
  if (Number(input.paymentAmountPaise) !== Number(input.orderTotalPaise)) return "mismatch";
  return "ok";
}

/** Continue PDF work after the payment response has already been sent. */
export function scheduleStoreInvoice(orderId: string): void {
  const work = ensureStoreInvoice(orderId).catch(() => {
    console.info("[store/invoice] schedule_failed");
  });
  try {
    waitUntil(work);
  } catch {
    void work;
  }
}

/** Finish invoices that already exist. Does not create a row for an older paid order. */
export async function resumeIncompleteInvoices(limit = 8): Promise<number> {
  const db = storeDb();
  if (!db) return 0;
  const stale = new Date(Date.now() - GENERATING_LEASE_MS).toISOString();
  const { data } = await db
    .from("store_invoices")
    .select("order_id,status,updated_at")
    .in("status", ["PENDING", "FAILED", "GENERATING"])
    .order("updated_at", { ascending: true })
    .limit(limit);
  let resumed = 0;
  for (const row of data || []) {
    if (row.status === "GENERATING" && row.updated_at && row.updated_at > stale) continue;
    resumed += 1;
    await ensureStoreInvoice(row.order_id).catch(() => {});
  }
  return resumed;
}

/** Issue one invoice for a captured order. Repeat calls keep the same number. */
export async function ensureStoreInvoice(orderId: string, opts?: { namespace?: "production" | "test" }): Promise<{ ok: boolean; status: string; invoiceNumber: string | null }> {
  const db = storeDb();
  if (!db) return { ok: false, status: "FAILED", invoiceNumber: null };
  const { data: existing } = await db.from("store_invoices").select("id,invoice_number,status,r2_object_key,updated_at").eq("order_id", orderId).maybeSingle();
  const plan = invoiceWorkPlan(
    existing
      ? { status: existing.status, updatedAt: existing.updated_at, hasKey: Boolean(existing.r2_object_key) }
      : null,
  );
  if (plan === "return" || plan === "wait") {
    return { ok: plan !== "wait" || existing?.status === "READY", status: existing?.status || "PENDING", invoiceNumber: existing?.invoice_number || null };
  }

  const { data: order } = await db
    .from("store_orders")
    .select("id,order_no,status,total_paise,subtotal_paise,discount_paise,shipping_paise,paid_at,placed_at,customer_name,phone,shipping_address_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order?.paid_at) return { ok: false, status: "NOT_REQUIRED", invoiceNumber: null };

  const { data: payment } = await db
    .from("store_order_payments")
    .select("status,reference_no,gateway_ref,captured_at,amount_paise")
    .eq("order_id", orderId)
    .eq("status", "CAPTURED")
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const allowed = paymentAllowsInvoice({
    paid: true,
    paymentStatus: payment?.status || null,
    paymentAmountPaise: payment?.amount_paise || 0,
    orderTotalPaise: order.total_paise,
  });
  if (!payment || allowed === "unpaid") return { ok: false, status: "NOT_REQUIRED", invoiceNumber: null };
  if (allowed === "mismatch") {
    console.info(`[store/invoice] amount_mismatch order=${order.order_no}`);
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
    unit: null,
    taxConfigurationStatus: null,
    qty: item.qty,
    lineTotalPaise: item.line_total_paise,
    discountPaise: item.line_discount_paise || 0,
    taxTreatment: item.tax_treatment_snapshot || "exempt",
    taxRateBps: item.tax_rate_bps_snapshot || 0,
  }));
  const skus = lines.map((line) => line.sku).filter((sku): sku is string => Boolean(sku));
  if (skus.length) {
    const { data: products } = await db.from("store_products").select("sku,hsn_code,tax_treatment,tax_rate_bps,tax_configuration_status").in("sku", skus);
    const bySku = new Map((products || []).map((product) => [product.sku, product]));
    for (const line of lines) {
      if (line.hsn && line.taxConfigurationStatus === "CONFIRMED") continue;
      const product = line.sku ? bySku.get(line.sku) : undefined;
      if (!product?.hsn_code || product.tax_configuration_status !== "CONFIRMED") continue;
      line.hsn = product.hsn_code;
      line.taxTreatment = product.tax_treatment || line.taxTreatment;
      line.taxRateBps = product.tax_rate_bps || 0;
      line.taxConfigurationStatus = product.tax_configuration_status;
      line.unit = product.hsn_code === PRINTED_NOTES_TAX_PROFILE.hsn ? PRINTED_NOTES_TAX_PROFILE.unit : "NOS";
    }
  }
  const namespace = opts?.namespace || "production";
  if (namespace !== "test" && !existing && !taxClassificationConfirmed(lines)) {
    console.info(`[store/invoice] classification_unconfirmed order=${order.order_no}`);
    return { ok: false, status: "UNCONFIRMED", invoiceNumber: null };
  }
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
  const { data: shipmentRows } = await db.from("store_shipments").select("awb,courier_name,status,created_at").eq("order_id", orderId);
  const shipment = (shipmentRows || [])
    .filter((row) => row.status !== "cancelled")
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0] || null;
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
        display_name: settings?.trade_name || settings?.display_name || "Naman IAS Academy",
        legal_name: settings?.legal_name || null,
        trade_name: settings?.trade_name || null,
        address_line: settings?.address_line || null,
        floor_display: settings?.address_floor_display || null,
        floor_raw: settings?.address_floor_raw || null,
        sector: settings?.address_sector || null,
        city: settings?.city || null,
        state: settings?.state || null,
        state_code: settings?.state_code || null,
        pincode: settings?.pincode || null,
        address: formatRegisteredAddress({
          floorDisplay: settings?.address_floor_display,
          building: settings?.address_line,
          sector: settings?.address_sector,
          city: settings?.city,
          state: settings?.state,
          pincode: settings?.pincode,
        }).join("\n") || null,
        gstin: settings?.gstin || null,
        pan: settings?.pan || null,
        constitution: settings?.constitution || null,
      },
      buyer_snapshot: { name: order.customer_name, phone_present: Boolean(order.phone), placed_at: order.placed_at },
      shipping_snapshot: address
        ? { line1: address.line1, line2: address.line2, city: address.city, state: address.state, pincode: address.pincode, name: address.name, courier: shipment?.courier_name || null, awb: shipment?.awb || null }
        : { courier: shipment?.courier_name || null, awb: shipment?.awb || null },
      line_items_snapshot: tax.lines,
      tax_summary: tax,
      subtotal_minor: tax.subtotalPaise,
      discount_minor: tax.discountPaise,
      shipping_minor: tax.shippingPaise,
      taxable_minor: tax.taxablePaise,
      cgst_minor: tax.cgstPaise,
      sgst_minor: tax.sgstPaise,
      utgst_minor: tax.utgstPaise,
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

  const issuedLabel = `Issued ${new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}`;
  const orderDate = order.placed_at ? new Date(order.placed_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : null;
  let model: InvoicePdfModel = {
    documentType: chosen.type,
    invoiceNumber: invoiceNumber || "",
    orderNumber: order.order_no,
    issuedAt: issuedLabel,
    sellerName: settings?.trade_name || settings?.display_name || "Naman IAS Academy",
    sellerLines: [
      settings?.legal_name ? `Legal name: ${settings.legal_name}` : "",
      settings?.gstin ? `GSTIN: ${settings.gstin}` : "",
      ...formatRegisteredAddress({
        floorDisplay: settings?.address_floor_display,
        building: settings?.address_line,
        sector: settings?.address_sector,
        city: settings?.city,
        state: settings?.state,
        pincode: settings?.pincode,
      }),
      settings?.state_code ? `State code: ${settings.state_code}` : "",
    ].filter(Boolean) as string[],
    buyerLines: [order.customer_name || "Customer"].filter(Boolean),
    shipLines: address ? [address.name, address.line1, address.line2, `${address.city}, ${address.state} ${address.pincode}`, "India"].filter(Boolean) as string[] : ["Address on order"],
    orderDate,
    courier: shipment?.courier_name || null,
    awb: shipment?.awb || null,
    paymentReference: payment.reference_no,
    paidAt: payment.captured_at ? new Date(payment.captured_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : null,
    tax,
    words: amountInWords(tax.grandTotalPaise),
    footer: settings?.legal_footer || null,
    attention: chosen.attention,
    logoPng: await loadInvoiceLogo(settings?.logo_url || null),
  };
  if (existing) {
    const { data: stored } = await db
      .from("store_invoices")
      .select("seller_snapshot,shipping_snapshot,line_items_snapshot,tax_summary,document_type,invoice_number,issued_at,gateway_reference,paid_at,grand_total_minor")
      .eq("order_id", orderId)
      .maybeSingle();
    const seller = (stored?.seller_snapshot || {}) as { display_name?: string; legal_name?: string; address?: string; gstin?: string; state_code?: string };
    const ship = (stored?.shipping_snapshot || {}) as { line1?: string; line2?: string; city?: string; state?: string; pincode?: string };
    const storedTax = stored?.tax_summary as TaxDocument | undefined;
    if (stored && storedTax?.lines) {
      model = {
        ...model,
        documentType: stored.document_type,
        invoiceNumber: stored.invoice_number,
        issuedAt: `Issued ${new Date(stored.issued_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}`,
        sellerName: seller.display_name || model.sellerName,
        sellerLines: [
          seller.legal_name ? `Legal name: ${seller.legal_name}` : "",
          seller.gstin ? `GSTIN: ${seller.gstin}` : "",
          ...(seller.address || "").split("\n").map((line) => line.trim()).filter(Boolean),
          seller.state_code ? `State code: ${seller.state_code}` : "",
        ].filter(Boolean),
        shipLines: [ship.line1, ship.line2, [ship.city, ship.state, ship.pincode].filter(Boolean).join(" ")].filter(Boolean) as string[],
        paymentReference: stored.gateway_reference,
        paidAt: stored.paid_at ? `Paid ${new Date(stored.paid_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}` : model.paidAt,
        tax: storedTax,
        words: amountInWords(stored.grand_total_minor || storedTax.grandTotalPaise),
      };
    }
  }

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

/** One historical order. Refuses every other order number. Does not allocate when classification is unconfirmed. */
export const HISTORICAL_INVOICE_ORDER = "NIAS-N-2026-001001";

export async function issueHistoricalStoreInvoice(orderNo: string): Promise<{ ok: boolean; status: string; invoiceNumber: string | null; error?: string }> {
  if (orderNo !== HISTORICAL_INVOICE_ORDER) {
    return { ok: false, status: "REFUSED", invoiceNumber: null, error: "This issuer only accepts NIAS-N-2026-001001." };
  }
  const db = storeDb();
  if (!db) return { ok: false, status: "FAILED", invoiceNumber: null, error: "unavailable" };
  const { data: order } = await db.from("store_orders").select("id,paid_at,total_paise").eq("order_no", orderNo).maybeSingle();
  if (!order?.id || !order.paid_at) return { ok: false, status: "NOT_REQUIRED", invoiceNumber: null, error: "Order is not paid." };
  const { data: payment } = await db.from("store_order_payments").select("status,amount_paise").eq("order_id", order.id).eq("status", "CAPTURED").limit(1).maybeSingle();
  const allowed = paymentAllowsInvoice({
    paid: true,
    paymentStatus: payment?.status || null,
    paymentAmountPaise: payment?.amount_paise || 0,
    orderTotalPaise: order.total_paise,
  });
  if (allowed !== "ok") return { ok: false, status: allowed === "mismatch" ? "FAILED" : "NOT_REQUIRED", invoiceNumber: null, error: allowed };
  return ensureStoreInvoice(order.id);
}

export async function invoiceDownloadUrl(orderId: string, opts?: { attachment?: boolean }): Promise<{ url: string; invoiceNumber: string } | null> {
  const db = storeDb();
  if (!db) return null;
  const { data } = await db.from("store_invoices").select("invoice_number,status,r2_object_key").eq("order_id", orderId).maybeSingle();
  if (!data || data.status !== "READY" || !data.r2_object_key) return null;
  const filename = `${String(data.invoice_number).replace(/[^\w.-]+/g, "-")}.pdf`;
  const disposition = opts?.attachment ? `attachment; filename="${filename}"` : undefined;
  const url = await signGetUrl(data.r2_object_key, INVOICE_URL_TTL_SECONDS, disposition);
  return { url, invoiceNumber: data.invoice_number };
}
