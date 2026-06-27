"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { triggerFarewell } from "@/lib/welcome";

type Req = { endpoint: string; dest: string };

/**
 * Global logout flow (mounted once in the root layout). On a `nsa:logout-request`
 * event it shows a premium confirmation; on confirm it:
 *   1) fires the logout POST immediately (clears cookies + bumps session version —
 *      session invalidation is NEVER delayed by the animation),
 *   2) plays the FAREWELL overlay (reusing WelcomeOverlay), and
 *   3) hard-navigates once both the animation and the logout request settle (the
 *      request is capped so a slow network can't strand the user).
 * Triggers dispatch via requestLogout() in lib/welcome.ts.
 */
export default function LogoutFlow() {
  const [req, setReq] = useState<Req | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onReq = (e: Event) => {
      const d = (e as CustomEvent).detail as Req | undefined;
      if (d?.endpoint && d?.dest) { setBusy(false); setReq(d); }
    };
    window.addEventListener("nsa:logout-request", onReq);
    return () => window.removeEventListener("nsa:logout-request", onReq);
  }, []);

  useEffect(() => {
    if (req) cancelRef.current?.focus();
  }, [req]);

  const cancel = useCallback(() => { if (!busy) setReq(null); }, [busy]);

  const confirm = useCallback(async () => {
    if (!req || busy) return;
    setBusy(true);
    // 1) Fire the true logout immediately (don't wait on the animation), capped so
    //    a hung request can't strand the user on a logged-in page.
    const logoutDone = Promise.race([
      fetch(req.endpoint, { method: "POST" }).then(() => undefined).catch(() => undefined),
      new Promise<void>((r) => setTimeout(r, 4000)),
    ]);
    // 2) Play the farewell (resolves on skip / auto-dismiss / reduced-motion / 3s cap).
    await triggerFarewell();
    // 3) Ensure cookies are cleared, then hard-navigate (drops client router cache).
    await logoutDone;
    window.location.replace(req.dest);
  }, [req, busy]);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
      else if (e.key === "Enter") confirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req, cancel, confirm]);

  if (!req) return null;

  return (
    <div
      className="nsa-logout-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nsa-logout-title"
      onClick={cancel}
    >
      <div className="nsa-logout-card" onClick={(e) => e.stopPropagation()}>
        <div className="nsa-logout-icon" aria-hidden="true">👋</div>
        <h2 id="nsa-logout-title" className="nsa-logout-title">Log out?</h2>
        <p className="nsa-logout-sub">You&apos;ll need your phone &amp; login code to sign back in.</p>
        <div className="nsa-logout-actions">
          <button ref={cancelRef} type="button" onClick={cancel} disabled={busy} className="btn btn-secondary flex-1">
            Cancel
          </button>
          <button type="button" onClick={confirm} disabled={busy} className="btn btn-primary flex-1">
            {busy ? "Logging out…" : "Yes, log out"}
          </button>
        </div>
      </div>
    </div>
  );
}
