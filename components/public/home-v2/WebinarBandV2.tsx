import Link from "next/link";
import { ArrowRight, CalendarClock, Users } from "lucide-react";
import { webinarRegCountDisplay, WEBINAR_REGCOUNT_ENCOURAGE } from "@/lib/webinarLifecycle";
import type { Webinar, HomeContent } from "@/lib/types";

/**
 * Webinar / demo conversion band (V2). Live upcoming webinars + honest
 * registration counts on the left card list; the CTA copy comes from admin
 * content. When there are no upcoming webinars it still renders a clean premium
 * band with the primary/secondary CTAs — never a broken/empty box.
 */
export default function WebinarBandV2({
  content: c,
  upcoming,
  regCounts,
}: {
  content: HomeContent;
  upcoming: Webinar[];
  regCounts: Map<string, number>;
}) {
  return (
    <section className="section">
      <div className="container-wide">
        <div className="hv2-space relative overflow-hidden rounded-[28px] p-8 sm:p-12">
          <div className="hv2-stars" aria-hidden="true" />
          <div className="relative z-10 grid items-center gap-8 lg:grid-cols-2" data-hv2-reveal>
            <div>
              <h2 className="font-heading text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{c.band_heading}</h2>
              <p className="mt-3 max-w-md text-[var(--ca-slate-300)]">{c.band_subtext}</p>
              <div className="mt-7 flex flex-wrap gap-3">
                {c.band_primary_label && (
                  <Link href={c.band_primary_href || "#"} className="ca-btn ca-btn-gold ca-focus px-6">
                    {c.band_primary_label} <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                )}
                {c.band_secondary_label && (
                  <Link href={c.band_secondary_href || "#"} className="ca-btn ca-btn-glass ca-focus px-6">
                    {c.band_secondary_label}
                  </Link>
                )}
              </div>
            </div>

            <div className="grid gap-3">
              {upcoming.length > 0 ? (
                upcoming.map((w) => {
                  const rd = webinarRegCountDisplay({
                    count: regCounts.get(w.id) ?? 0,
                    showToggle: w.show_registration_count,
                    completed: w.status === "completed",
                  });
                  return (
                    <Link key={w.id} href={`/webinars/${w.slug}`} className="ca-glass ca-focus group flex items-center gap-4 p-4">
                      <span className="ca-icon-chip shrink-0">
                        <CalendarClock size={20} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-white">{w.title}</span>
                        {rd.mode === "count" ? (
                          <span className="mt-0.5 inline-flex items-center gap-1 text-sm text-[var(--ca-slate-400)]">
                            <Users size={13} aria-hidden="true" /> {rd.count.toLocaleString("en-IN")} registered
                          </span>
                        ) : rd.mode === "encourage" ? (
                          <span className="mt-0.5 block text-sm text-[var(--ca-slate-400)]">{WEBINAR_REGCOUNT_ENCOURAGE}</span>
                        ) : null}
                      </span>
                      <ArrowRight size={16} className="shrink-0 text-[var(--ca-gold-bright)] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                    </Link>
                  );
                })
              ) : (
                <div className="ca-glass p-6 text-center">
                  <span className="ca-icon-chip mx-auto mb-3 flex">
                    <CalendarClock size={20} aria-hidden="true" />
                  </span>
                  <p className="font-heading text-lg font-bold text-white">Free sessions, regularly</p>
                  <p className="mt-1 text-sm text-[var(--ca-slate-400)]">
                    New masterclasses and demos are announced often. Book a demo to get notified first.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
