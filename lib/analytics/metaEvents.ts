/**
 * Meta (Facebook) event plumbing shared by the BROWSER pixel and the SERVER
 * Conversions API (CAPI). Pure module — no next/*, DOM, or node imports — so it
 * is safe to import on both sides.
 *
 * The whole point of this file is DEDUPLICATION: the pixel and CAPI both send the
 * same logical event with the SAME `event_id`, so Meta counts it once. The ids
 * here are DETERMINISTIC (derived from stable business keys — payment ref,
 * registration id) so both sides compute an identical id with no extra plumbing.
 */

/** Current Graph API version we target (override via env if Meta bumps it). */
export const META_GRAPH_VERSION = "v21.0";

export type MetaEventName =
  | "PageView"
  | "Lead"
  | "InitiateCheckout"
  | "Purchase";

/** Deterministic Purchase id for a payment (shared by pixel + CAPI). */
export function purchaseEventId(ref: string): string {
  return `paid_${ref}`;
}

/** Deterministic Lead id for a (free) registration. */
export function leadEventId(id: string): string {
  return `lead_${id}`;
}

/** Deterministic InitiateCheckout id for a payment attempt. */
export function initiateCheckoutEventId(ref: string): string {
  return `ic_${ref}`;
}

/**
 * Meta requires `_fbc` in the form `fb.1.<unixMs>.<fbclid>`. Given a raw fbclid
 * (from the landing URL) build that form; returns null when there is no fbclid.
 */
export function fbcFromFbclid(fbclid: string | null | undefined, tsMs?: number): string | null {
  const id = (fbclid || "").trim();
  if (!id) return null;
  return `fb.1.${tsMs ?? Date.now()}.${id}`;
}

/** Public (client-visible) config presence — pixel id is a NEXT_PUBLIC var. */
export function pixelIdPublic(): string | undefined {
  const v = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  return v && v.trim() !== "" ? v : undefined;
}
