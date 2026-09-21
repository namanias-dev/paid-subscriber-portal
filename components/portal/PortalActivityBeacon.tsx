"use client";

import { useEffect } from "react";

/**
 * Asks the server to record one portal_active event per browser per IST day.
 * The server dedupes by student, so this is not a login and not a page-view counter.
 */
export default function PortalActivityBeacon({ surface }: { surface: "portal" | "dashboard" }) {
  useEffect(() => {
    const ymd = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const key = `nsa_portal_active:${surface}`;
    try {
      if (window.localStorage.getItem(key) === ymd) return;
    } catch {
      /* private mode — still try once; the server dedupes */
    }
    void fetch("/api/portal/activity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ surface }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as { skipped?: string } | null;
        if (data?.skipped === "anon") return;
        try {
          window.localStorage.setItem(key, ymd);
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
  }, [surface]);
  return null;
}
