"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ga4Init,
  ga4PageView,
  hasMarketingConsent,
  isGa4Configured,
  isPublicAnalyticsPath,
} from "@/lib/analytics/ga4";

/**
 * GA4 loader + SPA page_view emitter. Mounted once (root layout, in Suspense) and
 * mirrors ThirdParty.tsx (the Meta Pixel loader) exactly, but for Google
 * Analytics 4 — and stays completely INDEPENDENT of Meta + the in-house Tracker
 * (no shared state; separate emitter in lib/analytics/ga4.ts):
 *  - fully inert unless NEXT_PUBLIC_GA_MEASUREMENT_ID is set;
 *  - loads gtag.js only AFTER marketing consent (nsa_consent), and re-evaluates
 *    the instant consent is granted post-load by listening for the SAME
 *    "nsa:consent" event ConsentBanner dispatches — no manual refresh needed;
 *  - PUBLIC MARKETING PAGES ONLY: never loads or sends on admin/dashboard/portal/
 *    login/payment/quiz-print pages (isPublicAnalyticsPath);
 *  - fires page_view once on initial load and once per client route change; with
 *    send_page_view:false set at config time nothing is double-counted.
 */
export default function GoogleAnalytics() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [consentTick, setConsentTick] = useState(0);
  const lastSent = useRef<string | null>(null);

  // Re-run the effect below when consent is granted AFTER load. ConsentBanner
  // dispatches "nsa:consent" (same event the Meta loader listens to).
  useEffect(() => {
    if (!isGa4Configured()) return;
    const onConsent = () => setConsentTick((t) => t + 1);
    window.addEventListener("nsa:consent", onConsent as EventListener);
    return () => window.removeEventListener("nsa:consent", onConsent as EventListener);
  }, []);

  useEffect(() => {
    if (!isGa4Configured()) return; // no measurement id => fully inert
    if (!isPublicAnalyticsPath(pathname)) return; // private page => no load, no page_view
    if (!hasMarketingConsent()) return; // no consent => nothing loads/fires
    ga4Init(); // idempotent gtag bootstrap (only runs once)
    const key = `${pathname}?${search?.toString() || ""}`;
    if (lastSent.current === key) return; // dedupe: initial load never double-counts
    lastSent.current = key;
    ga4PageView({ path: pathname || "/", search: search?.toString() || "" });
  }, [pathname, search, consentTick]);

  return null;
}
