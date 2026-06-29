"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isAppBusy } from "@/lib/appBusy";

/**
 * App-wide client self-healing (additive, invisible on the current version):
 *
 *  1. AUTO-REFRESH stale bundles — compares this client's baked-in build id with
 *     the live /api/version. If a newer deploy is live it reloads to the fresh
 *     bundle (deferred to a subtle banner if the user is mid-task, e.g. a quiz).
 *     Checked on mount, tab refocus, and a slow 5-min interval (no tight loop).
 *  2. CACHE PURGE — registers the root /sw.js worker that clears CacheStorage on
 *     activate so a returning device can't be pinned to an old cache.
 *  3. SESSION SELF-HEAL — if a session cookie is present but invalid (logged out
 *     elsewhere / bumped session_version / legacy cookie) it clears it cleanly.
 *     Valid sessions are never touched → no force-logout on deploy.
 *
 * Loop-guarded via sessionStorage so a misconfig can never cause a reload storm.
 */

const OWN_VERSION = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const MIN_GAP_MS = 30 * 1000;
const TRIED_KEY = "nsa_refresh_tried";
const HEAL_KEY = "nsa_heal_tried";

export default function ClientHealth() {
  const [updateReady, setUpdateReady] = useState(false);
  const lastCheck = useRef(0);
  const isDev = OWN_VERSION.startsWith("dev");

  const refresh = useCallback(() => {
    try {
      window.location.reload();
    } catch {
      /* ignore */
    }
  }, []);

  const checkVersion = useCallback(async () => {
    if (isDev) return;
    const now = Date.now();
    if (now - lastCheck.current < MIN_GAP_MS) return;
    lastCheck.current = now;
    try {
      const res = await fetch("/api/version", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { version?: string };
      const live = data.version || "";
      if (!live) return;

      if (live === OWN_VERSION) {
        try { sessionStorage.removeItem(TRIED_KEY); } catch { /* ignore */ }
        setUpdateReady(false);
        return;
      }

      // A newer build is live. If the user is mid-task, or we already tried a
      // reload for this exact version, surface the gentle banner instead.
      let alreadyTried = false;
      try { alreadyTried = sessionStorage.getItem(TRIED_KEY) === live; } catch { /* ignore */ }
      if (isAppBusy() || alreadyTried) {
        setUpdateReady(true);
        return;
      }
      try { sessionStorage.setItem(TRIED_KEY, live); } catch { /* ignore */ }
      refresh();
    } catch {
      /* offline / transient — try again next tick */
    }
  }, [isDev, refresh]);

  // Session self-heal (run once on mount).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/session/state", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { authenticated?: boolean; stale?: boolean };
        if (!data.stale) {
          try { sessionStorage.removeItem(HEAL_KEY); } catch { /* ignore */ }
          return;
        }
        // Token present but invalid → clear it once, then reload to the correct
        // (logged-out) state. Guarded so a cookie that refuses to clear can't loop.
        let healTried = false;
        try { healTried = !!sessionStorage.getItem(HEAL_KEY); } catch { /* ignore */ }
        if (healTried) return;
        try { sessionStorage.setItem(HEAL_KEY, "1"); } catch { /* ignore */ }
        await Promise.all([
          fetch("/api/portal/logout", { method: "POST" }).catch(() => {}),
          fetch("/api/admin/logout", { method: "POST" }).catch(() => {}),
        ]);
        if (!cancelled) refresh();
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [refresh]);

  // Version watch: mount + interval + tab refocus.
  useEffect(() => {
    if (isDev) return;
    checkVersion();
    const interval = setInterval(checkVersion, CHECK_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") checkVersion(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", checkVersion);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", checkVersion);
    };
  }, [isDev, checkVersion]);

  // Register the cache-purge service worker (best-effort).
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  if (!updateReady) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex justify-center px-3 pb-3 pointer-events-none">
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-line bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
        <span className="text-sm text-ink2">A new version of the app is available.</span>
        <button onClick={refresh} className="btn btn-primary ml-auto px-4 py-1.5 text-sm">
          Refresh
        </button>
      </div>
    </div>
  );
}
