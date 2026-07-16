import { CalendarX, CalendarCheck, Clock } from "lucide-react";
import Reveal, { Stagger, StaggerItem } from "@/components/ui/Reveal";
import WebinarCard from "@/components/public/WebinarCard";
import WebinarRegister from "@/components/public/WebinarRegister";
import { getPublicWebinars, getWebinarRegisteredCounts } from "@/lib/dataProvider";
import { getPurchaseSnapshot, webinarPurchased } from "@/lib/purchaseStatus";
import { canRegisterForWebinar } from "@/lib/webinarLifecycle";
import { formatINR, formatISTDateTime } from "@/lib/dates";

export const metadata = { title: "Webinars — Naman Sharma IAS Academy" };

// Always render fresh so newly created/edited webinars appear immediately
// (otherwise this listing is statically prerendered at build time and goes stale).
export const dynamic = "force-dynamic";

export default async function WebinarsPage() {
  const webinars = await getPublicWebinars();
  const snapshot = await getPurchaseSnapshot();
  const regCounts = await getWebinarRegisteredCounts(webinars);

  // Ad landing target: feature the soonest still-open (registerable) session so a
  // click from a Google Ads campaign can convert right here. The registration form
  // runs through the SAME capture path (→ /api/public/webinar-register →
  // registerWebinar) that creates the CRM lead, fires lead_created
  // (source_form=webinar_registration) and stamps first-party attribution.
  const featured =
    webinars
      .filter((w) => w.status !== "completed" && canRegisterForWebinar(w))
      .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())[0] || null;
  const featuredRegistered = featured ? webinarPurchased(featured, snapshot) : false;

  return (
    <div className="bg-[var(--ca-slate-50)]">
      {/* Premium hero */}
      <header className="ca-dark ca-grain relative overflow-hidden">
        <div className="ca-orb" style={{ width: 320, height: 320, top: -130, right: -70, background: "rgba(212,175,55,0.16)" }} />
        <div className="ca-orb" style={{ width: 260, height: 260, bottom: -150, left: -60, background: "rgba(30,58,138,0.5)" }} />
        <div className="container-wide relative py-14 text-center sm:py-20">
          <p className="ca-eyebrow">Webinars &amp; Events</p>
          <h1 className="ca-hero-title mx-auto mt-3 max-w-3xl font-heading text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">
            Live masterclasses to level up your UPSC prep
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-[var(--ca-slate-300)]">
            Free &amp; ₹50 strategy sessions, doubt-clearing and live Q&amp;A with Naman Sir — with recordings and certificates.
          </p>
        </div>
      </header>

      {/* Content */}
      <div className="relative z-10 -mt-10 rounded-t-[2rem] bg-[var(--ca-slate-50)] sm:-mt-12">
        {/* Featured registration — the ad landing target. */}
        {featured && (
          <div className="container-wide pt-10 sm:pt-12">
            <Reveal>
              <section id="register" className="scroll-mt-24 overflow-hidden rounded-2xl border border-[var(--ca-slate-200)] bg-white shadow-soft">
                <div className="grid gap-0 md:grid-cols-2">
                  {/* Summary */}
                  <div className="ca-dark relative flex flex-col justify-center gap-3 p-6 sm:p-8">
                    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[rgba(212,175,55,0.95)] px-2.5 py-1 text-[11px] font-extrabold text-[#1a1304]">
                      {featured.price === 0 ? "Free webinar" : formatINR(featured.price)}
                    </span>
                    <h2 className="font-heading text-2xl font-extrabold leading-tight text-white">{featured.title}</h2>
                    {featured.description && (
                      <p className="line-clamp-2 text-sm text-[var(--ca-slate-300)]">{featured.description}</p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-[var(--ca-slate-300)]">
                      <span className="inline-flex items-center gap-1.5"><CalendarCheck size={15} aria-hidden="true" /> {formatISTDateTime(featured.datetime)}</span>
                      <span className="inline-flex items-center gap-1.5"><Clock size={15} aria-hidden="true" /> Live + recording</span>
                    </div>
                  </div>
                  {/* Form */}
                  <div className="p-6 sm:p-8">
                    {featuredRegistered ? (
                      <div className="flex h-full flex-col justify-center text-center">
                        <p className="font-heading text-lg font-bold text-[var(--ca-navy-900)]">✓ You&apos;re registered</p>
                        <p className="mt-1 text-sm text-[var(--ca-slate-700)]">We&apos;ll send the joining link before it starts.</p>
                        <a href="/portal" className="btn btn-primary mt-4">Go to My Portal →</a>
                      </div>
                    ) : (
                      <>
                        <h3 className="font-heading text-lg font-bold text-[var(--ca-navy-900)]">Reserve your spot</h3>
                        <p className="mt-1 mb-3 text-sm text-[var(--ca-slate-700)]">Limited seats — register in seconds.</p>
                        <WebinarRegister webinarId={featured.id} webinarSlug={featured.slug} price={featured.price} />
                      </>
                    )}
                  </div>
                </div>
              </section>
            </Reveal>
          </div>
        )}

        <div className="container-wide py-10 sm:py-12">
          {webinars.length === 0 ? (
            <div className="mx-auto max-w-md rounded-2xl border border-[var(--ca-slate-200)] bg-white p-10 text-center shadow-soft">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--ca-slate-50)] text-[var(--ca-slate-400)]">
                <CalendarX size={22} aria-hidden="true" />
              </span>
              <p className="font-heading text-lg font-bold text-[var(--ca-navy-900)]">No upcoming webinars yet</p>
              <p className="mt-1 text-sm text-[var(--ca-slate-700)]">New sessions are announced regularly — check back soon.</p>
            </div>
          ) : (
            <Reveal>
              <Stagger className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {webinars.map((w) => (
                  <StaggerItem key={w.id}>
                    <WebinarCard webinar={w} registered={webinarPurchased(w, snapshot)} registeredCount={regCounts.get(w.id) ?? 0} />
                  </StaggerItem>
                ))}
              </Stagger>
            </Reveal>
          )}
        </div>
      </div>
    </div>
  );
}
