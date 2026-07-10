"use client";

/**
 * Google Analytics 4 (GA4) emitter — an INDEPENDENT loader + event layer that is
 * completely separate from the Meta Pixel/CAPI (lib/analytics/metaPixel.ts) and
 * the in-house first-party analytics (lib/analytics/client.ts). It shares NO
 * mutable state with either and never imports/mutates their pipelines; the only
 * thing it reuses is the READ-ONLY consent cookie helper.
 *
 * Guarantees (every export):
 *  - SSR-safe: silent no-op on the server.
 *  - Inert unless NEXT_PUBLIC_GA_MEASUREMENT_ID (format `G-XXXXXXXXXX`) is set.
 *  - Consent-gated: nothing loads or fires without MARKETING consent, read from
 *    the SAME `nsa_consent` cookie the Meta Pixel uses.
 *  - PII-safe: page URLs are whitelisted down to path + utm_* only; every event
 *    payload is run through sanitizeParams() which strips PII-looking keys/values.
 *  - Never throws.
 *
 * No new npm dependency: gtag.js is injected lazily via a <script> tag, mirroring
 * how ThirdParty.tsx bootstraps the Meta Pixel.
 */
import { CONSENT_COOKIE, parseConsentCookie } from "@/lib/attribution";

/** Measurement id — env only, never hardcoded. Empty => GA4 fully disabled. */
export const GA4_MEASUREMENT_ID = (process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "").trim();

type GtagFn = (...args: unknown[]) => void;

interface GaWindow {
  dataLayer?: unknown[];
  gtag?: GtagFn;
  /** Set once gtag.js has been bootstrapped, so we never double-load. */
  __ga4Loaded?: boolean;
}

/** Is a valid GA4 measurement id configured? */
export function isGa4Configured(): boolean {
  return /^G-[A-Z0-9]+$/i.test(GA4_MEASUREMENT_ID);
}

function gaWindow(): GaWindow | null {
  if (typeof window === "undefined") return null;
  return window as unknown as GaWindow;
}

/** Read MARKETING consent from the shared nsa_consent cookie (read-only). */
export function hasMarketingConsent(): boolean {
  if (typeof document === "undefined") return false;
  const c = parseConsentCookie(
    document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`))?.[1],
  );
  return !!c?.marketing;
}

/**
 * Private / authenticated / PII-sensitive route prefixes. GA4 NEVER auto-loads
 * or sends a page_view on these — public marketing pages only. Mirrors the
 * existing noindex/private boundary (app/robots.ts + the route-group structure:
 * admin, dashboard, and the private pages that live inside the (site) group).
 *
 * Note on /payment: the payment status page carries a login code + reference in
 * its URL (PII), so we never send a page_view there. The PII-free purchase
 * conversion (value + currency only) is still emitted from that page via the
 * explicit ga4Event() call in StatusClient — see sanitizeParams().
 */
const PRIVATE_PREFIXES = ["/admin", "/dashboard", "/portal", "/login", "/quiz-print", "/payment"];

export function isPublicAnalyticsPath(pathname: string | null | undefined): boolean {
  const p = (pathname || "").split("?")[0].split("#")[0];
  if (!p) return false;
  for (const pre of PRIVATE_PREFIXES) {
    if (p === pre || p.startsWith(`${pre}/`)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * PII SAFETY
 * ------------------------------------------------------------------ */

/** Query params considered safe (non-PII marketing attribution) to forward. */
const SAFE_QUERY_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
]);

/** Keys that must never reach GA4 (defense-in-depth on every event payload). */
const PII_KEY = /(name|phone|mobile|email|e-?mail|code|token|otp|secret|password|pwd|address|dob|aadhaar|pan|proof|login|order_id|receipt|ref\b|sig|gateway)/i;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_LIKE = /(?:\+?\d[\s-]?){7,}/;

/**
 * Whitelist a search string down to safe utm_* params only. Strips phone, email,
 * tokens, fbclid, codes, ids, ref/sig/amt, and anything else not whitelisted.
 */
function safeSearch(searchParams?: URLSearchParams | string | null): string {
  let sp: URLSearchParams;
  try {
    if (typeof searchParams === "string") sp = new URLSearchParams(searchParams);
    else if (searchParams) sp = new URLSearchParams(searchParams.toString());
    else sp = new URLSearchParams();
  } catch {
    return "";
  }
  const safe = new URLSearchParams();
  sp.forEach((v, k) => {
    if (SAFE_QUERY_PARAMS.has(k.toLowerCase())) safe.set(k, v);
  });
  return safe.toString();
}

/** PII-safe path + whitelisted query (no hash). e.g. "/webinars/x?utm_source=ig". */
export function safePath(pathname: string, searchParams?: URLSearchParams | string | null): string {
  const p = (pathname || "/").split("#")[0].split("?")[0] || "/";
  const qs = safeSearch(searchParams);
  return qs ? `${p}?${qs}` : p;
}

/** PII-safe absolute page_location (origin + whitelisted path). */
function safeLocation(pathname: string, searchParams?: URLSearchParams | string | null): string {
  const origin = typeof location !== "undefined" ? location.origin : "";
  return origin + safePath(pathname, searchParams);
}

/** Strip PII-looking keys/values; keep only primitive, safe params. */
export function sanitizeParams(params: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (PII_KEY.test(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === "string") {
      if (EMAIL_LIKE.test(v) || PHONE_LIKE.test(v)) continue;
      out[k] = v.slice(0, 100);
    } else if (typeof v === "number") {
      if (Number.isFinite(v)) out[k] = v;
    } else if (typeof v === "boolean") {
      out[k] = v;
    }
    // objects/arrays/functions are intentionally dropped
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * LOADER + EMITTER
 * ------------------------------------------------------------------ */

/**
 * Lazily bootstrap gtag.js. Idempotent, and a no-op unless configured AND
 * marketing consent is granted. Returns the gtag fn (or null when not permitted).
 * Uses `send_page_view:false` so the initial config never double-counts with the
 * manual SPA page_view.
 */
function ensureGtag(): GtagFn | null {
  const w = gaWindow();
  if (!w) return null;
  if (!isGa4Configured() || !hasMarketingConsent()) return null;
  if (w.__ga4Loaded && w.gtag) return w.gtag;
  w.__ga4Loaded = true;
  const dataLayer: unknown[] = w.dataLayer || [];
  w.dataLayer = dataLayer;
  function gtag() {
    dataLayer.push(arguments);
  }
  const gtagFn = gtag as unknown as GtagFn;
  w.gtag = gtagFn;
  gtagFn("js", new Date());
  gtagFn("config", GA4_MEASUREMENT_ID, { send_page_view: false });
  try {
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_MEASUREMENT_ID)}`;
    document.head.appendChild(s);
  } catch {
    /* ignore — dataLayer still queues; nothing breaks */
  }
  return gtagFn;
}

/** Initialise gtag if permitted (used by the loader on public pages). Idempotent. */
export function ga4Init(): void {
  ensureGtag();
}

/**
 * Emit a GA4 event from a PUBLIC marketing page. Silent no-op on the server,
 * without a measurement id, without marketing consent, OR on a private/
 * authenticated route (isPublicAnalyticsPath) — so a stray call from e.g. the
 * floating WhatsApp button on /portal, or the shared quiz engine on /dashboard,
 * can NEVER load gtag or fire on a private page. Payload is always
 * PII-sanitised. Never throws.
 */
export function ga4Event(name: string, params: Record<string, unknown> = {}): void {
  try {
    if (typeof location !== "undefined" && !isPublicAnalyticsPath(location.pathname)) return;
    const gtag = ensureGtag();
    if (!gtag) return;
    gtag("event", name, sanitizeParams(params));
  } catch {
    /* never throw */
  }
}

/**
 * Emit a PII-free CONVERSION event that is allowed to fire on the (otherwise
 * excluded) payment status page. Same consent/config/PII-sanitise guarantees as
 * ga4Event, but WITHOUT the public-path gate — because the payment/status page
 * is the only client-side point where a completed purchase is known. Callers
 * MUST pass numeric value + currency only (no ref, no login code, no item/person
 * data); sanitizeParams() strips anything PII-looking as a second line of defence.
 * No page_view is ever sent on that page — only this conversion.
 */
export function ga4ConversionEvent(name: string, params: Record<string, unknown> = {}): void {
  try {
    const gtag = ensureGtag();
    if (!gtag) return;
    gtag("event", name, sanitizeParams(params));
  } catch {
    /* never throw */
  }
}

/**
 * Emit a GA4 page_view with a PII-stripped page_location + page_title. Called on
 * initial load and on every client route change by the loader component.
 */
export function ga4PageView(input: {
  path: string;
  search?: URLSearchParams | string | null;
  title?: string;
}): void {
  try {
    const gtag = ensureGtag();
    if (!gtag) return;
    const title =
      input.title || (typeof document !== "undefined" ? document.title : "") || "";
    gtag("event", "page_view", {
      page_location: safeLocation(input.path, input.search),
      page_path: safePath(input.path, input.search),
      page_title: title.slice(0, 300),
    });
  } catch {
    /* ignore */
  }
}
