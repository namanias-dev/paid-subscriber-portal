"use client";

import Link from "next/link";

/**
 * Fixed bottom CTA bar (mobile only). Single full-width primary action with
 * price in the label — no secondary WhatsApp in the bar.
 */
export default function StickyMobileCTA({
  ctaLabel,
  ctaHref,
  trustLine = "Live + recording • Certificate • Secure UPI payment",
}: {
  ctaLabel: string;
  ctaHref: string;
  trustLine?: string;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 px-4 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur lg:hidden">
      <Link
        href={ctaHref}
        className="webinar-sticky-cta relative flex w-full items-center justify-center overflow-hidden rounded-xl px-4 py-3.5 text-center text-[15px] font-bold text-white shadow-[0_8px_24px_-8px_rgba(10,26,63,0.55)] transition-transform active:scale-[0.98] motion-reduce:transition-none"
        style={{
          background: "linear-gradient(105deg, #0a1a3f 0%, #1e3a8a 48%, #2563eb 100%)",
        }}
      >
        <span
          className="pointer-events-none absolute inset-y-0 w-1/3 animate-[webinarCtaSheen_3s_ease-in-out_infinite] motion-reduce:hidden"
          style={{
            background:
              "linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.18) 45%, transparent 70%)",
          }}
          aria-hidden="true"
        />
        <span className="relative z-10">{ctaLabel}</span>
      </Link>
      {trustLine ? (
        <p className="mt-1.5 text-center text-[11px] leading-snug text-muted">{trustLine}</p>
      ) : null}
    </div>
  );
}
