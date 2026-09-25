import { readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFImage } from "pdf-lib";
import type { DocumentType, TaxDocument } from "./tax";

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
  logoPng?: Uint8Array | null;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 40;
const RIGHT = PAGE_W - M;
const NAVY = rgb(0.04, 0.12, 0.23);
const MUTED = rgb(0.36, 0.4, 0.46);
const GOLD = rgb(0.69, 0.54, 0.25);
const LINE = rgb(0.9, 0.88, 0.84);

function money(paise: number): string {
  const rupees = (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `₹${rupees}`;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

function fontFile(): Uint8Array {
  return new Uint8Array(readFileSync(join(process.cwd(), "lib/store/invoice/NotoSans-Regular.ttf")));
}

/** A4 invoice. Logo is optional; a missing image keeps the supplier name. */
export async function renderInvoicePdf(model: InvoicePdfModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(model.invoiceNumber);
  doc.setAuthor(model.sellerName);
  doc.setSubject(model.orderNumber);
  doc.setCreationDate(new Date());
  const font = await doc.embedFont(fontFile(), { subset: true });
  const bold = font;
  let logo: PDFImage | null = null;
  if (model.logoPng && model.logoPng.length > 32) {
    try {
      logo = await doc.embedPng(model.logoPng);
    } catch {
      logo = null;
    }
  }
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;

  const need = (height: number) => {
    if (y - height >= 56) return;
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - M;
  };
  const text = (value: string, x: number, size: number, color = NAVY, face: PDFFont = font) => {
    page.drawText(value, { x, y, size, font: face, color });
  };

  const logoH = 36;
  if (logo) {
    const scale = logoH / logo.height;
    const logoW = Math.min(120, logo.width * scale);
    const drawH = logoW / (logo.width / logo.height);
    page.drawImage(logo, { x: M, y: y - drawH, width: logoW, height: drawH });
    y -= drawH + 8;
  }
  text(model.sellerName, M, 13, NAVY, bold);
  y -= 16;
  page.drawRectangle({ x: M, y: y + 4, width: 42, height: 2, color: GOLD });
  for (const line of model.sellerLines.flatMap((line) => wrap(line, font, 9, 250))) {
    y -= 12;
    text(line, M, 9, MUTED);
  }

  let metaY = PAGE_H - M - 4;
  const meta = [
    model.documentType.replaceAll("_", " "),
    "PAID",
    `Invoice ${model.invoiceNumber}`,
    `Order ${model.orderNumber}`,
    model.issuedAt,
  ];
  for (const line of meta) {
    const size = line === meta[0] ? 11 : 9;
    const width = font.widthOfTextAtSize(line, size);
    page.drawText(line, { x: RIGHT - width, y: metaY, size, font, color: line === "PAID" ? GOLD : NAVY });
    metaY -= 14;
  }
  y = Math.min(y, metaY) - 10;

  need(80);
  text("BILL TO", M, 8, GOLD, bold);
  page.drawText("SHIP TO", { x: 320, y, size: 8, font: bold, color: GOLD });
  y -= 14;
  const buyer = model.buyerLines.flatMap((line) => wrap(line, font, 9, 250));
  const ship = model.shipLines.flatMap((line) => wrap(line, font, 9, 220));
  const rows = Math.max(buyer.length, ship.length, 1);
  for (let i = 0; i < rows; i += 1) {
    need(14);
    if (buyer[i]) text(buyer[i], M, 9);
    if (ship[i]) page.drawText(ship[i], { x: 320, y, size: 9, font, color: NAVY });
    y -= 12;
  }
  y -= 8;
  need(20);
  const pay = `ICICI Eazypay${model.paymentReference ? ` · ${model.paymentReference}` : ""}${model.paidAt ? ` · ${model.paidAt}` : ""}`;
  for (const line of wrap(pay, font, 9, RIGHT - M)) {
    text(line, M, 9);
    y -= 12;
  }
  y -= 8;

  const columns = () => {
    need(22);
    page.drawText("Description", { x: M, y, size: 8, font, color: NAVY });
    page.drawText("HSN", { x: 250, y, size: 8, font, color: NAVY });
    page.drawText("Qty", { x: 300, y, size: 8, font, color: NAVY });
    page.drawText("Taxable", { x: 340, y, size: 8, font, color: NAVY });
    page.drawText("GST", { x: 430, y, size: 8, font, color: NAVY });
    const totalLabel = "Total";
    page.drawText(totalLabel, { x: RIGHT - font.widthOfTextAtSize(totalLabel, 8), y, size: 8, font, color: NAVY });
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.4, color: LINE });
    y -= 14;
  };
  columns();

  for (const line of model.tax.lines) {
    const nameLines = wrap(line.name, font, 9, 200);
    const block = Math.max(1, nameLines.length) * 12 + 4;
    if (y - block < 56) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - M;
      columns();
    }
    nameLines.forEach((part, index) => {
      text(part, M, 9);
      if (index === 0) {
        page.drawText(line.hsn || "—", { x: 250, y, size: 9, font, color: NAVY });
        page.drawText(String(line.qty), { x: 300, y, size: 9, font, color: NAVY });
        page.drawText(money(line.taxablePaise), { x: 340, y, size: 9, font, color: NAVY });
        page.drawText(money(line.taxPaise), { x: 420, y, size: 9, font, color: NAVY });
        const total = money(line.totalPaise);
        page.drawText(total, { x: RIGHT - font.widthOfTextAtSize(total, 9), y, size: 9, font, color: NAVY });
      }
      y -= 12;
    });
    y -= 4;
  }

  const summary: Array<[string, number, boolean]> = [
    ["Subtotal", model.tax.subtotalPaise, true],
    ["Discount", model.tax.discountPaise, model.tax.discountPaise > 0],
    ["Taxable value", model.tax.taxablePaise, true],
    ["CGST", model.tax.cgstPaise, model.tax.cgstPaise > 0],
    ["SGST", model.tax.sgstPaise, model.tax.sgstPaise > 0],
    ["IGST", model.tax.igstPaise, model.tax.igstPaise > 0],
    ["Shipping", model.tax.shippingPaise, model.tax.shippingPaise > 0],
    ["Rounding", model.tax.roundingPaise, model.tax.roundingPaise !== 0],
  ];
  need(summary.filter((row) => row[2]).length * 14 + 48);
  for (const [label, amount, show] of summary) {
    if (!show) continue;
    page.drawText(label, { x: 360, y, size: 9, font, color: NAVY });
    const value = money(amount);
    page.drawText(value, { x: RIGHT - font.widthOfTextAtSize(value, 9), y, size: 9, font, color: NAVY });
    y -= 14;
  }
  const grand = `Grand total ${money(model.tax.grandTotalPaise)}`;
  page.drawText(grand, { x: RIGHT - font.widthOfTextAtSize(grand, 11), y, size: 11, font, color: NAVY });
  y -= 18;
  for (const line of wrap(model.words, font, 8, RIGHT - M)) {
    text(line, M, 8, MUTED);
    y -= 11;
  }
  if (model.attention) {
    for (const line of wrap(model.attention, font, 8, RIGHT - M)) {
      text(line, M, 8, MUTED);
      y -= 11;
    }
  }
  const footer = model.footer || "This document records the payment captured for this Notes order.";
  const footerLines = wrap(footer, font, 8, RIGHT - M);
  page.drawText(footerLines[0] || footer, { x: M, y: 36, size: 8, font, color: MUTED });
  if (footerLines[1]) page.drawText(footerLines[1], { x: M, y: 24, size: 8, font, color: MUTED });
  return doc.save();
}
