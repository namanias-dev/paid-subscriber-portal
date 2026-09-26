import Image from "next/image";
import { Check } from "lucide-react";
import ExpiredWebinarHandoff from "@/components/public/ExpiredWebinarHandoff";
import { ACADEMY, SITE_URL } from "@/lib/config";
import { formatNextSession, recoveryHostName } from "@/lib/webinarRecovery";
import { whatsappLink } from "@/lib/phone";
import { toPublicImageSrc } from "@/lib/publicMediaUrl";
import type { Webinar } from "@/lib/types";

/**
 * Ended-event handoff. The next session's date, title, and images come from
 * the resolved webinar row — this component does not know which date is current.
 */
export default function ExpiredWebinarRecovery({
  expired,
  next,
}: {
  expired: Webinar;
  next: Webinar | null;
}) {
  const when = next ? formatNextSession(next.datetime) : null;
  const host = recoveryHostName(next?.mentor?.name || expired.mentor?.name);
  const portrait = toPublicImageSrc(next?.mentor?.image_url || expired.mentor?.image_url);
  const cover = toPublicImageSrc(next?.cover_image_url || next?.mobile_image_url);
  const nextPath = next ? `/webinars/${next.slug}` : null;
  const wa = whatsappLink(expired.whatsapp_config?.whatsapp || expired.whatsapp_config?.phone, expired.whatsapp_config?.prefill_message);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: expired.title,
    description: "This masterclass has ended.",
    startDate: expired.datetime,
    endDate: expired.end_datetime || undefined,
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
    image: expired.cover_image_url ? [expired.cover_image_url] : undefined,
    organizer: { "@type": "Organization", name: ACADEMY.name, url: SITE_URL },
    offers: {
      "@type": "Offer",
      price: expired.price,
      priceCurrency: "INR",
      availability: "https://schema.org/SoldOut",
      url: `${SITE_URL}/webinars/${expired.slug}`,
    },
  };

  return (
    <section className="wh-page bg-[var(--ca-slate-50)]">
      <style>{`
        @keyframes wh-rise {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: none; }
        }
        @keyframes wh-draw {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
        @keyframes wh-bar {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
        .wh-rise { animation: wh-rise 520ms cubic-bezier(.22,.8,.28,1) both; }
        .wh-d1 { animation-delay: 70ms; }
        .wh-d2 { animation-delay: 150ms; }
        .wh-d3 { animation-delay: 230ms; }
        .wh-line { transform-origin: left center; animation: wh-draw 700ms cubic-bezier(.22,.8,.28,1) 200ms both; }
        .wh-bar { transform-origin: left center; animation: wh-bar 5s linear forwards; }
        .wh-cta { transition: transform 180ms ease, box-shadow 180ms ease; }
        .wh-cta:hover { transform: translateY(-1px); }
        .wh-forward-still { display: none; }
        @media (prefers-reduced-motion: reduce) {
          .wh-rise, .wh-line, .wh-bar, .wh-cta { animation: none; transition: none; }
          .wh-cta:hover { transform: none; }
          .wh-forward-live { display: none; }
          .wh-forward-still { display: block; }
          .wh-bar, .wh-bar-track { display: none; }
        }
      `}</style>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="container-wide px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-8 sm:px-6 sm:pt-14">
        <div className="mx-auto grid max-w-5xl items-center gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14">
          <div className="min-w-0">
            <p className="wh-rise text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--ca-gold-dark)]">
              Masterclass completed
            </p>
            <h1 className="wh-rise wh-d1 mt-3 font-heading text-[1.7rem] font-extrabold leading-[1.12] tracking-tight text-[var(--ca-navy-900)] sm:text-4xl">
              {next ? "You Haven't Missed Naman Sir." : "This Masterclass Has Ended"}
            </h1>
            {next && when ? (
              <p className="wh-rise wh-d2 mt-4 text-base leading-relaxed text-[var(--ca-slate-700)] sm:text-lg">
                {host} returns on <span className="font-semibold text-[var(--ca-navy-900)]">{when.weekdayDate}</span> at{" "}
                <span className="font-semibold text-[var(--ca-navy-900)]">{when.time}</span>.
              </p>
            ) : (
              <p className="wh-rise wh-d2 mt-4 text-base leading-relaxed text-[var(--ca-slate-700)] sm:text-lg">
                The next live session with {host} will be announced soon.
              </p>
            )}
            <p className="wh-rise wh-d3 mt-3 max-w-xl text-sm leading-relaxed text-[var(--ca-slate-600)] sm:text-base">
              {next
                ? "Registration for the next session is now open. Reserve your seat and continue from here."
                : "Your place in the last session is unchanged. We'll share the next date here as soon as it is set."}
            </p>

            {next && when ? (
              <ExpiredWebinarHandoff
                nextPath={nextPath}
                ctaLabel="Reserve My Seat"
                ctaMeta={when.compact}
                context={{
                  expired_webinar_id: expired.id,
                  expired_webinar_slug: expired.slug,
                  expired_webinar_date: expired.datetime || null,
                  next_webinar_id: next.id,
                  next_webinar_slug: next.slug,
                  next_webinar_date: next.datetime || null,
                }}
              />
            ) : (
              <>
                <ExpiredWebinarHandoff
                  nextPath={null}
                  ctaLabel=""
                  ctaMeta={null}
                  context={{
                    expired_webinar_id: expired.id,
                    expired_webinar_slug: expired.slug,
                    expired_webinar_date: expired.datetime || null,
                    next_webinar_id: null,
                    next_webinar_slug: null,
                    next_webinar_date: null,
                  }}
                />
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <a href="/courses" className="ca-btn ca-btn-gold ca-focus inline-flex min-h-12 items-center justify-center px-5 py-3 text-base font-bold">
                    Explore Courses
                  </a>
                  <a href="/webinars" className="ca-btn ca-btn-outline ca-focus inline-flex min-h-12 items-center justify-center px-5 py-3 text-base font-semibold">
                    View webinars
                  </a>
                  {wa ? (
                    <a href={wa} className="inline-flex min-h-12 items-center justify-center px-2 text-sm font-semibold text-[var(--ca-navy-800)] underline-offset-4 hover:underline">
                      WhatsApp updates
                    </a>
                  ) : null}
                </div>
              </>
            )}
          </div>

          <aside className="wh-rise wh-d2 min-w-0 overflow-hidden rounded-2xl border border-[var(--ca-slate-200)] bg-white shadow-soft">
            {cover ? (
              <div className="relative aspect-[16/9] w-full bg-[var(--ca-navy-900)]">
                <Image src={cover} alt="" fill priority sizes="(max-width: 1024px) 100vw, 480px" className="object-cover object-top" />
              </div>
            ) : null}
            <div className="p-4 sm:p-6">
              <div className="flex items-center gap-3 text-sm text-[var(--ca-slate-600)]">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--ca-slate-100)] text-[var(--ca-navy-800)]">
                  <Check size={14} aria-hidden="true" />
                </span>
                <span>Previous masterclass completed</span>
              </div>
              <div className="my-3 ml-3 h-px w-[calc(100%-0.75rem)] origin-left bg-[var(--ca-gold)] wh-line" aria-hidden="true" />
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ca-gold-dark)]">
                {next ? "Next live masterclass" : "Next session"}
              </p>
              {next && when ? (
                <div className="mt-3 flex items-end justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-heading text-3xl font-extrabold leading-none tracking-tight text-[var(--ca-navy-900)] sm:text-4xl">
                      {when.dayMonth}
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[var(--ca-navy-800)]">{when.weekday}</p>
                    <p className="mt-1 text-sm text-[var(--ca-slate-700)]">{when.time}</p>
                    <p className="mt-3 inline-flex rounded-full bg-[var(--ca-navy-900)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--ca-gold-soft)]">
                      Registration open
                    </p>
                  </div>
                  {portrait ? (
                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full ring-2 ring-[var(--ca-gold)] ring-offset-2 sm:h-20 sm:w-20">
                      <Image src={portrait} alt={host} fill sizes="80px" className="object-cover object-top" />
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 font-heading text-xl font-bold text-[var(--ca-navy-900)]">Date to be announced</p>
              )}
              {next ? (
                <p className="mt-4 line-clamp-2 text-sm leading-relaxed text-[var(--ca-slate-700)]">{next.title}</p>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
