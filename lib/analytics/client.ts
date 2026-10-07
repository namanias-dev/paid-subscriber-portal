"use client";

/**
 * Browser-side first-party analytics helpers: durable visitor id, rolling
 * session id, first/last-touch attribution capture, and a sendBeacon-based
 * emitter. All best-effort and SSR-safe (no-op on the server).
 */
import {
  VISITOR_COOKIE,
  SESSION_COOKIE,
  ATTR_COOKIE,
  buildTouch,
  chooseCookieValue,
  mergeAttribution,
  parseAttrCookie,
  serializeAttr,
} from "@/lib/attribution";
import type { EventName } from "./events";
import { externalNotesDispatch, isQaState, NOTES_SCHEMA_VERSION, stripAnalyticsProps } from "./notesCommerce";
import { ga4Event } from "./ga4";
import { trackMetaPixel } from "./metaPixel";

const YEAR = 60 * 60 * 24 * 365;
const SESSION_TTL = 60 * 30; // 30 min rolling session

function isBrowser(): boolean {
  return typeof document !== "undefined";
}

function readCookie(name: string): string | null {
  if (!isBrowser()) return null;
  return chooseCookieValue(name, document.cookie);
}

function writeCookie(name: string, value: string, maxAge: number): void {
  if (!isBrowser()) return;
  const secure = location.protocol === "https:" ? "; secure" : "";
  const shared = location.hostname === "namanias.com" || location.hostname.endsWith(".namanias.com");
  if (shared) {
    // Expire a host-only cookie so it cannot shadow the shared www/apex cookie.
    document.cookie = `${name}=; path=/; max-age=0`;
    document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; samesite=lax${secure}; domain=.namanias.com`;
    return;
  }
  document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; samesite=lax${secure}`;
}

function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* ignore */ }
  return "v-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function ensureVisitorId(): string | null {
  if (!isBrowser()) return null;
  let id = readCookie(VISITOR_COOKIE);
  if (!id) { id = uuid(); writeCookie(VISITOR_COOKIE, id, YEAR * 2); }
  return id;
}

/** Returns the session id and whether it was freshly created (=> session_start). */
export function ensureSession(): { id: string; isNew: boolean } | null {
  if (!isBrowser()) return null;
  const existing = readCookie(SESSION_COOKIE);
  const id = existing || uuid();
  writeCookie(SESSION_COOKIE, id, SESSION_TTL); // refresh sliding window
  return { id, isNew: !existing };
}

/** Capture/refresh attribution (first-touch frozen, last-touch rolling). */
export function captureAttribution(): void {
  if (!isBrowser()) return;
  try {
    const url = new URL(location.href);
    const params: Record<string, string> = {};
    // Standard UTM + full ad-hierarchy ids (additive). Meta/Google inject
    // campaign_id/adset_id/ad_id/ad_name via URL parameter tokens — see
    // docs/naman-ai/reports/attribution-full-capture.md for the copy-paste
    // parameter blocks the marketer pastes into each platform.
    for (const k of [
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id",
      "campaign_id", "adset_id", "ad_id", "ad_name", "clid",
    ]) {
      const v = url.searchParams.get(k);
      if (v) params[k] = v;
    }
    const touch = buildTouch({
      params,
      referrer: document.referrer || null,
      path: url.pathname,
      ownHost: location.hostname,
    });
    // Meta click ids (non-PII), captured additively so CAPI can match without
    // advanced matching. `_fbp`/`_fbc` are set by the pixel when it loads; when
    // there's an ?fbclid= but no `_fbc` yet, derive it so we don't lose the click.
    const fbclid = url.searchParams.get("fbclid");
    const fbp = readCookie("_fbp");
    let fbc = readCookie("_fbc");
    if (!fbc && fbclid) fbc = `fb.1.${Date.now()}.${fbclid}`;
    if (fbclid) touch.fbclid = fbclid;
    if (fbc) touch.fbc = fbc;
    if (fbp) touch.fbp = fbp;
    // Google Ads click ids (non-PII). `gclid` is set by auto-tagging on classic
    // web ads; `wbraid`/`gbraid` are the privacy-safe iOS/Android app click ids
    // that Google uses when auto-tagging can't set a cookie.
    const gclid = url.searchParams.get("gclid");
    if (gclid) touch.gclid = gclid;
    const wbraid = url.searchParams.get("wbraid");
    if (wbraid) touch.wbraid = wbraid;
    const gbraid = url.searchParams.get("gbraid");
    if (gbraid) touch.gbraid = gbraid;
    const existing = parseAttrCookie(readCookie(ATTR_COOKIE));
    const merged = mergeAttribution(existing, touch, new Date().toISOString());
    writeCookie(ATTR_COOKIE, serializeAttr(merged), YEAR * 2);
  } catch { /* ignore */ }
}

function emitBeacon(event: EventName, props: Record<string, unknown>): void {
  const safe = stripAnalyticsProps(props);
  if (event.startsWith("notes_") && safe.schema_version == null) safe.schema_version = NOTES_SCHEMA_VERSION;
  const attr = parseAttrCookie(readCookie(ATTR_COOKIE));
  if (event.startsWith("notes_") && isQaState(attr)) safe.is_test = true;
  const payload = JSON.stringify({
    event_name: event,
    props: safe,
    page_path: location.pathname,
    referrer: document.referrer || null,
    visitor_id: readCookie(VISITOR_COOKIE),
    session_id: readCookie(SESSION_COOKIE),
  });
  const url = "/api/track";
  if (navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
  } else {
    void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
  }
  if (event.startsWith("notes_")) dispatchNotesProviders(event, safe);
  if (localStorage.getItem("nsa_analytics_debug") === "1") {
    console.info("[notes-analytics]", event, safe);
  }
}

/**
 * Fire an event to the first-party beacon. Never throws; non-blocking.
 * Identity cookies are written before the payload is read. Page effects run
 * before the layout tracker, so the first store view used to leave with no id.
 */
export function trackClient(event: EventName, props: Record<string, unknown> = {}): void {
  if (!isBrowser()) return;
  try {
    ensureVisitorId();
    const session = ensureSession();
    if (!readCookie(ATTR_COOKIE)) captureAttribution();
    if (session?.isNew && event !== "session_start") {
      emitBeacon("session_start", {
        entry_path: location.pathname,
        is_new_visitor: !document.referrer || !document.referrer.includes(location.hostname),
        utm_present: /utm_/.test(location.search),
      });
    }
    emitBeacon(event, props);
  } catch { /* ignore */ }
}

function dispatchNotesProviders(event: EventName, props: Record<string, unknown>): void {
  try {
    const posthog = (window as unknown as { posthog?: { capture?: (name: string, props: Record<string, unknown>) => void } }).posthog;
    posthog?.capture?.(event, props);
  } catch { /* provider down */ }
  try {
    const mapped = externalNotesDispatch(event, props);
    if (mapped.ga4) ga4Event(mapped.ga4.name, mapped.ga4.params, { beacon: event === "notes_payment_gateway_opened" });
    if (mapped.meta) {
      trackMetaPixel(mapped.meta.name, `${event}:${String(props.product_id || props.slug || "notes")}`, mapped.meta.params);
    }
  } catch { /* provider down */ }
}
