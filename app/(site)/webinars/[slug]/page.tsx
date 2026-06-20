import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Countdown from "@/components/public/Countdown";
import WebinarRegister from "@/components/public/WebinarRegister";
import CoverImage from "@/components/public/CoverImage";
import ContactButtons from "@/components/public/ContactButtons";
import ResourceList from "@/components/public/ResourceList";
import Accordion from "@/components/ui/Accordion";
import { getWebinarBySlug } from "@/lib/dataProvider";
import { formatINR } from "@/lib/dates";
import { SITE_URL, ACADEMY } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const w = await getWebinarBySlug(params.slug);
  if (!w || w.active === false) return { title: "Webinar not found" };
  const url = `${SITE_URL}/webinars/${w.slug}`;
  const desc = (w.description || `Register for ${w.title} with ${ACADEMY.name}.`).slice(0, 160);
  const priceLabel = w.price === 0 ? "Free" : formatINR(w.price);
  const title = `${w.title} — ${priceLabel} ${w.status === "completed" ? "Recording" : "Webinar"}`;
  const images = w.cover_image_url ? [{ url: w.cover_image_url, width: 1200, height: 630, alt: w.title }] : [];
  return {
    title,
    description: desc,
    alternates: { canonical: url },
    openGraph: { title, description: desc, url, type: "website", siteName: ACADEMY.name, images },
    twitter: { card: "summary_large_image", title, description: desc, images: images.map((i) => i.url) },
  };
}

export default async function WebinarDetail({ params }: { params: { slug: string } }) {
  const w = await getWebinarBySlug(params.slug);
  if (!w || w.active === false) notFound();

  const completed = w.status === "completed";
  const seatsLeft = w.capacity != null ? Math.max(0, w.capacity - w.registrations) : null;
  const faqs = (w.faqs || []).filter((f) => f.q?.trim());

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: w.title,
    description: w.description || undefined,
    startDate: w.datetime,
    endDate: w.end_datetime || undefined,
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
    image: w.cover_image_url ? [w.cover_image_url] : undefined,
    organizer: { "@type": "Organization", name: ACADEMY.name, url: SITE_URL },
    offers: {
      "@type": "Offer",
      price: w.price,
      priceCurrency: "INR",
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/webinars/${w.slug}`,
    },
  };

  return (
    <div className="container-wide section">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CoverImage src={w.cover_image_url} mobileSrc={w.mobile_image_url} alt={w.title} />

          <div className="flex flex-wrap items-center gap-2">
            <span className={`pill ${completed ? "pill-gray" : "pill-green"}`}>{completed ? "Recording" : "Upcoming"}</span>
            <span className="pill pill-blue">{w.price === 0 ? "Free" : formatINR(w.price)}</span>
            {seatsLeft != null && !completed && seatsLeft <= 25 && (
              <span className="pill pill-saffron">Only {seatsLeft} seats left</span>
            )}
          </div>
          <h1 className="mt-4 text-3xl font-extrabold sm:text-4xl">{w.title}</h1>
          <p className="mt-3 text-ink2">{w.description}</p>
          <p className="mt-4 text-sm text-muted">
            🗓 {new Date(w.datetime).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" })}
            {w.end_datetime && ` – ${new Date(w.end_datetime).toLocaleTimeString("en-IN", { timeStyle: "short" })}`}
          </p>
          <p className="mt-1 text-sm text-muted">👥 {w.registrations.toLocaleString("en-IN")} registered</p>

          {!completed && (
            <div className="mt-6">
              <p className="mb-2 text-sm font-medium text-ink2">Starts in</p>
              <Countdown to={w.datetime} />
            </div>
          )}

          {completed && w.recording_link && (
            <a href={w.recording_link} target="_blank" rel="noopener noreferrer" className="btn btn-primary mt-6">
              ▶ Watch Recording
            </a>
          )}

          {w.long_description && (
            <div className="mt-8">
              <h2 className="text-xl font-bold">About this session</h2>
              <div className="mt-3 space-y-3 text-ink2">
                {w.long_description.split(/\n\n+/).map((para, i) => <p key={i}>{para}</p>)}
              </div>
            </div>
          )}

          {(w.pdf_resources || []).length > 0 && (
            <div className="mt-8">
              <h2 className="text-xl font-bold">Included resources</h2>
              <p className="mb-3 text-sm text-ink2">Bonus material you get with this session.</p>
              <ResourceList resources={w.pdf_resources} />
            </div>
          )}

          {(w.contact_links || []).length > 0 && (
            <div className="mt-8">
              <h2 className="text-xl font-bold">Have a question?</h2>
              <p className="mb-3 text-sm text-ink2">Reach out — we usually reply within minutes.</p>
              <ContactButtons links={w.contact_links} />
            </div>
          )}

          {faqs.length > 0 && (
            <div className="mt-10">
              <h2 className="text-2xl font-extrabold">FAQs</h2>
              <div className="mt-4">
                <Accordion items={faqs} />
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="card p-6 lg:sticky lg:top-24">
            <h3 className="text-lg">{completed ? "Watch the recording" : "Reserve your spot"}</h3>
            <p className="mt-1 text-sm text-ink2">{completed ? "Register to get the recording link." : "Limited seats — register now."}</p>
            {seatsLeft != null && !completed && (
              <p className="mt-2 text-xs font-semibold text-india">🔥 {seatsLeft} of {w.capacity} seats remaining</p>
            )}
            <div className="mt-4">
              <WebinarRegister webinarId={w.id} webinarSlug={w.slug} price={w.price} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
