"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { formatINR } from "@/lib/dates";
import type { PaymentReceipt } from "@/lib/types";

interface Contact {
  name: string;
  address: string;
  phone: string;
  email: string;
  whatsapp: string;
  logoUrl: string | null;
  logoAlt: string;
}

const NAVY = "#0a1a3f";
const GOLD = "#b8860b";

export default function ReceiptView({ receipt, contact }: { receipt: PaymentReceipt; contact: Contact }) {
  const issued = new Date(receipt.issued_at).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const statusColor = receipt.status === "Fully Paid" ? "#0a8a3a" : receipt.status === "Seat Booked" ? GOLD : "#b45309";

  return (
    <div className="container-wide section">
      {/* On-screen controls (hidden when printing) */}
      <div className="receipt-controls mx-auto mb-4 flex max-w-2xl items-center justify-between">
        <Link href="/portal" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
          <ArrowLeft size={16} /> Back to my portal
        </Link>
        <button onClick={() => window.print()} className="btn btn-primary inline-flex items-center gap-1.5 text-sm">
          <Printer size={16} /> Download / Print
        </button>
      </div>

      <div className="receipt-doc mx-auto max-w-2xl" style={{ color: "#0a0a0a", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" }}>
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 16, overflow: "hidden", background: "#fff", fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
          {/* Header */}
          <div style={{ background: `linear-gradient(135deg, ${NAVY}, #0f2557)`, color: "#fff", padding: 24, display: "flex", alignItems: "center", gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {contact.logoUrl ? (
              <img src={contact.logoUrl} alt={contact.logoAlt} style={{ height: 52, width: "auto", borderRadius: 8, background: "#fff", padding: 4 }} />
            ) : (
              <div style={{ height: 52, width: 52, borderRadius: 12, background: GOLD, color: NAVY, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 26 }}>N</div>
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{contact.name}</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>Official Payment Receipt</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, opacity: 0.8, textTransform: "uppercase", letterSpacing: 1 }}>Receipt No.</div>
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace" }}>{receipt.receipt_no}</div>
            </div>
          </div>

          <div style={{ padding: 24 }}>
            {/* Status + date */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span style={{ background: statusColor, color: "#fff", borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 700 }}>{receipt.status}</span>
              <span style={{ fontSize: 12, color: "#555" }}>{issued} (IST)</span>
            </div>

            {/* Bill to */}
            <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontSize: 13 }}>
              <div>
                <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 1 }}>Billed to</div>
                <div style={{ fontWeight: 700, marginTop: 2 }}>{receipt.student_name}</div>
                <div style={{ color: "#555" }}>{receipt.phone}</div>
                {receipt.email && <div style={{ color: "#555" }}>{receipt.email}</div>}
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 1 }}>Course</div>
                <div style={{ fontWeight: 700, marginTop: 2 }}>{receipt.course_title}</div>
                {receipt.batch_label && <div style={{ color: "#555" }}>{receipt.batch_label}</div>}
              </div>
            </div>

            {/* This payment */}
            <div style={{ marginTop: 20, border: `2px solid ${GOLD}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, color: GOLD, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1 }}>This payment</div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 6 }}>
                <span style={{ fontWeight: 600 }}>{receipt.payment_label}</span>
                <span style={{ fontSize: 24, fontWeight: 800, color: NAVY }}>{formatINR(receipt.amount)}</span>
              </div>
              {receipt.gateway_ref && (
                <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>Transaction Ref: <span style={{ fontFamily: "monospace" }}>{receipt.gateway_ref}</span></div>
              )}
              <div style={{ fontSize: 11, color: "#0a8a3a", marginTop: 4 }}>GST included</div>
            </div>

            {/* Account summary */}
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Account summary</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <tbody>
                  <SummaryRow k="Total course fee" v={formatINR(receipt.total_fee)} />
                  <SummaryRow k="Total paid to date" v={formatINR(receipt.paid_to_date)} bold />
                  <SummaryRow k="Remaining balance" v={receipt.remaining <= 0 ? "₹0 — Course fully paid" : formatINR(receipt.remaining)} />
                  <SummaryRow k="Installments" v={receipt.installments_summary} />
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div style={{ marginTop: 24, borderTop: "1px solid #eee", paddingTop: 16, fontSize: 12, color: "#555" }}>
              <div style={{ fontWeight: 700, color: "#0a0a0a" }}>Thank you for choosing {contact.name}.</div>
              {contact.address && <div style={{ marginTop: 4 }}>{contact.address}</div>}
              <div>
                {contact.phone && <>Phone: {contact.phone} &nbsp;|&nbsp; </>}
                {contact.whatsapp && <>WhatsApp: {contact.whatsapp}</>}
              </div>
              {contact.email && <div>Email: {contact.email}</div>}
              <div style={{ marginTop: 8, fontSize: 11, color: "#999" }}>
                This is a system-generated receipt and is valid without a signature. For any query, quote your receipt number.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <tr>
      <td style={{ padding: "8px 0", color: "#555", borderBottom: "1px solid #eee" }}>{k}</td>
      <td style={{ padding: "8px 0", fontWeight: bold ? 800 : 600, textAlign: "right", borderBottom: "1px solid #eee" }}>{v}</td>
    </tr>
  );
}
