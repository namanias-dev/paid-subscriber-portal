"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { CONSENT_COOKIE, CONSENT_VERSION, parseConsentCookie, type ConsentState } from "@/lib/attribution";
import { trackClient } from "@/lib/analytics/client";

const YEAR = 60 * 60 * 24 * 365;

function writeConsent(state: ConsentState) {
  if (typeof document === "undefined") return;
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(state))}; path=/; max-age=${YEAR}; samesite=lax${secure}`;
  try { window.dispatchEvent(new CustomEvent("nsa:consent", { detail: state })); } catch { /* ignore */ }
  trackClient("consent_updated", { analytics: state.analytics, marketing: state.marketing, version: state.version });
}

/**
 * DPDP + Meta-friendly consent banner. Our OWN essential first-party analytics
 * run under legitimate interest regardless; this gate controls only the optional
 * 3rd-party tools (behaviour analytics + ad marketing). Fixed overlay = no layout
 * shift; prefers-reduced-motion respected.
 */
export default function ConsentBanner() {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [manage, setManage] = useState(false);
  const [analytics, setAnalytics] = useState(true);
  const [marketing, setMarketing] = useState(true);

  useEffect(() => {
    const c = parseConsentCookie(document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=([^;]*)`))?.[1]);
    if (!c || c.version !== CONSENT_VERSION) setOpen(true);
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
          initial={reduce ? false : { y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { y: 24, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-2xl rounded-2xl border border-line bg-white/95 p-4 shadow-[0_20px_60px_-20px_rgba(10,26,63,0.45)] backdrop-blur-md sm:p-5"
        >
          <div className="flex flex-col gap-3">
            <div>
              <p className="font-heading text-base font-bold text-ink">We value your privacy</p>
              <p className="mt-1 text-sm text-ink2">
                We use essential first-party analytics to run and secure the platform. With your consent we also use
                optional tools to understand usage and improve our ads. You can change this anytime.
              </p>
            </div>

            {manage && (
              <div className="rounded-xl border border-line bg-surface/60 p-3 text-sm">
                <label className="flex items-center justify-between gap-3 py-1.5">
                  <span><span className="font-semibold">Behaviour analytics</span><span className="block text-xs text-muted">Product usage & session insights.</span></span>
                  <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} className="h-4 w-4" />
                </label>
                <label className="flex items-center justify-between gap-3 py-1.5">
                  <span><span className="font-semibold">Marketing</span><span className="block text-xs text-muted">Ad measurement & optimization (Meta).</span></span>
                  <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} className="h-4 w-4" />
                </label>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              {!manage ? (
                <button onClick={() => setManage(true)} className="btn btn-ghost text-sm">Manage</button>
              ) : (
                <button onClick={() => decide(analytics, marketing)} className="btn btn-secondary text-sm">Save choices</button>
              )}
              <button onClick={() => decide(false, false)} className="btn btn-secondary text-sm">Reject non-essential</button>
              <button onClick={() => decide(true, true)} className="btn btn-primary text-sm">Accept all</button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
