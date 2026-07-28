"use client";

import { useEffect, useRef } from "react";
import { useCapability } from "./CapabilityProvider";
import { cinematic, depthEvent, track } from "./analytics";

/**
 * Page-level telemetry for the preview: one view event, one mode event once the
 * device tier resolves, and scroll-depth milestones.
 *
 * Each milestone fires at most once per mount, and the listener is passive so it
 * never contributes to INP. Depth is measured against scrollable height rather
 * than viewport count, so a short viewport on a tall page still reports 100%.
 */
export default function CinematicTelemetry() {
  const cap = useCapability();
  const viewSent = useRef(false);
  const modeSent = useRef(false);
  const fired = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (viewSent.current) return;
    viewSent.current = true;
    cinematic.view(cap.tier);
  }, [cap.tier]);

  // Once the real tier is known, report which experience the user actually got.
  useEffect(() => {
    if (!cap.resolved || modeSent.current) return;
    modeSent.current = true;
    if (cap.webgl) cinematic.modeLoaded(cap.tier, "webgl");
    else cinematic.fallbackUsed(cap.reason, cap.tier);
  }, [cap.resolved, cap.webgl, cap.tier, cap.reason]);

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;
      const pct = Math.min(100, Math.round(((window.scrollY || doc.scrollTop) / scrollable) * 100));
      for (const milestone of [25, 50, 75, 100] as const) {
        if (pct >= milestone && !fired.current.has(milestone)) {
          fired.current.add(milestone);
          track(depthEvent(milestone), {});
        }
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return null;
}
