"use client";

import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { stageProgress, timelineFor } from "@/lib/store/opsBoard";
import type { FulfillmentMethod } from "@/lib/store/fulfillment";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/**
 * The canonical ladder for the order's method (nine delivery rungs, five Academy Pickup rungs). `fill` stretches connectors across the container (cards);
 * otherwise connectors are fixed width. Non-compact adds a label under every dot.
 */
export function FulfillmentTimeline({ status, method = "DELIVERY", compact = false, fill = false }: { status: string; method?: FulfillmentMethod; compact?: boolean; fill?: boolean }) {
  const reduce = useReducedMotion();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
  }, []);
  const stage = stageProgress(status, method);
  const TIMELINE = timelineFor(method);
  if (!stage) return null;
  const current = stage.index;
  const dot = compact ? "h-2 w-2" : "h-2.5 w-2.5";
  return (
    <div role="img" aria-label={stage.ariaLabel} className={fill ? "flex w-full min-w-0" : "inline-flex"}>
      <ol aria-hidden className={`flex ${compact ? "items-center" : "items-start"} ${fill ? "w-full min-w-0" : ""}`}>
        {TIMELINE.map((step, index) => {
          const done = index < current;
          const active = index === current;
          const last = index === TIMELINE.length - 1;
          return (
            <li key={step.key} className={`flex ${compact ? "items-center" : "items-start"} ${fill && !last ? "min-w-0 flex-1" : ""}`} title={step.label}>
              <span className="flex flex-col items-center gap-1">
                <span className={`relative block ${dot}`}>
                  {active && !stage.final && (
                    <motion.span
                      className="absolute -inset-[3px] rounded-full bg-[rgba(154,123,47,0.24)]"
                      animate={reduce ? { scale: 1, opacity: 0.7 } : { scale: [1, 1.08, 1], opacity: [0.5, 1, 0.5] }}
                      transition={reduce ? { duration: 0 } : { duration: 2.8, ease: "easeInOut", repeat: Infinity }}
                    />
                  )}
                  <span
                    className={`absolute inset-0 rounded-full border transition-colors duration-300 motion-reduce:transition-none ${
                      active && stage.final
                        ? "border-emerald-700 bg-emerald-700"
                        : done
                          ? "border-[var(--ca-navy)] bg-[var(--ca-navy)]"
                          : active
                            ? "border-[var(--ca-gold-dark)] bg-[var(--ca-gold-dark)]"
                            : "border-ca-navy/25 bg-white"
                    }`}
                  />
                </span>
                {!compact && (
                  <span className={`max-w-[4.5rem] text-center text-[10px] leading-tight ${active ? "font-semibold text-[var(--ca-navy)]" : "text-ca-navy/45"}`}>
                    {done ? `✓ ${step.label}` : step.label}
                  </span>
                )}
              </span>
              {!last && (
                <span
                  className={`relative mx-[3px] block h-[2px] overflow-hidden rounded-full bg-ca-navy/10 ${compact ? "" : "mt-1"} ${
                    fill ? "min-w-[6px] flex-1" : compact ? "w-3" : "w-4"
                  }`}
                >
                  <motion.span
                    className="absolute inset-0 origin-left rounded-full bg-ca-navy/55"
                    initial={reduce ? false : { scaleX: 0 }}
                    animate={{ scaleX: done ? 1 : 0 }}
                    transition={reduce ? { duration: 0 } : { duration: 0.45, ease: EASE_OUT, delay: mounted.current ? 0 : index * 0.04 }}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
