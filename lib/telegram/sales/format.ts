import { SITE_URL } from "../../config";
import { formatINR } from "../../dates";
import { escapeHtml, formatIstShort } from "../reports/format";

/** Mask phone for Telegram: 98989•••02 */
export function maskPhone(raw: string | null | undefined): string {
  const d = String(raw || "").replace(/\D/g, "").slice(-10);
  if (d.length < 10) return "••••••••••";
  return `${d.slice(0, 5)}•••${d.slice(-2)}`;
}

/**
 * Sales-channel-only dialable phone text. Telegram mobile auto-links E.164
 * numbers; keep it plain text (not <code>) so one tap opens the dialler.
 */
export function salesPhone(raw: string | null | undefined): string | null {
  const d = String(raw || "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `+91${d}` : null;
}

export function salesInr(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return formatINR(Math.round(amount));
}

/** Missing/zero money is omitted by message builders, never rendered as ₹0. */
export function optionalSalesInr(amount: number | null | undefined): string | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  return formatINR(Math.round(amount));
}

export function adminStudentDeepLink(opts: {
  studentId?: string | null;
  enrollmentId?: string | null;
  phone?: string | null;
  proofId?: string | null;
  review?: "installment_proof" | "payment_proof" | null;
}): string {
  const base = (SITE_URL || "https://www.namanias.com").replace(/\/$/, "");
  if (opts.studentId) {
    const q = new URLSearchParams();
    if (opts.enrollmentId) q.set("enrollmentId", opts.enrollmentId);
    if (opts.proofId) q.set("proofId", opts.proofId);
    const qs = q.toString();
    return `${base}/admin/students/${encodeURIComponent(opts.studentId)}${qs ? `?${qs}` : ""}`;
  }
  const phone = String(opts.phone || "").replace(/\D/g, "").slice(-10);
  if (phone) return `${base}/admin/students?phone=${encodeURIComponent(phone)}`;
  if (opts.review === "installment_proof") return `${base}/admin/access-risk`;
  return `${base}/admin/payments`;
}

export { escapeHtml, formatIstShort };
