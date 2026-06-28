"use client";

import { useId, useState } from "react";
import { Info } from "lucide-react";

/**
 * Accessible metric tooltip. Shows an ⓘ icon that reveals two lines on hover,
 * keyboard focus, or tap (mobile). Line 1 = plain meaning, line 2 = exact formula.
 * Text comes from lib/analytics/metrics.ts so tooltips and the staff glossary
 * stay in sync from one source.
 */
export default function InfoTip({ meaning, formula, label }: { meaning: string; formula: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="relative inline-flex items-center align-middle">
      <button
        type="button"
        aria-label={label ? `About ${label}` : "About this metric"}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="ml-1 inline-grid h-4 w-4 place-items-center rounded-full text-muted/70 transition hover:text-primary focus:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Info size={13} />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-full z-50 mt-1.5 w-60 -translate-x-1/2 rounded-lg border border-line bg-surface p-2.5 text-left text-xs shadow-lg"
        >
          <span className="block font-semibold text-ink">{meaning}</span>
          <span className="mt-1 block text-muted">{formula}</span>
        </span>
      )}
    </span>
  );
}
