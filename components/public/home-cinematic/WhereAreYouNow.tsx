"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import type { LiveOffer } from "@/lib/homeCinematic/offers";
import { rupees } from "@/lib/homeCinematic/offers";
import { STARTING_POINTS } from "./content";
import { cinematic } from "./analytics";
import TrackedLink from "./TrackedLink";

/**
 * "Where are you now?" — a six-option selector that recommends a real, currently
 * bookable offer.
 *
 * Pure client logic: the recommendation map is computed on the server from live
 * rows and serialised into the page, so choosing an option is a synchronous
 * lookup. There is no API call, no AI, and no loading state to design around.
 *
 * When an answer has no live offer behind it, we say so and route to free
 * counselling rather than recommending something that is not open — the offline
 * Chandigarh option in particular must never suggest an online batch to someone
 * who just asked for a classroom.
 *
 * Implemented as a radio group so it is keyboard-navigable and announced
 * correctly; arrow keys move between options natively.
 */
export interface WhereAreYouNowProps {
  recommendations: Record<string, LiveOffer | null>;
  /** Where to send someone we have no open offer for. */
  counsellingHref: string;
}

export default function WhereAreYouNow({ recommendations, counsellingHref }: WhereAreYouNowProps) {
  const [selected, setSelected] = useState<string | null>(null);

  function choose(key: string) {
    setSelected(key);
    cinematic.selectorCompleted(key);
  }

  const point = selected ? STARTING_POINTS.find((p) => p.key === selected) : null;
  const offer = selected ? recommendations[selected] ?? null : null;

  return (
    <section className="section container-wide" aria-labelledby="cinematic-selector-heading">
      <div className="mx-auto max-w-2xl text-center">
        <p className="ca-eyebrow">Find your starting point</p>
        <h2
          id="cinematic-selector-heading"
          className="mt-3 font-heading text-3xl font-extrabold tracking-tight text-[var(--ca-navy-900)] sm:text-4xl"
        >
          Where are you now?
        </h2>
        <p className="mt-3 text-[var(--ca-slate-700)]">
          Pick the line that describes you. We will point you at the batch that is actually open — not a brochure.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-labelledby="cinematic-selector-heading"
        className="mx-auto mt-10 grid max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {STARTING_POINTS.map((p) => {
          const active = selected === p.key;
          return (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => choose(p.key)}
              className={`ca-focus rounded-2xl border p-5 text-left transition-all ${
                active
                  ? "border-[var(--ca-gold)] bg-[rgba(212,175,55,0.08)] shadow-md"
                  : "border-[var(--ca-slate-200)] bg-white hover:border-[var(--ca-gold)] hover:shadow-sm"
              }`}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="font-heading text-base font-bold text-[var(--ca-navy-900)]">{p.label}</span>
                {active && <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[var(--ca-gold)]" aria-hidden="true" />}
              </span>
              <span className="mt-1.5 block text-sm leading-relaxed text-[var(--ca-slate-700)]">{p.blurb}</span>
            </button>
          );
        })}
      </div>

      {/* Result panel. `aria-live` so a screen reader hears the recommendation
          without the focus being yanked out of the radio group. */}
      <div className="mx-auto mt-6 max-w-4xl" aria-live="polite">
        {point && (
          <div className="ca-card p-6 sm:p-7">
            {offer ? (
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="ca-eyebrow">Recommended for “{point.label}”</p>
                  <h3 className="mt-1.5 font-heading text-xl font-bold text-[var(--ca-navy-900)]">{offer.label}</h3>
                  <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-[var(--ca-slate-700)]">
                    {offer.price != null && (
                      <span className="font-heading text-lg font-extrabold text-[var(--ca-navy-900)]">
                        {rupees(offer.price)}
                      </span>
                    )}
                    {offer.originalPrice != null && (
                      <span className="text-[var(--ca-slate-400)] line-through">{rupees(offer.originalPrice)}</span>
                    )}
                    {offer.seatsLeft != null && <span>· {offer.seatsLeft} seats left</span>}
                  </p>
                </div>
                <TrackedLink
                  href={offer.href}
                  event="journey_recommendation_clicked"
                  props={{ answer: point.key, slug: offer.slug }}
                  className="ca-btn ca-btn-gold ca-focus shrink-0 justify-center px-6"
                >
                  See this batch <ArrowRight size={16} aria-hidden="true" />
                </TrackedLink>
              </div>
            ) : (
              // Honest empty state. No invented batch, no "coming soon" urgency.
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="ca-eyebrow">For “{point.label}”</p>
                  <h3 className="mt-1.5 font-heading text-xl font-bold text-[var(--ca-navy-900)]">
                    {point.offline
                      ? "No offline batch is open for admission right now"
                      : "Nothing open that we would honestly recommend today"}
                  </h3>
                  <p className="mt-2 text-sm text-[var(--ca-slate-700)]">
                    Rather than point you at a closed batch, talk to the team — they will tell you what is next and when.
                  </p>
                </div>
                <Link href={counsellingHref} className="ca-btn ca-btn-outline ca-focus shrink-0 justify-center px-6">
                  Talk to the team <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
