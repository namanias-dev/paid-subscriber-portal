"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { TrackStepId } from "@/lib/store/trackingView";
import type { PickupStepId } from "@/lib/store/pickupTracking";

/** Small vector for the current customer stage. Completed and future stages stay still. */
export function StageArt({ step, active }: { step: TrackStepId | PickupStepId; active: boolean }) {
  const reduce = useReducedMotion();
  const loop = active && !reduce;
  return (
    <svg viewBox="0 0 72 48" className="h-12 w-16 shrink-0 text-[var(--ca-navy)]" aria-hidden>
      {step === "confirmed" && <path d="M18 14h28v22H18z" fill="none" stroke="currentColor" strokeWidth="1.5" />}
      {step === "preparing" && (
        <>
          <motion.rect x="16" y="16" width="28" height="3" fill="currentColor" animate={loop ? { y: [18, 16, 18] } : undefined} transition={{ duration: 2.4, repeat: Infinity }} />
          <motion.rect x="18" y="22" width="28" height="3" fill="currentColor" opacity="0.7" animate={loop ? { y: [20, 22, 20] } : undefined} transition={{ duration: 2.4, repeat: Infinity }} />
          <rect x="20" y="28" width="28" height="3" fill="currentColor" opacity="0.4" />
        </>
      )}
      {step === "printing" && (
        <>
          <path d="M14 18h36v12H14z" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <motion.rect x="22" width="20" height="8" fill="var(--ca-gold)" animate={loop ? { y: [10, 28] } : { y: 18 }} transition={{ duration: 2.8, repeat: Infinity, repeatDelay: 0.6 }} />
        </>
      )}
      {(step === "packed" || step === "ready") && <path d="M16 20h32l-4 14H20z" fill="none" stroke="currentColor" strokeWidth="1.5" />}
      {step === "ready" && <circle cx="56" cy="14" r="3" fill="none" stroke="var(--ca-gold-dark)" />}
      {(step === "pickup" || step === "shipped" || step === "in_transit" || step === "out_for_delivery") && (
        <motion.g animate={loop && (step === "shipped" || step === "in_transit") ? { x: [0, 10, 0] } : undefined} transition={{ duration: 3.2, repeat: Infinity }}>
          <path d="M8 28h28l6-8h10v8h4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="18" cy="32" r="2" fill="currentColor" />
          <circle cx="40" cy="32" r="2" fill="currentColor" />
        </motion.g>
      )}
      {step === "out_for_delivery" && <circle cx="58" cy="16" r="3" fill="none" stroke="var(--ca-gold-dark)" />}
      {(step === "delivered" || step === "collected") && <path d="M24 26l6 6 14-16" fill="none" stroke="currentColor" strokeWidth="1.8" />}
    </svg>
  );
}
