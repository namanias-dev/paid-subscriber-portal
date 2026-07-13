import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { MapPin, ArrowRight, ShieldCheck } from "lucide-react";
import CourseExplorer from "@/components/public/home/CourseExplorer";
import CaArticleCard from "@/components/public/ca/CaArticleCard";
import Testimonials from "@/components/public/Testimonials";
import Accordion from "@/components/ui/Accordion";
import LeadForm from "@/components/public/LeadForm";
import LeadPopup from "@/components/public/LeadPopup";
import { directionsUrl, mapEmbedUrl } from "@/lib/maps";
import { whatsappLink } from "@/lib/phone";
import { ACADEMY } from "@/lib/config";
import type { SiteSettings, Course, CaArticle, Webinar } from "@/lib/types";
import type { CoursePurchaseView } from "@/lib/purchaseStatus";
import HeroV2 from "./HeroV2";
import JourneyV2 from "./JourneyV2";
import TopperStripV2 from "./TopperStripV2";
import WebinarBandV2 from "./WebinarBandV2";
import HomeV2JsonLd from "./HomeV2JsonLd";
import HomeV2Motion from "./HomeV2Motion";
import FloatingWhatsAppV2 from "./FloatingWhatsAppV2";
import { WHY_V2, MODES_V2, FREE_V2, FAQ_V2, stripLeadingEmoji } from "./content";

/** Light navy icon chip used by the premium feature cards. */
function ChipLight({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="ca-icon-chip ca-icon-chip--light mb-4 flex">
      <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}

export interface HomeV2Props {
  settings: SiteSettings;
  courses: Course[];
  purchaseMap: Record<string, CoursePurchaseView>;
  homeCa: CaArticle[];
  upcoming: Webinar[];
  upcomingRegCounts: Map<string, number>;
  /** True when shown as a flag-gated preview (via ?v2=1) rather than promoted. */
  preview?: boolean;
}

/**
 * Home V2 — cinematic, flag-gated premium homepage composition. Every section is
 * a faithful re-flow of the live homepage, driven by the same admin settings and
 * data-provider functions, with premium navy+gold styling and real, crawlable
 * semantic HTML underneath. Motion (Phase B) and 3D (Phase C) layer on top.
 */
export default function HomeV2({
  settings,
  courses,
  purchaseMap,
  homeCa,
  upcoming,
  upcomingRegCounts,
  preview,
}: HomeV2Props) {
  const c = settings.content;
  const trustBar = (c.trust_bar || []).map(stripLeadingEmoji).filter(Boolean);
  const waLink = whatsappLink(
    settings.brand.whatsapp || settings.brand.support_phone,
    "Hi, I have a question about your courses / webinars.",
  );

  return (
    <>
      <HomeV2JsonLd settings={settings} courses={courses} />
      <HomeV2Motion />
      <FloatingWhatsAppV2 waLink={waLink} />
      <LeadPopup config={settings.popup} />

      {preview && (
        <div
          className="fixed bottom-4 left-4 z-[60] rounded-full bg-[var(--ca-navy-900)] px-3 py-1.5 text-xs font-semibold text-[var(--ca-gold-bright)] shadow-lg ring-1 ring-[rgba(212,175,55,0.4)]"
          role="note"
        >
          Home V2 preview · noindex
        </div>
      )}

      <HeroV2 hero={settings.hero} />

      {/* Trust bar — honest admin stats, emoji swapped for a gold marker. */}
      {trustBar.length > 0 && (
        <div className="border-b border-line bg-white">
          <div className="container-wide flex flex-wrap items-center justify-center gap-x-8 gap-y-3 py-5 text-sm font-semibold text-[var(--ca-slate-700)]">
            {trustBar.map((item, i) => (
              <span key={i} className="inline-flex items-center gap-2">
                <ShieldCheck size={16} className="text-[var(--ca-gold)]" aria-hidden="true" />
                {item}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Why Naman Sir */}
      <section className="section container-wide">
        <div className="max-w-2xl" data-hv2-reveal>
          <p className="pill pill-gold mb-3">{c.why_sub}</p>
          <h2 className="font-heading text-3xl font-extrabold tracking-tight text-[var(--ca-navy-900)] sm:text-4xl">{c.why_heading}</h2>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4" data-hv2-stagger>
          {WHY_V2.map((w) => (
            <div key={w.title} className="ca-card h-full p-6">
              <ChipLight icon={w.icon} />
              <h3 className="font-heading text-lg font-bold text-[var(--ca-navy-900)]">{w.title}</h3>
              <p className="mt-1.5 text-sm text-[var(--ca-slate-700)]">{w.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The journey — signature cinematic section */}
      <JourneyV2 />

      {/* Toppers / results */}
      <TopperStripV2 toppers={settings.toppers} heading={c.results_heading} subtitle={c.results_sub} />

      {/* Learning modes */}
      <section className="section container-wide">
        <div className="max-w-2xl" data-hv2-reveal>
          <h2 className="font-heading text-3xl font-extrabold tracking-tight text-[var(--ca-navy-900)] sm:text-4xl">{c.modes_heading}</h2>
          <p className="mt-2 text-[var(--ca-slate-700)]">{c.modes_sub}</p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4" data-hv2-stagger>
          {MODES_V2.map((m) => (
            <div key={m.title} className="ca-card h-full p-6">
              <ChipLight icon={m.icon} />
              <h3 className="font-heading text-lg font-bold text-[var(--ca-navy-900)]">{m.title}</h3>
              <p className="mt-1.5 text-sm text-[var(--ca-slate-700)]">{m.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Course explorer (live, reuses shared CourseExplorer + CourseCard) */}
      <section className="section bg-surface">
        <div className="container-wide">
          <div className="flex flex-wrap items-end justify-between gap-3" data-hv2-reveal>
            <div className="max-w-2xl">
              <h2 className="font-heading text-3xl font-extrabold tracking-tight text-[var(--ca-navy-900)] sm:text-4xl">{c.courses_heading}</h2>
              <p className="mt-2 text-[var(--ca-slate-700)]">{c.courses_sub}</p>
            </div>
            <Link href="/courses" className="ca-btn ca-btn-outline ca-focus">
              View all courses <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
          <div className="mt-8">
            <CourseExplorer courses={courses} limit={6} purchaseMap={purchaseMap} />
          </div>
        </div>
      </section>

      {/* Current Affairs (live) */}
      {homeCa.length > 0 && (
        <section className="section container-wide">
          <div className="flex flex-wrap items-end justify-between gap-3" data-hv2-reveal>
            <div className="max-w-2xl">
              <h2 className="font-heading text-3xl font-extrabold tracking-tight text-[var(--ca-navy-900)] sm:text-4xl">Today&apos;s Current Affairs</h2>
              <p className="mt-2 text-[var(--ca-slate-700)]">Daily UPSC current affairs, monthly PDFs and exam-ready analysis.</p>
            </div>
            <Link href="/current-affairs" className="ca-btn ca-btn-outline ca-focus">
              Explore Current Affairs <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-hv2-stagger>
            {homeCa.map((a) => (
              <CaArticleCard key={a.id} article={a} />
            ))}
          </div>
        </section>
      )}

      {/* Free resources */}
      <section className="section bg-surface">
        <div className="container-wide">
          <h2 className="font-heading text-3xl font-extrabold tracking-tight text-[var(--ca-navy-900)] sm:text-4xl" data-hv2-reveal>{c.free_heading}</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4" data-hv2-stagger>
            {FREE_V2.map((r) => (
              <Link key={r.title} href="/free-resources" className="ca-card ca-focus block p-6">
                <ChipLight icon={r.icon} />
                <h3 className="font-heading text-base font-bold text-[var(--ca-navy-900)]">{r.title}</h3>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Webinar / demo band (live) */}
      <WebinarBandV2 content={c} upcoming={upcoming} regCounts={upcomingRegCounts} />

      {/* Testimonials (reuses shared marquee) */}
      <section className="section bg-surface">
        <div className="container-wide">
          <h2 className="font-heading text-3xl font-extrabold tracking-tight text-[var(--ca-navy-900)] sm:text-4xl" data-hv2-reveal>{c.testimonials_heading}</h2>
        </div>
        <div className="mt-8">
          <Testimonials />
        </div>
      </section>

      {/* Locations */}
      <section className="section container-wide">
        <div className="grid items-center gap-8 lg:grid-cols-2" data-hv2-reveal>
          <div>
            <h2 className="font-heading text-3xl font-extrabold tracking-tight text-[var(--ca-navy-900)] sm:text-4xl">{c.locations_heading}</h2>
            <p className="mt-2 text-[var(--ca-slate-700)]">{c.locations_sub}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {ACADEMY.citiesServed.map((city) => (
                <span key={city} className="pill pill-gray">{city}</span>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href={directionsUrl(settings.brand)} target="_blank" rel="noopener noreferrer" className="ca-btn ca-btn-gold ca-focus">
                <MapPin size={16} aria-hidden="true" /> Get directions
              </a>
              <Link href="/contact" className="ca-btn ca-btn-outline ca-focus">
                Contact us <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          </div>
          <div className="ca-card overflow-hidden p-0">
            <iframe title="Academy location" src={mapEmbedUrl(settings.brand)} className="h-72 w-full border-0" loading="lazy" />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="section bg-surface">
        <div className="container-x" data-hv2-reveal>
          <h2 className="text-center font-heading text-3xl font-extrabold tracking-tight text-[var(--ca-navy-900)] sm:text-4xl">{c.faq_heading}</h2>
          <div className="mx-auto mt-8 max-w-3xl">
            <Accordion items={FAQ_V2} />
          </div>
        </div>
      </section>

      {/* Lead capture */}
      <section className="section container-x">
        <div className="hv2-space relative overflow-hidden rounded-[28px] p-8 sm:p-10">
          <div className="hv2-stars" aria-hidden="true" />
          <div className="relative z-10 grid items-center gap-8 lg:grid-cols-2">
            <div>
              <h2 className="font-heading text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{c.lead_heading}</h2>
              <p className="mt-3 text-[var(--ca-slate-300)]">{c.lead_sub}</p>
            </div>
            <div className="rounded-2xl bg-white/95 p-6 shadow-xl backdrop-blur">
              <LeadForm source="Website" campaign="Home Counselling" compact />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
