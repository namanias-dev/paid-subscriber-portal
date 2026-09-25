import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { DocumentType } from "./tax";
import type { TaxDocument } from "./tax";

export interface InvoicePdfModel {
  documentType: DocumentType;
  invoiceNumber: string;
  orderNumber: string;
  issuedAt: string;
  sellerName: string;
  sellerLines: string[];
  buyerLines: string[];
  shipLines: string[];
  paymentReference: string | null;
  paidAt: string | null;
  tax: TaxDocument;
  words: string;
  footer: string | null;
  attention: string | null;
}

function money(paise: number): string {
  return `Rs ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A4 invoice. react-pdf does not load on this Node runtime, so the bytes come from pdf-lib. */
export async function renderInvoicePdf(model: InvoicePdfModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(model.invoiceNumber);
  doc.setAuthor(model.sellerName);
  doc.setSubject(model.orderNumber);
  doc.setCreationDate(new Date());
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.04, 0.12, 0.23);
  const muted = rgb(0.36, 0.4, 0.46);
  let y = 800;
  page.drawText(model.sellerName, { x: 40, y, size: 16, font: bold, color: navy });
  page.drawRectangle({ x: 40, y: y - 8, width: 48, height: 2, color: rgb(0.69, 0.54, 0.25) });
  page.drawText(model.documentType.replaceAll("_", " "), { x: 380, y, size: 11, font: bold, color: navy });
  y -= 28;
  for (const line of model.sellerLines) {
    page.drawText(line, { x: 40, y, size: 9, font, color: muted });
    y -= 12;
  }
  let right = 786;
  for (const line of [`PAID`, `Invoice ${model.invoiceNumber}`, `Order ${model.orderNumber}`, model.issuedAt]) {
    page.drawText(line, { x: 380, y: right, size: 9, font, color: muted });
    right -= 12;
  }
  y = Math.min(y, right) - 16;
  page.drawText("BILL TO", { x: 40, y, size: 8, font: bold, color: rgb(0.54, 0.45, 0.25) });
  page.drawText("SHIP TO", { x: 320, y, size: 8, font: bold, color: rgb(0.54, 0.45, 0.25) });
  y -= 14;
  const max = Math.max(model.buyerLines.length, model.shipLines.length);
  for (let i = 0; i < max; i += 1) {
    if (model.buyerLines[i]) page.drawText(model.buyerLines[i], { x: 40, y, size: 9, font, color: navy });
    if (model.shipLines[i]) page.drawText(model.shipLines[i], { x: 320, y, size: 9, font, color: navy });
    y -= 12;
  }
  y -= 8;
  page.drawText(`ICICI Eazypay${model.paymentReference ? ` · ${model.paymentReference}` : ""}`, { x: 40, y, size: 9, font, color: navy });
  y -= 22;
  page.drawText("Description", { x: 40, y, size: 8, font: bold, color: navy });
  page.drawText("HSN", { x: 250, y, size: 8, font: bold, color: navy });
  page.drawText("Qty", { x: 310, y, size: 8, font: bold, color: navy });
  page.drawText("Taxable", { x: 350, y, size: 8, font: bold, color: navy });
  page.drawText("Total", { x: 500, y, size: 8, font: bold, color: navy });
  y -= 8;
  page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.5, color: rgb(0.9, 0.88, 0.84) });
  for (const line of model.tax.lines) {
    y -= 16;
    page.drawText(line.name.slice(0, 42), { x: 40, y, size: 9, font, color: navy });
    page.drawText(line.hsn || "—", { x: 250, y, size: 9, font, color: navy });
    page.drawText(String(line.qty), { x: 310, y, size: 9, font, color: navy });
    page.drawText(money(line.taxablePaise), { x: 350, y, size: 9, font, color: navy });
    page.drawText(money(line.totalPaise), { x: 470, y, size: 9, font, color: navy });
  }
  y -= 28;
  const rows: Array<[string, number]> = [
    ["Taxable value", model.tax.taxablePaise],
    ["CGST", model.tax.cgstPaise],
    ["SGST", model.tax.sgstPaise],
    ["IGST", model.tax.igstPaise],
    ["Shipping", model.tax.shippingPaise],
  ];
  for (const [label, amount] of rows) {
    if (!amount) continue;
    page.drawText(label, { x: 360, y, size: 9, font, color: navy });
    page.drawText(money(amount), { x: 470, y, size: 9, font, color: navy });
    y -= 14;
  }
  page.drawText(`Grand total ${money(model.tax.grandTotalPaise)}`, { x: 360, y, size: 11, font: bold, color: navy });
  y -= 16;
  page.drawText(model.words, { x: 40, y, size: 8, font, color: muted });
  if (model.attention) {
    y -= 16;
    page.drawText(model.attention.slice(0, 110), { x: 40, y, size: 8, font, color: muted });
  }
  page.drawText(model.footer || "This document records the payment captured for this Notes order.", {
    x: 40,
    y: 36,
    size: 8,
    font,
    color: muted,
  });
  return doc.save();
}
