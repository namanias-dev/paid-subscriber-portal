import type { PaymentReceipt } from "./types";

export interface ReceiptContact {
  name: string;
  address: string;
  phone: string;
  email: string;
  whatsapp: string;
  logoUrl: string | null;
  logoAlt: string;
}

const NAVY: [number, number, number] = [10, 26, 63];
const NAVY2: [number, number, number] = [15, 37, 87];
const GOLD: [number, number, number] = [184, 134, 11];
const GREEN: [number, number, number] = [10, 138, 58];
const GREY: [number, number, number] = [85, 85, 85];
const LIGHT: [number, number, number] = [230, 230, 230];

/**
 * Indian-grouped money WITHOUT the ₹ glyph (standard PDF fonts can't render ₹).
 * Mirrors the on-screen amounts as "Rs. 1,23,456".
 */
function inr(n: number): string {
  return `Rs. ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n || 0))}`;
}

/** Load a same-origin/remote image as a data URL for jsPDF.addImage (best-effort). */
async function loadImage(url: string): Promise<{ data: string; w: number; h: number } | null> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const data: string = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
      img.onerror = () => resolve({ w: 1, h: 1 });
      img.src = data;
    });
    return { data, w: dims.w, h: dims.h };
  } catch {
    return null;
  }
}

/**
 * Generate and download a branded, single-page A4 PDF of a payment receipt.
 * Drawn natively with jsPDF (crisp vector text + reliable download on mobile and
 * desktop) — it mirrors the on-screen ReceiptView exactly.
 */
export async function downloadReceiptPdf(receipt: PaymentReceipt, contact: ReceiptContact): Promise<void> {
  const { jsPDF } = await import("jspdf"); // lazy: keep jspdf out of the initial bundle
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const M = 14; // margin
  const contentW = pageW - M * 2;

  // ---- Header band ----
  const headH = 30;
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageW, headH, "F");
  doc.setFillColor(...NAVY2);
  doc.rect(0, 0, pageW * 0.62, headH, "F");

  // Logo or gold monogram
  let logo: { data: string; w: number; h: number } | null = null;
  if (contact.logoUrl) logo = await loadImage(contact.logoUrl);
  if (logo) {
    const h = 16;
    const w = Math.min(40, (logo.w / logo.h) * h);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(M - 1, headH / 2 - h / 2 - 1, w + 2, h + 2, 1.5, 1.5, "F");
    try {
      doc.addImage(logo.data, "PNG", M, headH / 2 - h / 2, w, h, undefined, "FAST");
    } catch {
      /* ignore unsupported format */
    }
  } else {
    doc.setFillColor(...GOLD);
    doc.roundedRect(M, headH / 2 - 7, 14, 14, 2.5, 2.5, "F");
    doc.setTextColor(...NAVY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("N", M + 7, headH / 2 + 1.5, { align: "center", baseline: "middle" });
  }

  const textX = M + 22;
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(contact.name, textX, headH / 2 - 2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(210, 210, 210);
  doc.text("Official Payment Receipt", textX, headH / 2 + 4);

  doc.setTextColor(210, 210, 210);
  doc.setFontSize(8);
  doc.text("RECEIPT NO.", pageW - M, headH / 2 - 2.5, { align: "right" });
  doc.setTextColor(255, 255, 255);
  doc.setFont("courier", "bold");
  doc.setFontSize(11);
  doc.text(receipt.receipt_no, pageW - M, headH / 2 + 3, { align: "right" });

  let y = headH + 10;

  // ---- Status + date ----
  const statusColor: [number, number, number] =
    receipt.status === "Fully Paid" ? GREEN : receipt.status === "Seat Booked" ? GOLD : [180, 83, 9];
  doc.setFillColor(...statusColor);
  const stW = doc.getTextWidth(receipt.status) + 8;
  doc.roundedRect(M, y - 4.5, stW, 6.5, 3.2, 3.2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(receipt.status, M + 4, y, { baseline: "middle" });

  const issued = new Date(receipt.issued_at).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
  doc.setTextColor(...GREY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`${issued} (IST)`, pageW - M, y, { align: "right", baseline: "middle" });

  y += 12;

  // ---- Billed to / Course ----
  const colR = M + contentW / 2 + 4;
  const label = (t: string, x: number, yy: number) => {
    doc.setTextColor(140, 140, 140);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(t.toUpperCase(), x, yy);
  };
  label("Billed to", M, y);
  label("Course", colR, y);
  y += 5;
  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(doc.splitTextToSize(receipt.student_name, contentW / 2 - 6), M, y);
  doc.text(doc.splitTextToSize(receipt.course_title, contentW / 2 - 6), colR, y);
  y += 5;
  doc.setTextColor(...GREY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(receipt.phone, M, y);
  if (receipt.batch_label) doc.text(doc.splitTextToSize(receipt.batch_label, contentW / 2 - 6), colR, y);
  if (receipt.email) { y += 4.5; doc.text(receipt.email, M, y); }

  y += 12;

  // ---- This payment (gold box) ----
  const extraLines = (receipt.method ? 1 : 0) + (receipt.gateway_ref ? 1 : 0);
  const boxH = 22 + extraLines * 4.5;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.6);
  doc.roundedRect(M, y, contentW, boxH, 2.5, 2.5, "S");
  let by = y + 7;
  doc.setTextColor(...GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("THIS PAYMENT", M + 5, by);
  by += 7;
  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(doc.splitTextToSize(receipt.payment_label, contentW - 55), M + 5, by);
  doc.setTextColor(...NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text(inr(receipt.amount), pageW - M - 5, by + 1, { align: "right" });
  by += 6;
  if (receipt.method) {
    doc.setTextColor(...GREY);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text(`Payment method: ${receipt.method}`, M + 5, by);
    by += 4.5;
  }
  if (receipt.gateway_ref) {
    doc.setTextColor(...GREY);
    doc.setFont("courier", "normal");
    doc.setFontSize(8.5);
    doc.text(`Txn Ref: ${receipt.gateway_ref}`, M + 5, by);
    by += 2;
  }
  doc.setTextColor(...GREEN);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("GST included", M + 5, by + 2);

  y += boxH + 12;

  // ---- Account summary ----
  label("Account summary", M, y);
  y += 3;
  const rows: [string, string, boolean][] = [
    ["Total course fee", inr(receipt.total_fee), false],
    ["Total paid to date", inr(receipt.paid_to_date), true],
    ["Remaining balance", receipt.remaining <= 0 ? "Rs. 0 - Fully paid" : inr(receipt.remaining), false],
    ["Installments", receipt.installments_summary, false],
  ];
  doc.setFontSize(10);
  for (const [k, v, bold] of rows) {
    y += 7;
    doc.setTextColor(...GREY);
    doc.setFont("helvetica", "normal");
    doc.text(k, M, y);
    doc.setTextColor(20, 20, 20);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(v, pageW - M, y, { align: "right" });
    doc.setDrawColor(...LIGHT);
    doc.setLineWidth(0.2);
    doc.line(M, y + 2.5, pageW - M, y + 2.5);
  }

  y += 14;

  // ---- Footer ----
  doc.setDrawColor(...LIGHT);
  doc.setLineWidth(0.3);
  doc.line(M, y, pageW - M, y);
  y += 6;
  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`Thank you for choosing ${contact.name}.`, M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GREY);
  if (contact.address) { y += 5; doc.text(doc.splitTextToSize(contact.address, contentW), M, y); }
  const line2 = [contact.phone && `Phone: ${contact.phone}`, contact.whatsapp && `WhatsApp: ${contact.whatsapp}`].filter(Boolean).join("   |   ");
  if (line2) { y += 5; doc.text(line2, M, y); }
  if (contact.email) { y += 5; doc.text(`Email: ${contact.email}`, M, y); }
  y += 6;
  doc.setTextColor(150, 150, 150);
  doc.setFontSize(7.5);
  doc.text(
    doc.splitTextToSize("This is a system-generated receipt and is valid without a signature. For any query, quote your receipt number.", contentW),
    M,
    y
  );

  doc.save(`Receipt-${receipt.receipt_no}.pdf`);
}
