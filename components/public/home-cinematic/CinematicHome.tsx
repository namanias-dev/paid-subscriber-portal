import Link from "next/link";
import { ArrowRight } from "lucide-react";
import CourseExplorer from "@/components/public/home/CourseExplorer";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import TopperStripV2 from "@/components/public/home-v2/TopperStripV2";
import type { SiteSettings, Course, Webinar, CaArticle } from "@/lib/types";
import type { CoursePurchaseView } from "@/lib/purchaseStatus";
import type { WhatsNewItem } from "@/lib/announcements";
import { deriveHeroOffers, deriveRecommendations } from "@/lib/homeCinematic/offers";
import { auditTrust, renderable } from "@/lib/homeCinematic/trust";
import { guardCourses, guardWebinars } from "@/lib/homeCinematic/fixtureGuard";
import { CapabilityProvider } from "./CapabilityProvider";
import CinematicTelemetry from "./CinematicTelemetry";
import CinematicHero from "./CinematicHero";
import LiveIntelligenceStrip from "./LiveIntelligenceStrip";
import TrustRail from "./TrustRail";
import JourneySection from "./JourneySection";
import WhereAreYouNow from "./WhereAreYouNow";
import MentorSection from "./MentorSection";
import FinalCta from "./FinalCta";
import { STARTING_POINTS } from "./content";

/**
 * Cinematic home — the composition root for the `/home-cinematic` PREVIEW.
 *
 * This is a SERVER component. Everything a crawler or a JS-disabled browser needs
 * is in the HTML it returns: one `<h1>`, every heading, every paragraph, every
 * link and every CTA href. The client boundary exists only for the capability
 * provider, the analytics hooks and the two WebGL scenes.
 *
 * ── 3D BUDGET: TWO canvases, not three ──────────────────────────────────────
 * The brief allows up to three WebGL surfaces and asks for one where technically
 * possible. A single shared canvas is NOT technically possible here: the hero and
 * the journey are separated by a full viewport of scrolling content, and unifying
 * them would require one fixed full-viewport canvas behind the whole document,
 * which fights the natural-scroll requirement and forces every section to become
 * transparent. So the hero and the journey each own a canvas, and the third
 * surface — the final horizon — is built in CSS instead (see `FinalCta.tsx`).
 * That is under budget on purpose: the audience is mid-tier Android on Indian
 * mobile data, and a third GL context at the bottom of a long page costs real
 * memory for a gradient a browser can composite for free.
 *
 * Results, course cards, the selector, the trust rail and the mentor section are
 * all HTML/CSS, exactly as instructed.
 *
 * ── DATA HONESTY ────────────────────────────────────────────────────────────
 * Rows pass through `fixtureGuard` before anything is derived from them, and every
 * figure on the trust rail passes through the provenance gate in `trust.ts`. No
 * number is hardcoded, rounded or invented anywhere in this subtree.
 */
export interface CinematicHomeProps {
  settings: SiteSettings;
  courses: Course[];
  webinars: Webinar[];
  purchaseMap: Record<string, CoursePurchaseView>;
  homeCa: CaArticle[];
  whatsNewItems: WhatsNewItem[];
  waLink: string | null;
}

export default function CinematicHome({
  settings,
  courses,
  webinars,
  purchaseMap,
  homeCa,
  whatsNewItems,
  waLink,
}: CinematicHomeProps) {
  const c = settings.content;

  // ---- Guard first: never derive an offer from a mock-fallback row set. ----
  const courseGuard = guardCourses(courses);
  const webinarGuard = guardWebinars(webinars);
  const safeCourses = courseGuard.rows;
  const safeWebinars = webinarGuard.rows;

  const offers = deriveHeroOffers(safeCourses, safeWebinars);
  const recommendations = deriveRecommendations(safeCourses, safeWebinars, STARTING_POINTS);

  // ---- Only provenance-clean figures reach the UI. ----
  const trust = auditTrust(settings);
  const heroTrust = renderable(trust.stats).slice(0, 3);
  const railTrust = renderable(trust.bar);

  return (
    <CapabilityProvider>
      <CinematicTelemetry />

      {/* 2 — Live intelligence strip. Same aggregator as the announcement bar. */}
      <LiveIntelligenceStrip items={whatsNewItems} />

      {/* 1 — Cinematic hero: real portrait, live offer prices, three CTAs. */}
      <CinematicHero hero={settings.hero} offers={offers} trust={heroTrust} />

      {/* 3 — Trust rail. Renders nothing if every figure fails provenance. */}
      <TrustRail items={railTrust} />

      {/* 4 — The UPSC Journey: the one scroll-driven WebGL scene. */}
      <JourneySection />

      {/* 5 — "Where are you now?" → a real, currently-bookable offer. */}
      <WhereAreYouNow recommendations={recommendations} counsellingHref="/contact" />

      {/* 6 — Naman Sir, editorially. */}
      <MentorSection
        about={settings.about}
        portraitUrl={settings.hero?.portrait_url}
        portraitAlt={settings.hero?.portrait_alt || undefined}
        ctaHref="/contact"
      />

      {/* 7 — Courses. Reuses the SHARED CourseExplorer, unmodified, so pricing,
              purchase-awareness and card behaviour are the same code as /courses. */}
      {safeCourses.length > 0 && (
        <section className="section bg-surface" aria-labelledby="cinematic-courses-heading">
          <div className="container-wide">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="max-w-2xl">
                <h2
                  id="cinematic-courses-heading"
                  className="font-heading text-3xl font-extrabold tracking-tight text-[var(--ca-navy-900)] sm:text-4xl"
                >
                  {c.courses_heading}
                </h2>
                <p className="mt-2 text-[var(--ca-slate-700)]">{c.courses_sub}</p>
              </div>
              <Link href="/courses" className="ca-btn ca-btn-outline ca-focus">
                View all courses <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
            <div className="mt-8">
              <CourseExplorer courses={safeCourses} limit={6} purchaseMap={purchaseMap} />
            </div>
          </div>
        </section>
      )}

      {/* 8 — Verified results. Reuses the existing V2 topper strip unmodified;
              every row is an admin-created topper with a real photo. */}
      <TopperStripV2 toppers={settings.toppers} heading={c.results_heading} subtitle={c.results_sub} />

      {/* 11 — Current affairs. Only rendered when there is live content. */}
      {homeCa.length > 0 && (
        <section className="section container-wide" aria-labelledby="cinematic-ca-heading">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="max-w-2xl">
              <h2
                id="cinematic-ca-heading"
                className="font-heading text-3xl font-extrabold tracking-tight text-[var(--ca-navy-900)] sm:text-4xl"
              >
                Today&apos;s current affairs
              </h2>
              <p className="mt-2 text-[var(--ca-slate-700)]">
                Daily UPSC current affairs, monthly compilations and exam-ready analysis.
              </p>
            </div>
            <Link href="/current-affairs" className="ca-btn ca-btn-outline ca-focus">
              Explore current affairs <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
          {/* Reuses the shared CaArticleCard so thumbnails, relevance labels and
              link behaviour are the same code as /current-affairs. */}
          <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {homeCa.map((a) => (
              <li key={a.id} className="h-full">
                <CaArticleCard article={a} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 13 — Final cinematic CTA + the shared lead form. */}
      <FinalCta
        offers={offers}
        heading={c.lead_heading || "Get free counselling"}
        sub={c.lead_sub || ""}
        waLink={waLink}
      />
    </CapabilityProvider>
  );
}
