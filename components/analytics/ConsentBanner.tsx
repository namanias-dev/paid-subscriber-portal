"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { CONSENT_COOKIE, CONSENT_VERSION, type ConsentState } from "@/lib/attribution";
import { trackClient } from "@/lib/analytics/client";
import { isEnrollmentCheckoutPath } from "@/lib/enrollmentPath";
import {
  PRIVACY_SETTINGS_EVENT,
  purgeLegacyConsentUiFlags,
  readStoredConsent,
} from "@/lib/analytics/consentPrompt";

const YEAR = 60 * 60 * 24 * 365;

function writeConsent(state: ConsentState) {
  if (typeof document === "undefined") return;
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(state))}; path=/; max-age=${YEAR}; samesite=lax${secure}`;
  try { window.dispatchEvent(new CustomEvent("nsa:consent", { detail: state })); } catch { /* ignore */ }
  trackClient("consent_updated", { analytics: state.analytics, marketing: state.marketing, version: state.version });
}

/**
 * Privacy choices panel. It stays unmounted until the visitor opens Privacy
 * Settings. A missing cookie, a reload, a route change, or a timer never
 * opens it and never writes an accept choice.
 */
export default function ConsentBanner() {
  const reduce = useReducedMotion();
  const checkout = isEnrollmentCheckoutPath(usePathname());
  const [open, setOpen] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    purgeLegacyConsentUiFlags(window.localStorage, window.sessionStorage);
    const onOpen = () => {
      const stored = readStoredConsent(document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`))?.[1]);
      setAnalytics(stored?.analytics === true);
      setMarketing(stored?.marketing === true);
      setOpen(true);
    };
    window.addEventListener(PRIVACY_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(PRIVACY_SETTINGS_EVENT, onOpen);
  }, []);

  function decide(a: boolean, m: boolean) {
    writeConsent({ analytics: a, marketing: m, version: CONSENT_VERSION });
    setOpen(false);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-label="Cookie & privacy preferences"
          data-print-hide
          initial={reduce ? false : { y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { y: 24, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className={`fixed inset-x-3 z-[60] mx-auto max-w-2xl overflow-y-auto rounded-2xl border border-line bg-white/95 p-4 shadow-[0_20px_60px_-20px_rgba(10,26,63,0.45)] backdrop-blur-md sm:p-5 ${
            checkout
              ? "bottom-[calc(var(--checkout-paybar-height,calc(5.5rem+env(safe-area-inset-bottom,0px)))+1rem)] max-h-[min(46dvh,calc(100dvh-var(--checkout-paybar-height,calc(5.5rem+env(safe-area-inset-bottom,0px)))-2rem))] lg:bottom-3 lg:max-h-[46dvh]"
              : "bottom-3"
          }`}
        >
          <div className="flex flex-col gap-3">
            <div>
              <p className="font-heading text-base font-bold text-ink">Privacy Settings</p>
              <p className="mt-1 text-sm text-ink2">
                Essential first-party tools that run the store, checkout, and security stay on. Optional
                behaviour analytics and advertising measurement stay off until you choose them here.
              </p>
            </div>

            <div className="rounded-xl border border-line bg-surface/60 p-3 text-sm">
              <label className="flex items-center justify-between gap-3 py-1.5">
                <span><span className="font-semibold">Behaviour analytics</span><span className="block text-xs text-muted">Product usage and session insights.</span></span>
                <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} className="h-4 w-4" />
              </label>
              <label className="flex items-center justify-between gap-3 py-1.5">
                <span><span className="font-semibold">Marketing</span><span className="block text-xs text-muted">Ad measurement and optimization.</span></span>
                <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="h-4 w-4" />
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost text-sm">Close</button>
              <button type="button" onClick={() => decide(analytics, marketing)} className="btn btn-secondary text-sm">Save choices</button>
              <button type="button" onClick={() => decide(false, false)} className="btn btn-secondary text-sm">Reject non-essential</button>
              <button type="button" onClick={() => decide(true, true)} className="btn btn-primary text-sm">Accept all</button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
