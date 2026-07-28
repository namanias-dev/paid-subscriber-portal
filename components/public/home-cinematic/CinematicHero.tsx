import { Fragment } from "react";
import Image from "next/image";
import { ArrowRight, CalendarDays, Sparkles } from "lucide-react";
import type { HeroConfig } from "@/lib/types";
import { DEFAULT_HERO } from "@/lib/homeDefaults";
import type { HeroOffers } from "@/lib/homeCinematic/offers";
import { rupees } from "@/lib/homeCinematic/offers";
import type { TrustItem } from "@/lib/homeCinematic/trust";
import HeroSceneLayer from "./HeroSceneLayer";
import TrackedLink from "./TrackedLink";

/**
 * Cinematic hero — a SERVER component.
 *
 * Everything that matters is in the initial HTML: the single `<h1>`, the
 * sub-headline, all three CTAs (with their real hrefs), the portrait, and the
 * trust figures. The only client code in the subtree is the analytics hook on the
 * CTAs and the decorative WebGL layer, both of which hydrate after paint.
 *
 * The portrait is `priority`, so it is the intended LCP element and it is on the
 * FIRST screen rather than below a scroll.
 *
 * PRICES: `offers` is derived from live rows (see lib/homeCinematic/offers.ts).
 * Nothing here hardcodes ₹50 — if no masterclass session is open, the CTA
 * degrades to the webinars index and makes no price claim at all.
 */

/** Media proxy lives on the apex host, which 308s to www — skip the hop. */
function normalizePortraitUrl(url?: string | null): string | undefined {
  const u = url?.trim();
  if (!u) return undefined;
  return u.replace(/^https?:\/\/namanias\.com\//i, "https://www.namanias.com/");
}

function startLabel(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
}

export interface CinematicHeroProps {
  hero?: HeroConfig;
  offers: HeroOffers;
  /** Already provenance-filtered; only renderable items reach this component. */
  trust: TrustItem[];
}

export default function CinematicHero({ hero, offers, trust }: CinematicHeroProps) {
  const h = hero || DEFAULT_HERO;
  const headline = (h.headline || DEFAULT_HERO.headline || "").trim();
  const subheading = h.subheading?.trim() || DEFAULT_HERO.subheading || "";
  const badge = h.badge?.trim();
  const portrait = normalizePortraitUrl(h.portrait_url);
  const portraitAlt = h.portrait_alt?.trim() || "Naman Sir";

  // Gold-highlight the mentor's name without splitting the h1 into per-word
  // spans, so the heading stays one clean text run for crawlers.
  const idx = headline.search(/naman/i);
  let pre = headline;
  let hi = "";
  let post = "";
  if (idx >= 0) {
    const m = headline.slice(idx).match(/^naman(\s+sir)?/i);
    const hiText = m ? m[0] : "Naman";
    pre = headline.slice(0, idx);
    hi = hiText;
    post = headline.slice(idx + hiText.length);
  }

  const mc = offers.masterclass;
  const fnd = offers.foundation;
  const mcDate = startLabel(mc?.startsAt ?? null);

  // Copy is assembled from live data. When a price is unknown we say less rather
  // than inventing a number.
  const mcLabel = mc && mc.price != null ? `Join ${rupees(mc.price)} Masterclass` : "See upcoming masterclass";
  const mcHref = mc ? mc.href : "/webinars";

  return (
    <section className="hv2-space hv2-grain relative overflow-hidden">
      <div className="container-wide relative z-10 grid items-center gap-10 py-16 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
        {/* ---------- Left: all the words. Server-rendered, LCP-safe. ---------- */}
        <div className="max-w-2xl">
          {badge && (
            <span className="ca-badge ca-badge-gold mb-6 backdrop-blur">
              <Sparkles size={13} aria-hidden="true" />
              {badge.replace(/^[^A-Za-z0-9₹]+/, "").trim() || badge}
            </span>
          )}

          <h1 className="font-heading text-[2.1rem] font-extrabold leading-[1.06] tracking-tight text-white sm:text-5xl lg:text-[4rem]">
            {pre}
            {hi && <span className="hv2-gold-text">{hi}</span>}
            {post}
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-[var(--ca-slate-300)] sm:text-lg">{subheading}</p>

          {/* ---------- Three CTAs, every href derived from live data ---------- */}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <TrackedLink
              href={mcHref}
              event="hero_masterclass_click"
              props={{ slug: mc?.slug ?? "none", price: mc?.price ?? null }}
              className="ca-btn ca-btn-gold ca-focus justify-center px-6 text-base"
            >
              {mcLabel}
              <ArrowRight size={17} aria-hidden="true" />
            </TrackedLink>

            <TrackedLink
              href={fnd ? fnd.href : "/courses"}
              event="hero_course_click"
              props={{ slug: fnd?.slug ?? "index", price: fnd?.price ?? null }}
              className="ca-btn ca-btn-glass ca-focus justify-center px-6 text-base"
            >
              Explore Foundation Courses
            </TrackedLink>

            <TrackedLink
              href={offers.quizHref}
              event="hero_quiz_click"
              className="ca-btn ca-btn-glass ca-focus justify-center px-6 text-base"
            >
              Free Quiz
            </TrackedLink>
          </div>

          {/* Live, verifiable specifics about the two paid offers. Each line is
              rendered only when the underlying row actually carries the value. */}
          {(mcDate || (fnd && fnd.price != null)) && (
            <ul className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[var(--ca-slate-400)]">
              {mcDate && (
                <li className="inline-flex items-center gap-1.5">
                  <CalendarDays size={14} className="text-[var(--ca-gold)]" aria-hidden="true" />
                  Next masterclass {mcDate}
                </li>
              )}
              {fnd && fnd.price != null && (
                <li>
                  Foundation from <span className="font-semibold text-white">{rupees(fnd.price)}</span>
                  {fnd.originalPrice != null && (
                    <span className="ml-1.5 text-[var(--ca-slate-400)] line-through">{rupees(fnd.originalPrice)}</span>
                  )}
                </li>
              )}
              {fnd?.seatsLeft != null && <li>{fnd.seatsLeft} seats left in the current batch</li>}
            </ul>
          )}

          {/* ---------- Trust figures. Provenance-gated upstream. ----------
              `dt`/`dd` are DIRECT children and flow down each column, so the markup
              stays a valid description list while still laying out as a value-over-
              label grid. Labels wrap rather than truncate: at 320px a long label must
              push to a second line, never be clipped. */}
          {trust.length > 0 && (
            <dl className="mt-10 grid max-w-lg auto-cols-fr grid-flow-col grid-rows-[auto_auto] gap-x-5 gap-y-1">
              {trust.map((t) => (
                <Fragment key={t.label}>
                  <dd className="font-heading text-2xl font-extrabold text-white sm:text-3xl">{t.display}</dd>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-[var(--ca-slate-300)]">
                    {t.label}
                  </dt>
                </Fragment>
              ))}
            </dl>
          )}
        </div>

        {/* ---------- Right: the portrait, framed. The WebGL layer sits behind. ---------- */}
        <div className="relative mx-auto w-full max-w-sm lg:max-w-md">
          <HeroSceneLayer />
          {portrait ? (
            <div
              className="relative overflow-hidden rounded-[26px] border border-[rgba(232,191,88,0.32)] p-3 backdrop-blur-xl"
              style={{
                background: "linear-gradient(160deg, rgba(28,58,110,0.5), rgba(11,20,38,0.62))",
                boxShadow: "0 28px 80px -28px rgba(0,0,0,0.75), 0 0 56px -20px rgba(232,191,88,0.3)",
              }}
            >
              <Image
                src={portrait}
                alt={portraitAlt}
                width={620}
                height={760}
                priority
                sizes="(max-width: 1024px) 78vw, 420px"
                className="mx-auto h-auto w-full max-h-[360px] object-contain sm:max-h-[470px] lg:max-h-[520px]"
                style={{
                  WebkitMaskImage: "linear-gradient(to bottom, #000 76%, rgba(0,0,0,0.5) 91%, transparent 100%)",
                  maskImage: "linear-gradient(to bottom, #000 76%, rgba(0,0,0,0.5) 91%, transparent 100%)",
                }}
              />
            </div>
          ) : (
            // No portrait configured: keep the composition intact with the motif
            // alone rather than rendering an empty frame.
            <div className="aspect-[4/5] w-full" aria-hidden="true" />
          )}
        </div>
      </div>

      <div className="ca-divider" />
    </section>
  );
}
