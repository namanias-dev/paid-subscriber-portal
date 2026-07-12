"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Megaphone, X, ArrowRight } from "lucide-react";
import type { WhatsNewItem } from "@/lib/announcements";
import { trackClient } from "@/lib/analytics/client";

const DISMISS_KEY = "nsa_whatsnew_dismissed";
const ROTATE_MS = 5000;

/**
 * Slim, dismissable announcement bar. Rotates through up to 5 items, each a
 * direct link. Dismissal is remembered for the session (sessionStorage). Fully
 * hidden when there are no items. Auto-rotation is disabled under
 * prefers-reduced-motion (crossfade only when motion is allowed).
 */
export default function AnnouncementBar({ items }: { items: WhatsNewItem[] }) {
  const [dismissed, setDismissed] = useState(true); // start hidden → avoids flash before we read session
  const [idx, setIdx] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
    if (typeof window !== "undefined" && window.matchMedia) {
      setReduceMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
  }, []);

  useEffect(() => {
    if (dismissed || reduceMotion || items.length <= 1) return;
    timer.current = setInterval(() => setIdx((i) => (i + 1) % items.length), ROTATE_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [dismissed, reduceMotion, items.length]);

  if (!items.length || dismissed) return null;

  const safeIdx = idx % items.length;
  const current = items[safeIdx];

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }

  const inner = (
    <span className="flex min-w-0 items-center gap-2">
      <span className="ca-badge ca-badge-gold shrink-0 !bg-white/15 !text-[var(--ca-gold-soft)] !border-white/20">{current.label}</span>
      <span className="truncate">{current.title}</span>
      <ArrowRight size={14} className="shrink-0 opacity-80 transition-transform group-hover:translate-x-0.5" />
    </span>
  );

  return (
    <div
      className="relative text-white"
      style={{ background: "linear-gradient(90deg, var(--ca-navy-900), var(--ca-navy-600))" }}
      role="region"
      aria-label="Latest updates"
    >
      <div className="container-wide flex items-center gap-3 py-2">
        <Megaphone size={16} className="hidden shrink-0 text-[var(--ca-gold-bright)] sm:block" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-sm font-medium">
          {current.external ? (
            <a
              href={current.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackClient("announcement_click", { kind: current.kind, item_id: current.id })}
              className="group inline-flex min-w-0 max-w-full items-center hover:text-[var(--ca-gold-soft)]"
            >
              {inner}
            </a>
          ) : (
            <Link
              href={current.href}
              onClick={() => trackClient("announcement_click", { kind: current.kind, item_id: current.id })}
              className="group inline-flex min-w-0 max-w-full items-center hover:text-[var(--ca-gold-soft)]"
            >
              {inner}
            </Link>
          )}
        </div>
        {items.length > 1 && (
          <div className="hidden items-center gap-1 sm:flex" aria-hidden="true">
            {items.map((_, i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 rounded-full transition"
                style={{ background: i === safeIdx ? "var(--ca-gold-bright)" : "rgba(255,255,255,0.35)" }}
              />
            ))}
          </div>
        )}
        <button
          onClick={dismiss}
          aria-label="Dismiss announcements"
          className="ca-focus shrink-0 rounded-md p-1 text-white/70 hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
