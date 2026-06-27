"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export interface PromoItem {
  kind: "webinar" | "course";
  title: string;
  href: string;
  subtitle?: string;
}

const DISMISS_KEY = "nsa_promo_dismissed";
const ROTATE_MS = 6000;

/**
 * Lightweight, dismissible, rotating marketing banner for LEADS / free users.
 * Advertises upcoming PAID webinars & courses with an Enroll CTA. Purely
 * promotional — it links to public marketing/checkout pages and never exposes any
 * paid material. Dismissal is remembered for the browser session.
 */
export default function LeadPromoBanner({ items }: { items: PromoItem[] }) {
  const [dismissed, setDismissed] = useState(true);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  useEffect(() => {
    if (dismissed || items.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [dismissed, items.length]);

  if (dismissed || items.length === 0) return null;
  const item = items[idx % items.length];

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-blue-50">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0 flex items-center gap-3">
          <span className="text-2xl">{item.kind === "webinar" ? "🎥" : "🎓"}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="pill pill-gold text-[11px]">{item.kind === "webinar" ? "Upcoming webinar" : "Featured course"}</span>
              {items.length > 1 && (
                <span className="text-[10px] text-muted">{idx % items.length + 1}/{items.length}</span>
              )}
            </div>
            <p className="mt-1 truncate text-sm font-bold text-ink">{item.title}</p>
            {item.subtitle && <p className="truncate text-xs text-ink2">{item.subtitle}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href={item.href} className="btn btn-primary text-sm">Enroll →</Link>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-black/5 hover:text-ink"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
