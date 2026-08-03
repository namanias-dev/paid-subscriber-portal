/** Safe parse of a GA4 client_id from a request body. Never throws. */
export function parseGaClientId(raw: unknown): string | null {
  try {
    const s = String(raw ?? "").trim();
    if (!s || s.length > 64) return null;
    // Typical _ga-derived id: "XXXXXXXXXX.YYYYYYYYYY"
    if (/^\d{5,20}\.\d{5,20}$/.test(s)) return s;
    return null;
  } catch {
    return null;
  }
}
