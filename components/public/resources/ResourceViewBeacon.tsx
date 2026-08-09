"use client";

import { useEffect } from "react";

/** Fire-and-forget view bump for resource articles (ISR-safe). */
export default function ResourceViewBeacon({ id }: { id: string }) {
  useEffect(() => {
    if (!id) return;
    void fetch("/api/public/resources/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
      keepalive: true,
    }).catch(() => {});
  }, [id]);
  return null;
}
