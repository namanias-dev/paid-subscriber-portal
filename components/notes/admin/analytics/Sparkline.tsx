"use client";

import { motion, useReducedMotion } from "framer-motion";
import { sparklinePath } from "@/lib/analytics/notesVisuals";

/** Supplemental trend. The KPI number next to this remains the accessible value. */
export default function Sparkline({ points, label }: { points: Array<number | null>; label: string }) {
  const reduce = useReducedMotion();
  const path = sparklinePath(points);
  if (!path) return null;
  return (
    <svg viewBox="0 0 96 22" className="mt-1 h-[22px] w-full" role="img" aria-label={label}>
      <motion.path
        d={path}
        fill="none"
        stroke="#0a1a3f"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0, opacity: 0.35 }}
        animate={{ pathLength: 1, opacity: 0.8 }}
        transition={reduce ? { duration: 0 } : { duration: 0.45, ease: "easeOut" }}
      />
    </svg>
  );
}
