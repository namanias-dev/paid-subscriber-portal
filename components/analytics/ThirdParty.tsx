"use client";

import { useEffect } from "react";
import { CONSENT_COOKIE, parseConsentCookie } from "@/lib/attribution";

/**
 * Optional 3rd-party loaders (PostHog behaviour analytics + Meta Pixel),
 * COMPLETELY INERT until BOTH (a) the relevant NEXT_PUBLIC_* env key is set AND
 * (b) the user has granted the matching consent. No keys => nothing loads, zero
 * network, zero bundle cost (loaded lazily via injected script, no npm dep).
 */
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

function readConsent() {
  if (typeof document === "undefined") return null;
  return parseConsentCookie(document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`))?.[1]);
}

function loadPostHog() {
  if (!POSTHOG_KEY || (window as unknown as { __ph?: boolean }).__ph) return;
  (window as unknown as { __ph?: boolean }).__ph = true;
  const s = document.createElement("script");
  s.src = `${POSTHOG_HOST}/static/array.js`;
  s.async = true;
  s.onload = () => {
    try {
      // @ts-expect-error injected global
      window.posthog?.init?.(POSTHOG_KEY, { api_host: POSTHOG_HOST, capture_pageview: true, persistence: "localStorage+cookie" });
    } catch { /* ignore */ }
  };
  document.head.appendChild(s);
}

function loadMetaPixel() {
  const w = window as unknown as { __fbq?: boolean; fbq?: ((...a: unknown[]) => void) & { queue?: unknown[]; loaded?: boolean; version?: string }; _fbq?: unknown };
  if (!META_PIXEL_ID || w.__fbq) return;
  w.__fbq = true;
  // Minimal Meta Pixel bootstrap (typed): queue calls until fbevents.js loads.
  const fbq = ((...args: unknown[]) => { fbq.queue!.push(args); }) as ((...a: unknown[]) => void) & { queue: unknown[]; loaded: boolean; version: string };
  fbq.queue = [];
  fbq.loaded = true;
  fbq.version = "2.0";
  w.fbq = fbq;
  w._fbq = fbq;
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(script);
  try {
    fbq("init", META_PIXEL_ID);
    fbq("track", "PageView");
  } catch { /* ignore */ }
}

function apply(consent: ReturnType<typeof readConsent>) {
  if (!consent) return;
  if (consent.analytics) loadPostHog();
  if (consent.marketing) loadMetaPixel();
}

export default function ThirdParty() {
  useEffect(() => {
    if (!POSTHOG_KEY && !META_PIXEL_ID) return; // fully inert without keys
    apply(readConsent());
    const onConsent = (e: Event) => apply((e as CustomEvent).detail);
    window.addEventListener("nsa:consent", onConsent as EventListener);
    return () => window.removeEventListener("nsa:consent", onConsent as EventListener);
  }, []);
  return null;
}
