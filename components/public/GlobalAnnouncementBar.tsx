"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Megaphone, X, ArrowRight } from "lucide-react";
import type { WhatsNewItem } from "@/lib/announcements";
import { trackClient } from "@/lib/analytics/client";

const DISMISS_KEY = "nsa_whatsnew_dismissed";
const ROTATE_MS = 5000;

/**
 * GlobalAnnouncementBar — the slim, premium "What's New" ticker rendered INSIDE
 * the sticky public {@link PublicNav} header, directly beneath the logo + nav row.
 * Because it lives in the same sticky, in-flow header block it stays pinned right
 * under the nav on every public page, never overlaps page content (content
 * naturally starts below it), and cleanly reclaims its space when dismissed
 * (the whole component collapses to null and the header reflows).
 *
 * Behaviour (reuses the homepage AnnouncementBar logic it replaces):
 *   • Crossfades through up to 5 auto-sourced items (grid-stack → zero layout
 *     shift, no horizontal overflow — every item is a single truncated line).
 *   • Auto-rotates, pausing on hover/focus; each item is a direct link.
 *   • prefers-reduced-motion → no auto-advance + no crossfade transition
 *     (static first item; dots still allow manual navigation).
 *   • Dismissable, suppressed for the browser session (sessionStorage);
 *     re-shows next session. Renders nothing when there are no items.
 */
export default function GlobalAnnouncementBar({ items }: { items: WhatsNewItem[] }) {
  // Render on the server (dismissed=false) so fresh visitors get zero layout
  // shift; only hide post-hydration if this session was already dismissed.
  const [dismissed, setDismissed] = useState(false);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") setDismissed(true);
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined" && window.matchMedia) {
      setReduceMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
  }, []);

  useEffect(() => {
    if (dismissed || paused || reduceMotion || items.length <= 1) return;
    timer.current = setInterval(() => setIdx((i) => (i + 1) % items.length), ROTATE_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [dismissed, paused, reduceMotion, items.length]);

  if (!items.length || dismissed) return null;

  const safe = ((idx % items.length) + items.length) % items.length;

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }

  const ItemLink = ({ item, active }: { item: WhatsNewItem; active: boolean }) => {
    const inner = (
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 rounded-full border border-[var(--ca-gold-bright)]/30 bg-[var(--ca-gold-bright)]/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ca-gold-bright)]">
          {item.label}
        </span>
        <span className="truncate">{item.title}</span>
        <ArrowRight size={13} className="shrink-0 opacity-70 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    );
    const cls = "ca-focus group inline-flex min-w-0 max-w-full items-center rounded-sm text-white/90 transition-colors hover:text-[var(--ca-gold-bright)]";
    const onClick = () => trackClient("announcement_click", { kind: item.kind, item_id: item.id });
    const tabIndex = active ? undefined : -1;
    return item.external ? (
      <a href={item.href} target="_blank" rel="noopener noreferrer" onClick={onClick} className={cls} tabIndex={tabIndex} aria-hidden={active ? undefined : true}>
        {inner}
      </a>
    ) : (
      <Link href={item.href} onClick={onClick} className={cls} tabIndex={tabIndex} aria-hidden={active ? undefined : true}>
        {inner}
      </Link>
    );
  };

  return (
    <div
      className="relative border-t border-white/10 bg-[rgba(6,16,42,0.55)]"
      role="region"
      aria-label="Latest updates"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="container-wide flex items-center gap-2.5 py-1.5 sm:gap-3">
        <Megaphone size={14} className="hidden shrink-0 text-[var(--ca-gold-bright)] sm:block" aria-hidden="true" />

        {/* Grid-stack crossfade: all items share one cell → no layout shift. */}
        <div className="grid min-w-0 flex-1 text-[13px] font-medium leading-tight sm:text-sm">
          {items.map((it, i) => (
            <div
              key={it.id}
              className={`col-start-1 row-start-1 min-w-0 transition-opacity duration-500 motion-reduce:transition-none ${
                i === safe ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <ItemLink item={it} active={i === safe} />
            </div>
          ))}
        </div>

        {items.length > 1 && (
          <div className="hidden items-center gap-1 sm:flex" role="tablist" aria-label="Select update">
            {items.map((it, i) => (
              <button
                key={it.id}
                type="button"
                role="tab"
                aria-selected={i === safe}
                aria-label={`Update ${i + 1} of ${items.length}`}
                onClick={() => setIdx(i)}
                className={`ca-focus h-1.5 rounded-full transition-all ${
                  i === safe ? "w-4 bg-[var(--ca-gold-bright)]" : "w-1.5 bg-white/30 hover:bg-white/50"
                }`}
              />
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss announcements"
          className="ca-focus -mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
