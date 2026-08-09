"use client";

import { useEffect } from "react";

/** Fire-and-forget view bump — keeps the article RSC free of no-store writes. */
export default function CaViewBeacon({ id }: { id: string }) {
  useEffect(() => {
    if (!id) return;
    void fetch("/api/public/ca/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
      keepalive: true,
    }).catch(() => {});
  }, [id]);
  return null;
}
