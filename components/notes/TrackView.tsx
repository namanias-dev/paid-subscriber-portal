"use client";

import { useEffect } from "react";
import { trackClient } from "@/lib/analytics/client";
import type { EventName } from "@/lib/analytics/events";

/**
 * Fires a single PII-free view event on mount, so server-rendered store pages can
 * still emit funnel analytics through the existing `/api/track` beacon. Only pass
 * non-PII props (product/subject/price/kind) — never name, phone or address.
 */
export default function TrackView({ event, props }: { event: EventName; props?: Record<string, unknown> }) {
  useEffect(() => {
    trackClient(event, props || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
