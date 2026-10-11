"use client";

import { offerDiscountParts } from "@/lib/store/pricing";
import type { PublicStoreOffer } from "@/lib/store/offers";
import {
  isModernHistoryLaunchOffer,
  modernHistoryLaunchCaption,
  modernHistoryLaunchPriceLabel,
} from "@/lib/store/modernHistoryLaunch";
import OfferCountdown from "./OfferCountdown";

export default function PdpOfferChip({
  offer,
  onEnded,
}: {
  offer: PublicStoreOffer;
  onEnded?: () => void;
}) {
  const parts = offerDiscountParts(offer);
  const launch = isModernHistoryLaunchOffer(offer);
  const cap = launch
    ? modernHistoryLaunchCaption()
    : offer.max_redemptions != null
      ? `First ${offer.max_redemptions.toLocaleString("en-IN")} orders`
      : null;

  return (
    <div className="ns-pdp-offer">
      <p className="ns-pdp-offer-kicker">{offer.banner_title || (launch ? "New release" : "Limited-time launch offer")}</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <p className="font-heading text-2xl font-extrabold tracking-tight text-[var(--ca-gold-soft)]">
          {launch ? `Launch Price ${modernHistoryLaunchPriceLabel()}` : parts.label}
        </p>
        {cap && <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">{cap}</p>}
      </div>
      {offer.ends_at && (
        <div className="mt-3">
          <OfferCountdown endsAt={offer.ends_at} serverNow={offer.server_now} compact onEnded={onEnded} />
          <p className="sr-only">
            Offer ends at {new Date(offer.ends_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
          </p>
        </div>
      )}
    </div>
  );
}
