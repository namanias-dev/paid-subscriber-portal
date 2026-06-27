"use client";

import { useCallback, useEffect, useState } from "react";
import Logo from "@/components/ui/Logo";

const KEY = "nsa_welcome";

type Variant = "welcome" | "farewell";
type OverlayData = { variant: Variant; name: string };

/**
 * Premium login/logout transition overlay. Plays on:
 *  - EVERY successful login (welcome): login forms set a one-shot sessionStorage
 *    flag AND dispatch `nsa:welcome` (flag covers a hard reload; event covers soft
 *    navigation).
 *  - EVERY confirmed logout (farewell): LogoutFlow dispatches `nsa:welcome` with
 *    variant "farewell" and waits for `nsa:overlay-done` before navigating.
 * Pure CSS transforms/opacity (GPU-accelerated) — no framer-motion / WebGL.
 * Tap to skip; auto-dismisses; prefers-reduced-motion users get a simple fade.
 */
export default function WelcomeOverlay() {
  const [data, setData] = useState<OverlayData | null>(null);
  const [leaving, setLeaving] = useState(false);

  const dismiss = useCallback(() => {
    setLeaving(true);
    setTimeout(() => {
      setData(null);
      setLeaving(false);
      // Signal completion so a waiting logout flow can finish navigating.
      try { window.dispatchEvent(new CustomEvent("nsa:overlay-done")); } catch { /* ignore */ }
    }, 420);
  }, []);

  const play = useCallback((d: OverlayData) => { setLeaving(false); setData(d); }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        sessionStorage.removeItem(KEY);
        const parsed = JSON.parse(raw) as { name?: string; at?: number };
        if (parsed && (!parsed.at || Date.now() - parsed.at < 15000)) {
          play({ variant: "welcome", name: parsed.name || "" });
        }
      }
    } catch { /* ignore */ }

    const onWelcome = (e: Event) => {
      // Consume any leftover one-shot flag so a hard reload right after a soft-nav
      // login can't replay the overlay a second time.
      try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
      const detail = (e as CustomEvent).detail || {};
      play({ variant: detail.variant === "farewell" ? "farewell" : "welcome", name: detail.name || "" });
    };
    window.addEventListener("nsa:welcome", onWelcome);
    return () => window.removeEventListener("nsa:welcome", onWelcome);
  }, [play]);

  useEffect(() => {
    if (data === null) return;
    const t = setTimeout(dismiss, 2200);
    return () => clearTimeout(t);
  }, [data, dismiss]);

  if (data === null) return null;

  const isFarewell = data.variant === "farewell";
  const first = (data.name || "").trim().split(/\s+/)[0] || "";

  return (
    <div
      className={`nsa-welcome ${leaving ? "nsa-welcome--leaving" : ""}`}
      onClick={dismiss}
      role="status"
      aria-live="polite"
    >
      <div className="nsa-welcome__card">
        <div className="nsa-welcome__logo"><Logo size={64} /></div>
        {isFarewell ? (
          <>
            <p className="nsa-welcome__hi">Signing out</p>
            <p className="nsa-welcome__name" style={{ maxWidth: "min(90vw, 16ch)", marginInline: "auto" }}>
              See you again, future officer 👋
            </p>
          </>
        ) : (
          <>
            <p className="nsa-welcome__hi">Welcome back{first ? "," : "!"}</p>
            {first && <p className="nsa-welcome__name">{first}</p>}
          </>
        )}
      </div>
    </div>
  );
}
