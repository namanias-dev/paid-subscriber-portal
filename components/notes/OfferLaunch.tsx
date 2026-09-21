"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { trackClient } from "@/lib/analytics/client";
import { offerDiscountParts } from "@/lib/store/pricing";
import type { PublicStoreOffer } from "@/lib/store/offers";
import OfferCountdown from "./OfferCountdown";

export default function OfferLaunch({
  initial,
  qualifier,
}: {
  initial: PublicStoreOffer | null;
  qualifier?: string | null;
}) {
  const [offer, setOffer] = useState(initial);
  const viewed = useRef(false);
  const reduce = useReducedMotion();
  const frameRef = useRef<HTMLElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: frameRef,
    offset: ["start end", "end start"],
  });
  const glowX = useTransform(scrollYProgress, [0, 1], ["18%", "78%"]);

  useEffect(() => {
    if (!offer || viewed.current) return;
    viewed.current = true;
    trackClient("notes_offer_impression", { offer_id: offer.id, offer_slug: offer.slug });
  }, [offer]);

  const refresh = () => {
    fetch("/api/notes/offer", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setOffer(j.offer || null);
      })
      .catch(() => setOffer(null));
  };

  if (!offer || offer.status !== "ACTIVE") return null;

  const parts = offerDiscountParts(offer);
  const cap =
    offer.max_redemptions != null ? `First ${offer.max_redemptions.toLocaleString("en-IN")} Orders` : null;
  const productLine = "Naman Sir’s Handwritten UPSC Notes";
  const enter = (delay: number, y = 14) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, amount: 0.4 },
          transition: { duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <section ref={frameRef} className="ns-offer-launch" aria-label="Limited-time offer">
      <div className="container-wide">
        <div className="ns-offer-launch-frame">
          <motion.div className="ns-offer-launch-glow" style={reduce ? undefined : { backgroundPositionX: glowX }} aria-hidden="true" />
          <svg className="ns-offer-launch-motif" viewBox="0 0 640 360" aria-hidden="true">
            <path d="M72 48h360a18 18 0 0 1 18 18v248H90a18 18 0 0 1-18-18V48z" />
            <path d="M108 86h300M108 118h252M108 150h276M108 182h220" />
            <path className="ns-offer-launch-goldpath" d="M420 300c48-38 92-42 148-18" />
          </svg>

          <div className="ns-offer-launch-grid">
            <div className="min-w-0">
              <motion.p className="ns-offer-launch-kicker" {...enter(0.05, 8)}>
                {offer.banner_title || "Limited-time launch offer"}
              </motion.p>
              <motion.div className="ns-offer-mark" {...enter(0.14, 18)}>
                <span className="ns-offer-mark-value">{parts.value}</span>
                <span className="ns-offer-mark-off">{parts.suffix}</span>
              </motion.div>
              <motion.p className="ns-offer-launch-product" {...enter(0.28)}>
                {productLine}
              </motion.p>
              {qualifier && (
                <motion.p className="ns-offer-launch-qual" {...enter(0.36, 8)}>
                  {qualifier}
                </motion.p>
              )}
              {cap && (
                <motion.p className="ns-offer-launch-cap" {...enter(0.4, 8)}>
                  {cap}
                </motion.p>
              )}
            </div>

            <div className="ns-offer-launch-aside">
              {offer.ends_at && (
                <motion.div {...enter(0.46, 12)}>
                  <p className="ns-offer-launch-ends">Ends in</p>
                  <OfferCountdown endsAt={offer.ends_at} serverNow={offer.server_now} onEnded={refresh} />
                  <p className="sr-only">
                    Offer ends at {new Date(offer.ends_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                  </p>
                </motion.div>
              )}
              <motion.div {...enter(0.58, 10)}>
                <Link
                  href="#catalogue"
                  className="ca-focus ns-press ns-offer-launch-cta"
                  onClick={() => trackClient("notes_offer_cta_clicked", { offer_id: offer.id })}
                >
                  Shop Notes
                  <span aria-hidden="true"> →</span>
                </Link>
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
