"use client";

/**
 * A single live-offer card (course or webinar) rendered inside the chat. All data
 * is server-sourced via the offer resolver — this component never invents prices,
 * dates or seats. The primary CTA links to the real public offer page.
 */
import type { OfferCardData } from "@/lib/ai-agent/providers/types";

function formatPrice(price: number): string {
  if (!price || price <= 0) return "Free";
  try {
    return `₹${price.toLocaleString("en-IN")}`;
  } catch {
    return `₹${price}`;
  }
}

export default function OfferRecommendationCard({
  offer,
  onCta,
}: {
  offer: OfferCardData;
  onCta: (offer: OfferCardData) => void;
}) {
  return (
    <div className="rounded-2xl border border-line bg-white p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ background: "var(--primary-tint)", color: "var(--primary)" }}
        >
          {offer.type === "webinar" ? "Masterclass" : "Course"}
        </span>
        <span className="text-sm font-bold tabular-nums" style={{ color: "var(--gold, #b8860b)" }}>
          {formatPrice(offer.price)}
        </span>
      </div>

      <h4 className="mt-2 font-heading text-sm font-bold leading-snug text-ink">{offer.title}</h4>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink2">
        {offer.mode && <span>{offer.mode}</span>}
        {offer.duration && <span>{offer.duration}</span>}
      </div>

      {offer.description && (
        <p className="mt-1.5 line-clamp-2 text-xs text-ink2">{offer.description}</p>
      )}

      {offer.bestFor.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {offer.bestFor.slice(0, 3).map((t) => (
            <span key={t} className="rounded-md bg-surface px-1.5 py-0.5 text-[10px] text-muted">
              {t}
            </span>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => onCta(offer)}
        className="btn btn-primary mt-3 h-9 w-full min-h-0 text-xs"
      >
        {offer.ctaLabel}
      </button>
    </div>
  );
}
