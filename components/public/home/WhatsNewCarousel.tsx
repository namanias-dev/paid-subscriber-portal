"use client";

/**
 * "What's New" items renderer.
 *
 *  • Desktop (sm+): the familiar premium 3-up card grid — all items, all links.
 *  • Mobile (<sm): a single-card auto-rotating TICKER that crossfades between
 *    items. Fixed grid-stack layout (all cards share one cell) so switching
 *    NEVER shifts layout or overflows horizontally. Pauses on hover/focus,
 *    respects prefers-reduced-motion (no auto-advance; manual dots remain),
 *    and every visible card is a working direct link.
 *
 * Cards are fully readable at small viewports: labels wrap, titles are NOT
 * clamped (no hidden meaning), an optional date/meta line shows, and a clear
 * "View" CTA gives a large tap target.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Video, GraduationCap, BookOpen, FileDown, Megaphone, ArrowRight, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import type { WhatsNewItem, WhatsNewKind } from "@/lib/announcements";
import { Stagger, StaggerItem } from "@/components/ui/Reveal";

const KIND_ICON: Record<WhatsNewKind, LucideIcon> = {
  webinar: Video,
  batch: GraduationCap,
  article: BookOpen,
  download: FileDown,
  pinned: Megaphone,
};

const ROTATE_MS = 4500;

function CardInner({ item }: { item: WhatsNewItem }) {
  const Icon = KIND_ICON[item.kind] || Sparkles;
  return (
    <div className="card card-hover flex h-full items-start gap-3 p-4 sm:p-5">
      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--primary-tint)] text-[var(--primary)]">
        <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <span className="pill pill-blue mb-1.5 inline-block max-w-full text-[11px] leading-snug">{item.label}</span>
        <h3 className="text-base font-semibold leading-snug text-ink [overflow-wrap:anywhere]">{item.title}</h3>
        {item.meta && <p className="mt-1 text-xs text-ink2 [overflow-wrap:anywhere]">{item.meta}</p>}
        <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-[var(--primary)]">
          View
          <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

function CardLink({ item, active = true }: { item: WhatsNewItem; active?: boolean }) {
  const cls = "group block h-full";
  const tabIndex = active ? undefined : -1;
  return item.external ? (
    <a
      href={item.href}
      target="_blank"
      rel="noopener noreferrer"
      className={cls}
      tabIndex={tabIndex}
      aria-hidden={active ? undefined : true}
    >
      <CardInner item={item} />
    </a>
  ) : (
    <Link href={item.href} className={cls} tabIndex={tabIndex} aria-hidden={active ? undefined : true}>
      <CardInner item={item} />
    </Link>
  );
}

export default function WhatsNewCarousel({ items }: { items: WhatsNewItem[] }) {
  const reduce = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (reduce || paused || items.length <= 1) return;
    timer.current = setInterval(() => setIdx((i) => (i + 1) % items.length), ROTATE_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [reduce, paused, items.length]);

  if (items.length === 0) return null;

  const safe = ((idx % items.length) + items.length) % items.length;
  const go = (n: number) => setIdx(((n % items.length) + items.length) % items.length);

  return (
    <>
      {/* Mobile: auto-rotating crossfade ticker (fixed stack — no layout shift) */}
      <div
        className="mt-6 sm:hidden"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
        onTouchStart={() => setPaused(true)}
        aria-roledescription="carousel"
        aria-label="What's new highlights"
      >
        <div className="grid">
          {items.map((it, i) => (
            <div
              key={it.id}
              className={`col-start-1 row-start-1 transition-opacity duration-500 motion-reduce:transition-none ${
                i === safe ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
              aria-hidden={i === safe ? undefined : true}
            >
              <CardLink item={it} active={i === safe} />
            </div>
          ))}
        </div>

        {items.length > 1 && (
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => go(safe - 1)}
              aria-label="Previous update"
              className="ca-focus flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink2 hover:text-ink"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="flex items-center gap-1.5" role="tablist" aria-label="Select update">
              {items.map((it, i) => (
                <button
                  key={it.id}
                  type="button"
                  role="tab"
                  aria-selected={i === safe}
                  aria-label={`Update ${i + 1} of ${items.length}`}
                  onClick={() => go(i)}
                  className={`h-2 rounded-full transition-all ${
                    i === safe ? "w-5 bg-[var(--primary)]" : "w-2 bg-[var(--line-strong,#d4dae6)]"
                  }`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => go(safe + 1)}
              aria-label="Next update"
              className="ca-focus flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink2 hover:text-ink"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>

      {/* Desktop: full premium grid — all items, all links */}
      <Stagger className="mt-8 hidden gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <StaggerItem key={it.id} className="h-full">
            <CardLink item={it} />
          </StaggerItem>
        ))}
      </Stagger>
    </>
  );
}
