"use client";

/**
 * Browser-side Meta Pixel event helpers. Thin, best-effort wrappers over the
 * `window.fbq` that ThirdParty.tsx loads (consent-gated). Every helper:
 *  - no-ops on the server / when the pixel isn't loaded / without marketing consent;
 *  - fires with the SAME deterministic `event_id` the server CAPI uses, so Meta
 *    dedupes the pixel + CAPI copies into a single conversion.
 * Never throws.
 */
import { CONSENT_COOKIE, parseConsentCookie } from "@/lib/attribution";
import {
  purchaseEventId,
  leadEventId,
  initiateCheckoutEventId,
  type MetaEventName,
} from "./metaEvents";

type Fbq = ((...args: unknown[]) => void) | undefined;

function hasMarketingConsent(): boolean {
  if (typeof document === "undefined") return false;
  const c = parseConsentCookie(document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`))?.[1]);
  return !!c?.marketing;
}

function fbq(): Fbq {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { fbq?: Fbq }).fbq;
}

/** Fire a pixel event with a shared event_id. Silent no-op when not permitted. */
export function trackMetaPixel(
  name: MetaEventName,
  eventId: string,
  customData: Record<string, unknown> = {},
): void {
  try {
    if (!hasMarketingConsent()) return;
    const f = fbq();
    if (!f) return;
    f("track", name, customData, { eventID: eventId });
  } catch { /* never throw */ }
}

export function metaPixelLead(id: string, opts: { value?: number; contentName?: string | null } = {}): void {
  trackMetaPixel("Lead", leadEventId(id), {
    currency: "INR",
    value: opts.value ?? 0,
    ...(opts.contentName ? { content_name: opts.contentName } : {}),
  });
}

export function metaPixelInitiateCheckout(ref: string, opts: { value?: number; contentName?: string | null; category?: string | null } = {}): void {
  trackMetaPixel("InitiateCheckout", initiateCheckoutEventId(ref), {
    currency: "INR",
    ...(typeof opts.value === "number" ? { value: opts.value } : {}),
    ...(opts.contentName ? { content_name: opts.contentName } : {}),
    ...(opts.category ? { content_category: opts.category } : {}),
  });
}

export function metaPixelPurchase(ref: string, opts: { value: number; contentName?: string | null; category?: string | null } = { value: 0 }): void {
  trackMetaPixel("Purchase", purchaseEventId(ref), {
    currency: "INR",
    value: opts.value,
    ...(opts.contentName ? { content_name: opts.contentName } : {}),
    ...(opts.category ? { content_category: opts.category } : {}),
  });
}
