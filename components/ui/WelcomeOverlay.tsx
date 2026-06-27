"use client";

import { useCallback, useEffect, useState } from "react";
import Logo from "@/components/ui/Logo";

const KEY = "nsa_welcome";

/**
 * Premium per-login welcome transition. Plays on EVERY successful login:
 *  - login forms set a one-shot sessionStorage flag AND dispatch `nsa:welcome`
 *    (the event covers soft client navigation; the flag covers a hard reload).
 * Pure CSS transforms/opacity (GPU-accelerated) — no framer-motion / WebGL, zero
 * added bundle weight beyond this small component. Tap to skip; auto-dismisses.
 * prefers-reduced-motion users get a simple fade (handled in CSS).
 */
export default function WelcomeOverlay() {
  const [name, setName] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const dismiss = useCallback(() => {
    setLeaving(true);
    setTimeout(() => { setName(null); setLeaving(false); }, 420);
  }, []);

  const play = useCallback((n: string) => { setLeaving(false); setName(n || ""); }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        sessionStorage.removeItem(KEY);
        const parsed = JSON.parse(raw) as { name?: string; at?: number };
        if (parsed && (!parsed.at || Date.now() - parsed.at < 15000)) play(parsed.name || "");
      }
    } catch { /* ignore */ }

    const onWelcome = (e: Event) => {
      // Consume any leftover one-shot flag so a hard reload right after a soft-nav
      // login can't replay the overlay a second time.
      try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
      play((e as CustomEvent).detail?.name || "");
    };
    window.addEventListener("nsa:welcome", onWelcome);
    return () => window.removeEventListener("nsa:welcome", onWelcome);
  }, [play]);

  useEffect(() => {
    if (name === null) return;
    const t = setTimeout(dismiss, 2200);
    return () => clearTimeout(t);
  }, [name, dismiss]);

  if (name === null) return null;
  const first = (name || "").trim().split(/\s+/)[0] || "";

  return (
    <div
      className={`nsa-welcome ${leaving ? "nsa-welcome--leaving" : ""}`}
      onClick={dismiss}
      role="status"
      aria-live="polite"
    >
      <div className="nsa-welcome__card">
        <div className="nsa-welcome__logo"><Logo size={64} /></div>
        <p className="nsa-welcome__hi">Welcome back{first ? "," : "!"}</p>
        {first && <p className="nsa-welcome__name">{first}</p>}
      </div>
    </div>
  );
}
