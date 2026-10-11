"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { trackClient } from "@/lib/analytics/client";
import {
  isModernHistoryLaunchOffer,
  modernHistoryLaunchPriceLabel,
  MODERN_HISTORY_LAUNCH_CAP,
} from "@/lib/store/modernHistoryLaunch";
import { notesProductPath } from "@/lib/store/paths";
import type { PublicStoreOffer } from "@/lib/store/offers";

export default function ModernHistoryLaunch({ initial }: { initial: PublicStoreOffer | null }) {
  const [offer, setOffer] = useState(initial);
  const viewed = useRef(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!offer || viewed.current || !isModernHistoryLaunchOffer(offer) || offer.status !== "ACTIVE") return;
    viewed.current = true;
    trackClient("notes_offer_impression", { offer_id: offer.id, offer_slug: offer.slug, subject: "modern-history" });
  }, [offer]);

  useEffect(() => {
    if (!isModernHistoryLaunchOffer(initial) || initial?.status !== "ACTIVE") return;
    const refresh = () => {
      fetch("/api/notes/offer", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (j.ok) setOffer(j.offer || null);
        })
        .catch(() => {});
    };
    const t = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(t);
  }, [initial]);

  if (!offer || offer.status !== "ACTIVE" || !isModernHistoryLaunchOffer(offer)) return null;

  const enter = (delay: number, y = 14) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, amount: 0.35 },
          transition: { duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <section className="ns-offer-launch" aria-label="Modern History notes launch">
      <div className="container-wide">
        <div className="ns-offer-launch-frame ns-mh-launch-frame">
          <div className="ns-offer-launch-glow" aria-hidden="true" />
          <div className="ns-mh-launch-grid">
            <div className="min-w-0">
              <motion.p className="ns-offer-launch-kicker" {...enter(0.04, 8)}>
                New release
              </motion.p>
              <motion.h2 className="ns-mh-launch-title" {...enter(0.12, 16)}>
                Modern History Notes Are Now Available
              </motion.h2>
              <motion.p className="ns-mh-launch-copy" {...enter(0.22)}>
                Naman Sir’s handwritten Modern History notes for UPSC Prelims + Mains — structured
                around chronology, movements, personalities, Acts and the evolution of India’s
                freedom struggle.
              </motion.p>
              <motion.p className="ns-mh-launch-price" {...enter(0.32, 8)}>
                Launch Price {modernHistoryLaunchPriceLabel()} for the first {MODERN_HISTORY_LAUNCH_CAP} paid
                orders.
              </motion.p>
            </div>
            <motion.div className="ns-mh-launch-aside" {...enter(0.4, 10)}>
              <Link
                href={notesProductPath("modern-history")}
                className="ca-focus ns-press ns-offer-launch-cta"
                onClick={() =>
                  trackClient("notes_offer_cta_clicked", {
                    offer_id: offer.id,
                    subject: "modern-history",
                    cta_id: "explore_modern_history",
                  })
                }
              >
                Explore Modern History Notes
                <span aria-hidden="true"> →</span>
              </Link>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
