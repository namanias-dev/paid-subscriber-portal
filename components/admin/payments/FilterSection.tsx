"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Collapsible filter section used by the v2 Payments filters redesign. Renders
 * a header row with the section title, an active-filter count badge, and a
 * chevron; content is animated open/closed with a subtle height-safe transition
 * that respects `prefers-reduced-motion` (the `transition-transform` on the
 * chevron and `transition-[max-height]` on the panel both no-op under it).
 *
 * Presentational only — parent owns the filter state so the URL round-trip
 * stays authoritative. Reused for Status, Payment type, Date, Source.
 */
export default function FilterSection({
  title,
  activeCount = 0,
  defaultOpen = false,
  children,
}: {
  title: string;
  activeCount?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const headerId = `filter-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`${headerId}-panel`}
        id={headerId}
        className="flex w-full items-center gap-3 py-3 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-ink">{title}</span>
        {activeCount > 0 && (
          <span
            aria-label={`${activeCount} active`}
            className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary"
          >
            {activeCount}
          </span>
        )}
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`ml-auto shrink-0 text-ink2 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        id={`${headerId}-panel`}
        role="region"
        aria-labelledby={headerId}
        hidden={!open}
        className={open ? "pb-4" : ""}
      >
        {open && children}
      </div>
    </section>
  );
}
