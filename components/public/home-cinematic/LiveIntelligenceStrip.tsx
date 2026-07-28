"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarClock, X } from "lucide-react";
import type { WhatsNewItem } from "@/lib/announcements";

/**
 * Live intelligence strip.
 *
 * DELIBERATE SCOPE: this does NOT replace or modify the existing
 * `GlobalAnnouncementBar`. That component is rendered inside `PublicNav` from the
 * shared `app/(site)/layout.tsx`, so it already appears above this page — and it
 * is also the subject of an in-flight `feature/global-announcement-bar` branch.
 * Touching it would both violate the additive-only rule and guarantee a merge
 * conflict. Instead this strip is a page-level companion that surfaces the
 * *session and batch* intelligence the slim ticker has no room for.
 *
 * It is fed by `getWhatsNew()` — the SAME live aggregator the announcement bar
 * uses — which excludes closed and expired items by construction, so there is no
 * way for a stale session to appear here.
 *
 * HONESTY: no countdown timers, no "only N left!" unless the row genuinely
 * carries a seat count, and no invented scarcity. Dismissal is remembered for the
 * browser session only, matching the announcement bar's behaviour.
 */
const DISMISS_KEY = "nsa_cinematic_strip_dismissed";

export interface LiveIntelligenceStripProps {
  items: WhatsNewItem[];
}

export default function LiveIntelligenceStrip({ items }: LiveIntelligenceStripProps) {
  // Server-render visible so there is zero layout shift for a fresh visitor;
  // only collapse after hydration if this session already dismissed it.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") setDismissed(true);
    } catch {
      /* ignore */
    }
  }, []);

  if (!items.length || dismissed) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }

  return (
    <div className="border-b border-white/10 bg-[rgba(6,16,42,0.92)]" role="region" aria-label="What is open right now">
      <div className="container-wide flex items-start gap-3 py-3 sm:items-center">
        <CalendarClock size={15} className="mt-0.5 shrink-0 text-[var(--ca-gold-bright)] sm:mt-0" aria-hidden="true" />

        {/* Horizontal scroll on mobile keeps this to one compact row and can never
            cause page-level horizontal overflow. */}
        <ul className="flex min-w-0 flex-1 gap-2 overflow-x-auto sm:gap-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.slice(0, 4).map((item) => (
            <li key={item.id} className="shrink-0">
              <Link
                href={item.href}
                className="ca-focus group inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/85 transition-colors hover:border-[var(--ca-gold)]/40 hover:text-white sm:text-[13px]"
              >
                <span className="shrink-0 font-semibold uppercase tracking-wide text-[var(--ca-gold-bright)]">
                  {item.label}
                </span>
                <span className="max-w-[46vw] truncate sm:max-w-[22rem]">{item.title}</span>
                {item.meta && <span className="hidden shrink-0 text-white/50 lg:inline">{item.meta}</span>}
                <ArrowRight
                  size={12}
                  className="shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss what is open now"
          className="ca-focus -mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-white/55 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
