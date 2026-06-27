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
  mergeAttribution,
  parseAttrCookie,
  serializeAttr,
} from "@/lib/attribution";
import type { EventName } from "./events";

const YEAR = 60 * 60 * 24 * 365;
const SESSION_TTL = 60 * 30; // 30 min rolling session

function isBrowser(): boolean {
  return typeof document !== "undefined";
}

function readCookie(name: string): string | null {
  if (!isBrowser()) return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? m[1] : null;
}

function writeCookie(name: string, value: string, maxAge: number): void {
  if (!isBrowser()) return;
  const secure = location.protocol === "https:" ? "; secure" : "";
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
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
      const v = url.searchParams.get(k);
      if (v) params[k] = v;
    }
    const touch = buildTouch({
      params,
      referrer: document.referrer || null,
      path: url.pathname,
      ownHost: location.hostname,
    });
    const existing = parseAttrCookie(readCookie(ATTR_COOKIE));
    const merged = mergeAttribution(existing, touch, new Date().toISOString());
    writeCookie(ATTR_COOKIE, serializeAttr(merged), YEAR * 2);
  } catch { /* ignore */ }
}

/** Fire an event to the first-party beacon. Never throws; non-blocking. */
export function trackClient(event: EventName, props: Record<string, unknown> = {}): void {
  if (!isBrowser()) return;
  try {
    const payload = JSON.stringify({
      event_name: event,
      props,
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
  } catch { /* ignore */ }
}
