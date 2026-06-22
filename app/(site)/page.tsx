import { Fragment } from "react";
import Link from "next/link";
import Hero from "@/components/public/home/Hero";
import CourseExplorer from "@/components/public/home/CourseExplorer";
import TopperShowcase from "@/components/public/home/TopperShowcase";
import Testimonials from "@/components/public/Testimonials";
import Reveal, { Stagger, StaggerItem } from "@/components/ui/Reveal";
import Accordion from "@/components/ui/Accordion";
import LeadForm from "@/components/public/LeadForm";
import LeadPopup from "@/components/public/LeadPopup";
import { getPublishedCourses, getPublicWebinars, getSiteSettings } from "@/lib/dataProvider";
import { ACADEMY } from "@/lib/config";
import { directionsUrl, mapEmbedUrl } from "@/lib/maps";

// Render fresh so newly published courses / upcoming webinars surface here too.
export const dynamic = "force-dynamic";

const WHY = [
  { icon: "👥", title: "Small batches (~40)", desc: "Personal attention for every aspirant — not a crowded hall." },
  { icon: "🎓", title: "9+ years of mentoring", desc: "A proven, refined methodology that produces results." },
  { icon: "🤝", title: "Direct faculty mentorship", desc: "Learn from Naman Sir directly, with 1:1 guidance." },
  { icon: "📍", title: "Chandigarh se bhi UPSC", desc: "World-class preparation, right here in the Tricity." },
];

const MODES = [
  { icon: "🏛️", title: "Offline — Chandigarh", desc: "Classroom batches at Sector 17C." },
  { icon: "💻", title: "Live Online — Pan India", desc: "Interactive live classes from anywhere." },
  { icon: "🎥", title: "Recorded", desc: "Self-paced learning, anytime access." },
  { icon: "🔀", title: "Hybrid", desc: "Best of both — class + recordings." },
];

const FAQ = [
  { q: "Do you teach in Hindi or English?", a: "Our classes are bilingual (Hinglish) so every aspirant can follow comfortably." },
  { q: "Are batches small?", a: "Yes — we deliberately keep batches around 40 students for genuine personal attention." },
  { q: "Can I attend from outside Chandigarh?", a: "Absolutely. Our Live Online and Recorded modes serve aspirants across India." },
  { q: "Is there an EMI option?", a: "Yes, most foundation programs offer easy monthly EMI. See each course page for details." },
  { q: "How do I start?", a: "Book a free demo or join the ₹50 beginner masterclass to experience our teaching first." },
];

export default async function HomePage() {
  const [courses, webinars, settings] = await Promise.all([
    getPublishedCourses(),
    getPublicWebinars(),
    getSiteSettings(),
  ]);
  const upcoming = webinars.filter((w) => w.status === "upcoming").slice(0, 2);
  const c = settings.content;
  const trustBar = c.trust_bar?.length ? c.trust_bar : [];

  return (
    <>
      <Hero hero={settings.hero} />
      <LeadPopup config={settings.popup} />

      {/* Trust bar */}
      <div className="border-y border-line bg-surface2">
        <div className="container-wide flex flex-wrap items-center justify-center gap-x-8 gap-y-2 py-4 text-sm font-medium text-ink2">
          {trustBar.map((item, i) => (
            <Fragment key={i}>
              {i > 0 && <span className="h-4 w-px bg-line" />}
              <span>{item}</span>
            </Fragment>
          ))}
        </div>
        <div className="h-1 w-full" style={{ background: "linear-gradient(90deg,#FF9933,#fff,#138808)" }} />
      </div>

      {/* Why Naman Sir */}
      <section className="section container-wide">
        <Reveal>
          <p className="pill pill-blue mb-3">{c.why_sub}</p>
          <h2 className="max-w-2xl text-3xl font-extrabold sm:text-4xl">{c.why_heading}</h2>
        </Reveal>
        <Stagger className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {WHY.map((w) => (
            <StaggerItem key={w.title}>
              <div className="card card-hover h-full p-6">
                <div className="mb-3 text-3xl">{w.icon}</div>
                <h3 className="text-lg">{w.title}</h3>
                <p className="mt-1.5 text-sm text-ink2">{w.desc}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* Our Toppers / Results showcase */}
      <TopperShowcase toppers={settings.toppers} heading={c.results_heading} subtitle={c.results_sub} />

      {/* Learning modes */}
      <section className="section bg-surface">
        <div className="container-wide">
          <Reveal>
            <h2 className="text-3xl font-extrabold sm:text-4xl">{c.modes_heading}</h2>
            <p className="mt-2 text-ink2">{c.modes_sub}</p>
          </Reveal>
          <Stagger className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {MODES.map((m) => (
              <StaggerItem key={m.title}>
                <div className="card card-hover h-full p-6">
                  <div className="mb-3 text-3xl">{m.icon}</div>
                  <h3 className="text-lg">{m.title}</h3>
                  <p className="mt-1.5 text-sm text-ink2">{m.desc}</p>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Course explorer */}
      <section className="section container-wide">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-3xl font-extrabold sm:text-4xl">{c.courses_heading}</h2>
              <p className="mt-2 text-ink2">{c.courses_sub}</p>
            </div>
            <Link href="/courses" className="btn btn-secondary">View all courses →</Link>
          </div>
        </Reveal>
        <div className="mt-8">
          <CourseExplorer courses={courses} limit={6} />
        </div>
      </section>

      {/* Free resources */}
      <section className="section container-wide">
        <Reveal>
          <h2 className="text-3xl font-extrabold sm:text-4xl">{c.free_heading}</h2>
        </Reveal>
        <Stagger className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: "📰", t: "Daily Current Affairs" },
            { icon: "📝", t: "Daily MCQs" },
            { icon: "📚", t: "Free PDFs & Notes" },
            { icon: "✈️", t: "Join Telegram (23K+)" },
          ].map((r) => (
            <StaggerItem key={r.t}>
              <Link href="/free-resources" className="card card-hover block p-6">
                <div className="mb-3 text-3xl">{r.icon}</div>
                <h3 className="text-base">{r.t}</h3>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      {/* Webinar / demo band */}
      <section className="section">
        <div className="container-wide">
          <div className="rounded-2xl bg-primary p-8 text-white sm:p-12" style={{ backgroundImage: "linear-gradient(135deg,#0057FF,#3D8BFF)" }}>
            <div className="grid items-center gap-6 lg:grid-cols-2">
              <div>
                <h2 className="text-3xl font-extrabold text-white sm:text-4xl">{c.band_heading}</h2>
                <p className="mt-2 max-w-md text-white/90">{c.band_subtext}</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  {c.band_primary_label && (
                    <Link href={c.band_primary_href || "#"} className="btn bg-white px-6 text-primary">{c.band_primary_label}</Link>
                  )}
                  {c.band_secondary_label && (
                    <Link href={c.band_secondary_href || "#"} className="btn btn-secondary border-white px-6 text-white hover:bg-white/10">{c.band_secondary_label}</Link>
                  )}
                </div>
              </div>
              <div className="grid gap-3">
                {upcoming.map((w) => (
                  <Link key={w.id} href={`/webinars/${w.slug}`} className="rounded-xl bg-white/10 p-4 backdrop-blur hover:bg-white/15">
                    <p className="font-semibold text-white">{w.title}</p>
                    <p className="text-sm text-white/80">{w.registrations.toLocaleString("en-IN")} registered</p>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="section bg-surface">
        <div className="container-wide">
          <Reveal>
            <h2 className="text-3xl font-extrabold sm:text-4xl">{c.testimonials_heading}</h2>
          </Reveal>
        </div>
        <div className="mt-8">
          <Testimonials />
        </div>
      </section>

      {/* Locations */}
      <section className="section container-wide">
        <div className="grid items-center gap-8 lg:grid-cols-2">
          <Reveal>
            <h2 className="text-3xl font-extrabold sm:text-4xl">{c.locations_heading}</h2>
            <p className="mt-2 text-ink2">{c.locations_sub}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {ACADEMY.citiesServed.map((city) => (
                <span key={city} className="pill pill-gray">{city}</span>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href={directionsUrl(settings.brand)} target="_blank" rel="noopener noreferrer" className="btn btn-primary">📍 Get Directions</a>
              <Link href="/contact" className="btn btn-secondary">Contact us →</Link>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="card overflow-hidden p-0">
              <iframe
                title="Academy location"
                src={mapEmbedUrl(settings.brand)}
                className="h-72 w-full border-0"
                loading="lazy"
              />
            </div>
          </Reveal>
        </div>
      </section>

      {/* FAQ */}
      <section className="section bg-surface">
        <div className="container-x">
          <Reveal>
            <h2 className="text-center text-3xl font-extrabold sm:text-4xl">{c.faq_heading}</h2>
          </Reveal>
          <div className="mx-auto mt-8 max-w-3xl">
            <Accordion items={FAQ} />
          </div>
        </div>
      </section>

      {/* Lead capture */}
      <section className="section container-x">
        <div className="card p-8 sm:p-10">
          <div className="grid items-center gap-8 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-extrabold">{c.lead_heading}</h2>
              <p className="mt-2 text-ink2">{c.lead_sub}</p>
            </div>
            <LeadForm source="Website" campaign="Home Counselling" compact />
          </div>
        </div>
      </section>
    </>
  );
}
