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
  orderDate?: string | null;
  courier?: string | null;
  awb?: string | null;
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

const MAX_LOGO_H = 36;
const MAX_LOGO_W = 210;

/** Contain the mark inside the header box. Never crop, stretch, or grow the page for source pixels. */
export function invoiceLogoDrawSize(pixelWidth: number, pixelHeight: number): { width: number; height: number } {
  if (pixelWidth <= 0 || pixelHeight <= 0) return { width: 0, height: 0 };
  const fit = Math.min(MAX_LOGO_H / pixelHeight, MAX_LOGO_W / pixelWidth);
  return { width: pixelWidth * fit, height: pixelHeight * fit };
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

  if (logo) {
    const { width: drawW, height: drawH } = invoiceLogoDrawSize(logo.width, logo.height);
    page.drawImage(logo, { x: M, y: y - drawH, width: drawW, height: drawH });
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
    "Computer Generated Invoice / Sales Document",
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
    page.drawText("HSN", { x: 200, y, size: 8, font, color: NAVY });
    page.drawText("Qty", { x: 268, y, size: 8, font, color: NAVY });
    page.drawText("Unit", { x: 292, y, size: 8, font, color: NAVY });
    page.drawText("Rate", { x: 340, y, size: 8, font, color: NAVY });
    page.drawText("GST", { x: 410, y, size: 8, font, color: NAVY });
    const totalLabel = "Total";
    page.drawText(totalLabel, { x: RIGHT - font.widthOfTextAtSize(totalLabel, 8), y, size: 8, font, color: NAVY });
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: RIGHT, y }, thickness: 0.4, color: LINE });
    y -= 14;
  };
  columns();

  for (const line of model.tax.lines) {
    const nameLines = wrap(line.name, font, 9, 155);
    const block = Math.max(1, nameLines.length) * 12 + 4;
    if (y - block < 56) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - M;
      columns();
    }
    nameLines.forEach((part, index) => {
      text(part, M, 9);
      if (index === 0) {
        page.drawText(line.hsn || "—", { x: 200, y, size: 8, font, color: NAVY });
        page.drawText(String(line.qty), { x: 268, y, size: 8, font, color: NAVY });
        page.drawText(line.unit || "NOS", { x: 292, y, size: 8, font, color: NAVY });
        page.drawText(money(line.unitPaise), { x: 340, y, size: 8, font, color: NAVY });
        page.drawText(line.rateBps > 0 ? money(line.taxPaise) : "NIL", { x: 410, y, size: 8, font, color: NAVY });
        const total = money(line.totalPaise);
        page.drawText(total, { x: RIGHT - font.widthOfTextAtSize(total, 9), y, size: 9, font, color: NAVY });
      }
      y -= 12;
    });
    y -= 4;
  }

  const gross = model.tax.lines.reduce((n, line) => n + line.totalPaise + line.discountPaise, 0);
  const net = model.tax.lines.reduce((n, line) => n + line.totalPaise, 0);
  const summary: Array<[string, string]> = [
    ["Subtotal", money(gross)],
    ["Discount", model.tax.discountPaise > 0 ? `−${money(model.tax.discountPaise)}` : money(0)],
    ["Net goods", money(net)],
    ["Shipping", money(model.tax.shippingPaise)],
    ["GST", money(model.tax.taxPaise)],
  ];
  if (model.tax.roundingPaise) summary.push(["Rounding", money(model.tax.roundingPaise)]);
  need(summary.length * 14 + 120);
  for (const [label, value] of summary) {
    page.drawText(label, { x: 360, y, size: 9, font, color: NAVY });
    page.drawText(value, { x: RIGHT - font.widthOfTextAtSize(value, 9), y, size: 9, font, color: NAVY });
    y -= 14;
  }
  page.drawLine({ start: { x: 360, y: y + 8 }, end: { x: RIGHT, y: y + 8 }, thickness: 0.4, color: LINE });
  const grand = `GRAND TOTAL  ${money(model.tax.grandTotalPaise)}`;
  page.drawText(grand, { x: RIGHT - font.widthOfTextAtSize(grand, 11), y, size: 11, font, color: NAVY });
  y -= 16;
  const nil = model.tax.lines.find((line) => line.rateBps === 0 && line.hsn);
  if (nil) {
    for (const line of wrap(`GST treatment: Nil rated · HSN ${nil.hsn} · Rate NIL · Tax ${money(0)}`, font, 8, RIGHT - M)) {
      text(line, M, 8, MUTED);
      y -= 11;
    }
  }
  for (const line of wrap(`Amount chargeable (in words): ${model.words}`, font, 8, RIGHT - M)) {
    text(line, M, 8, NAVY);
    y -= 11;
  }
  if (model.orderDate) {
    text(`Order date: ${model.orderDate}`, M, 8, MUTED);
    y -= 11;
  }
  const dispatch = model.courier ? `Dispatched through: ${model.courier}${model.awb ? ` · AWB ${model.awb}` : ""}` : "Dispatched through: Pending fulfillment";
  for (const line of wrap(dispatch, font, 8, RIGHT - M)) {
    text(line, M, 8, MUTED);
    y -= 11;
  }
  y -= 8;
  for (const line of wrap("We declare that this document shows the actual value of the goods described and that the particulars stated above are true and correct.", font, 8, 320)) {
    text(line, M, 8, MUTED);
    y -= 11;
  }
  y -= 10;
  text("For NAMAN SHARMA", 360, 9, NAVY);
  y -= 12;
  page.drawText("NAMAN SHARMA IAS ACADEMY", { x: 360, y, size: 8, font, color: MUTED });
  y -= 16;
  page.drawText("Authorised Signatory", { x: 360, y, size: 8, font, color: NAVY });
  page.drawText("This is a computer-generated document.", { x: M, y: 28, size: 8, font, color: MUTED });
  return doc.save();
}
