"use client";

import { useEffect } from "react";

function sendViewBeacon(url: string, id: string) {
  const payload = JSON.stringify({ id });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }
  } catch {
    /* fall through */
  }
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}

/** Fire-and-forget view bump for resource articles (ISR-safe). */
export default function ResourceViewBeacon({ id }: { id: string }) {
  useEffect(() => {
    if (!id) return;
    sendViewBeacon("/api/public/resources/view", id);
  }, [id]);
  return null;
}
