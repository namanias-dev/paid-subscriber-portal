import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Countdown from "@/components/public/Countdown";
import WebinarRegister from "@/components/public/WebinarRegister";
import CoverImage from "@/components/public/CoverImage";
import SeatCounter from "@/components/public/SeatCounter";
import WhatsAppButton from "@/components/public/WhatsAppButton";
import TrustStrip from "@/components/public/TrustStrip";
import StickyMobileCTA from "@/components/public/StickyMobileCTA";
import LandingSections from "@/components/public/LandingSections";
import BrochureCards from "@/components/public/BrochureCards";
import { getWebinarBySlug, getLibraryDocsByIds } from "@/lib/dataProvider";
import { buildLandingView } from "@/lib/landingView";
import { formatINR, formatISTRange } from "@/lib/dates";
import { SITE_URL, ACADEMY } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const w = await getWebinarBySlug(params.slug);
  if (!w || w.active === false) return { title: "Webinar not found" };
  const seo = w.seo || {};
  const canonicalSlug = seo.canonical_slug?.trim() || w.slug;
  const url = `${SITE_URL}/webinars/${canonicalSlug}`;
  const priceLabel = w.price === 0 ? "Free" : formatINR(w.price);
  const title = seo.title?.trim() || `${w.title} — ${priceLabel} ${w.status === "completed" ? "Recording" : "Webinar"}`;
  const desc = (seo.description?.trim() || w.description || `Register for ${w.title} with ${ACADEMY.name}.`).slice(0, 170);
  const ogImage = seo.og_image?.trim() || w.cover_image_url || undefined;
  const images = ogImage ? [{ url: ogImage, width: 1200, height: 630, alt: w.title }] : [];
  return {
    title,
    description: desc,
    keywords: seo.keywords?.trim() || undefined,
    alternates: { canonical: url },
    openGraph: { title, description: desc, url, type: "website", siteName: ACADEMY.name, images },
    twitter: { card: "summary_large_image", title, description: desc, images: images.map((i) => i.url) },
  };
}

export default async function WebinarDetail({ params }: { params: { slug: string } }) {
  const w = await getWebinarBySlug(params.slug);
  if (!w || w.active === false) notFound();

  const view = buildLandingView(w);
  const brochures = await getLibraryDocsByIds(w.brochure_ids);
  const completed = w.status === "completed";
  const priceLabel = w.price === 0 ? "Free" : formatINR(w.price);
  const startLabel = formatISTRange(w.datetime, w.end_datetime);

  const trust = [
    { icon: "🗓", label: completed ? "Recording available" : "Live + recording" },
    { icon: "💬", label: "Doubt support" },
    { icon: "📜", label: "Certificate of attendance" },
    ...(view.ratingCount ? [{ icon: "⭐", label: `${view.ratingAvg}/5 from ${view.ratingCount} reviews` }] : []),
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: w.title,
    description: w.description || undefined,
    startDate: w.datetime,
    endDate: w.end_datetime || undefined,
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
    image: (w.seo?.og_image || w.cover_image_url) ? [w.seo?.og_image || w.cover_image_url] : undefined,
    organizer: { "@type": "Organization", name: ACADEMY.name, url: SITE_URL },
    performer: view.mentor?.name ? { "@type": "Person", name: view.mentor.name } : undefined,
    offers: {
      "@type": "Offer",
      price: w.price,
      priceCurrency: "INR",
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/webinars/${w.slug}`,
    },
    ...(view.ratingAvg && view.ratingCount
      ? { aggregateRating: { "@type": "AggregateRating", ratingValue: view.ratingAvg, reviewCount: view.ratingCount } }
      : {}),
  };

  return (
    <div className="container-wide section pb-28 lg:pb-24">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CoverImage src={w.cover_image_url} mobileSrc={w.mobile_image_url} alt={w.title} />

          <div className="flex flex-wrap items-center gap-2">
            <span className={`pill ${completed ? "pill-gray" : "pill-green"}`}>
              {w.badge_label?.trim() || (completed ? "Recording" : "Live Webinar")}
            </span>
            <span className="pill pill-blue">{priceLabel}</span>
          </div>
          <h1 className="mt-4 text-3xl font-extrabold sm:text-4xl">{w.title}</h1>
          <p className="mt-3 text-ink2">{w.description}</p>
          <p className="mt-4 text-sm text-muted">
            🗓 {startLabel}
          </p>
          <p className="mt-1 text-sm text-muted">👥 {w.registrations.toLocaleString("en-IN")} registered</p>

          <div className="mt-4">
            <SeatCounter seat={view.seat} />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <a href="#register" className="btn btn-primary">{completed ? "Get the recording" : "Reserve your spot →"}</a>
            <WhatsAppButton config={view.whatsapp} />
          </div>

          <TrustStrip items={trust} />

          {!completed && (
            <div className="mt-7">
              <p className="mb-2 text-sm font-medium text-ink2">Starts in</p>
              <Countdown to={w.datetime} />
            </div>
          )}

          {completed && w.recording_link && (
            <a href={w.recording_link} target="_blank" rel="noopener noreferrer" className="btn btn-primary mt-6">
              ▶ Watch Recording
            </a>
          )}

          <LandingSections
            view={view}
            aboutTitle="About this session"
            aboutFallback={w.long_description}
            whoTitle="Who should attend?"
            faqs={w.faqs}
            resources={w.pdf_resources}
            contactLinks={w.contact_links}
            resourcesTitle="Included resources"
            resourcesSubtitle="Bonus material you get with this session."
          />

          {brochures.length > 0 && (
            <section className="mt-10">
              <h2 className="text-2xl font-extrabold">Brochures &amp; resources</h2>
              <div className="mt-4">
                <BrochureCards docs={brochures} />
              </div>
            </section>
          )}
        </div>

        <div>
          <div id="register" className="card scroll-mt-24 p-6 lg:sticky lg:top-24">
            <h3 className="text-lg">{completed ? "Watch the recording" : "Reserve your spot"}</h3>
            <p className="mt-1 text-sm text-ink2">{completed ? "Register to get the recording link." : "Limited seats — register now."}</p>
            <div className="mt-3">
              <SeatCounter seat={view.seat} compact />
            </div>
            <div className="mt-4">
              <WebinarRegister webinarId={w.id} webinarSlug={w.slug} price={w.price} />
            </div>
            <WhatsAppButton config={view.whatsapp} className="mt-3 w-full" />
          </div>
        </div>
      </div>

      <StickyMobileCTA
        priceLabel={priceLabel}
        ctaLabel={completed ? "Get recording" : "Reserve spot"}
        ctaHref="#register"
        whatsapp={view.whatsapp}
      />
    </div>
  );
}
