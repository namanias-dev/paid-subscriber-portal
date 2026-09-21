"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { trackClient } from "@/lib/analytics/client";
import { offerDiscountLabel } from "@/lib/store/pricing";
import type { PublicStoreOffer } from "@/lib/store/offers";

function formatRemaining(ms: number): string {
  if (ms <= 0) return "Ended";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days >= 1) return `${days}d ${hours}h ${mins}m`;
  return `${String(hours).padStart(2, "0")} : ${String(mins).padStart(2, "0")} : ${String(secs).padStart(2, "0")}`;
}

export default function OfferBanner({ initial }: { initial: PublicStoreOffer | null }) {
  const [offer, setOffer] = useState(initial);
  const [now, setNow] = useState(() => (initial ? new Date(initial.server_now).getTime() : Date.now()));
  const viewed = useRef(false);

  useEffect(() => {
    if (!offer || viewed.current) return;
    viewed.current = true;
    trackClient("notes_offer_impression", { offer_id: offer.id, offer_slug: offer.slug });
  }, [offer]);

  useEffect(() => {
    if (!offer?.ends_at) return;
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    const end = new Date(offer.ends_at).getTime();
    const untilEnd = Math.max(250, end - Date.now() + 400);
    const expire = window.setTimeout(() => {
      fetch("/api/notes/offer", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (j.ok) setOffer(j.offer || null);
        })
        .catch(() => setOffer(null));
    }, Math.min(untilEnd, 2_147_000_000));
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(expire);
    };
  }, [offer?.ends_at, offer?.id]);

  if (!offer || offer.status !== "ACTIVE") return null;

  const remainingMs = offer.ends_at ? new Date(offer.ends_at).getTime() - now : null;
  const label = offerDiscountLabel(offer);
  const cap =
    offer.max_redemptions != null ? `First ${offer.max_redemptions.toLocaleString("en-IN")} orders` : null;

  return (
    <section className="ns-offer-strip" aria-label="Limited-time offer">
      <div className="container-wide">
        <div className="ns-offer-card">
          <div className="min-w-0">
            <p className="ns-offer-kicker">
              <Sparkles size={13} strokeWidth={1.75} aria-hidden="true" />
              {offer.banner_title || "Limited-time offer"}
            </p>
            <p className="mt-1 font-heading text-lg font-bold leading-snug text-white sm:text-xl">
              {offer.banner_subtitle || `${label} Naman Sir’s handwritten notes`}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-medium text-white/70">
              {cap && <span>{cap}</span>}
              {remainingMs != null && remainingMs > 0 && (
                <span>
                  Ends in{" "}
                  <span className="tabular-nums text-[var(--ca-gold-soft)]" aria-hidden="true">
                    {formatRemaining(remainingMs)}
                  </span>
                  <span className="sr-only">the configured campaign end time</span>
                </span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
            <span className="ns-offer-badge">{offer.badge_text || label}</span>
            <Link
              href="#catalogue"
              className="ca-focus ns-press inline-flex min-h-11 items-center rounded-full bg-[var(--ca-gold)] px-4 text-[13px] font-bold text-[#1a1304]"
              onClick={() => trackClient("notes_offer_cta_clicked", { offer_id: offer.id })}
            >
              Shop Notes →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
