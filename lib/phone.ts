/**
 * Indian mobile number normalization.
 *
 * Admins enter numbers in many shapes (10-digit, +91…, 91…, with spaces/
 * dashes/brackets, or a leading 0). We normalize to a single canonical form so
 * WhatsApp links never break — fixing the bug where a bare 10-digit number was
 * sent to wa.me without a country code and resolved to the wrong country (+84).
 */

export interface NormalizedMobile {
  ok: boolean;
  /** Bare 10 digits, e.g. "9876543210". */
  digits10?: string;
  /** Display form, e.g. "+91 98765 43210". */
  display?: string;
  /** E.164, e.g. "+919876543210". */
  e164?: string;
  /** WhatsApp form (no plus), e.g. "919876543210". */
  wa?: string;
  error?: string;
}

/** Strip everything except digits. */
function digitsOnly(raw: string): string {
  return (raw || "").replace(/\D/g, "");
}

/**
 * Normalize a user-entered Indian mobile number.
 * Accepts: "9876543210", "+91 98765-43210", "919876543210", "09876543210".
 * Rejects anything that does not reduce to a valid 10-digit mobile (starts 6-9).
 */
export function normalizeIndianMobile(raw: string | null | undefined): NormalizedMobile {
  const input = (raw || "").trim();
  if (!input) return { ok: false, error: "Enter a mobile number." };

  let d = digitsOnly(input);

  // Drop common prefixes down to the core 10-digit number.
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2); // 91XXXXXXXXXX
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1); // 0XXXXXXXXXX
  else if (d.length === 13 && d.startsWith("091")) d = d.slice(3);

  if (d.length !== 10) {
    return { ok: false, error: "Enter a valid 10-digit Indian mobile number." };
  }
  if (!/^[6-9]\d{9}$/.test(d)) {
    return { ok: false, error: "Indian mobile numbers start with 6, 7, 8, or 9." };
  }

  return {
    ok: true,
    digits10: d,
    display: `+91 ${d.slice(0, 5)} ${d.slice(5)}`,
    e164: `+91${d}`,
    wa: `91${d}`,
  };
}

/**
 * Loose 10-digit normalization for analytics/event matching: the canonical
 * Indian mobile digits when the input is a valid mobile, else a best-effort
 * last-10-digits fallback so records with unusual formatting still correlate.
 * Returns null for empty input. Shared by the analytics/event layers so every
 * phone-based match uses one definition. (Stricter callers should prefer
 * {@link normalizeIndianMobile} directly and reject `.ok === false`.)
 */
export function normPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const n = normalizeIndianMobile(raw);
  return n.ok && n.digits10 ? n.digits10 : String(raw).replace(/\D/g, "").slice(-10) || null;
}

/**
 * Build a wa.me link. Returns null if the number is invalid.
 * Accepts a raw or already-normalized number.
 */
export function whatsappLink(raw: string | null | undefined, message?: string | null): string | null {
  const n = normalizeIndianMobile(raw);
  if (!n.ok || !n.wa) return null;
  const base = `https://wa.me/${n.wa}`;
  const msg = (message || "").trim();
  return msg ? `${base}?text=${encodeURIComponent(msg)}` : base;
}

/** Build a tel: link. Returns null if the number is invalid. */
export function telLink(raw: string | null | undefined): string | null {
  const n = normalizeIndianMobile(raw);
  if (!n.ok || !n.e164) return null;
  return `tel:${n.e164}`;
}
