import { ArrowRight, MessageCircle } from "lucide-react";
import LeadForm from "@/components/public/LeadForm";
import type { HeroOffers } from "@/lib/homeCinematic/offers";
import { rupees } from "@/lib/homeCinematic/offers";
import TrackedLink from "./TrackedLink";

/**
 * Final cinematic CTA — the horizon.
 *
 * The "glowing path resolving to a distant institutional horizon" is rendered
 * here in pure CSS: layered radial/linear gradients plus a colonnade of thin
 * vertical rules. This is a DELIBERATE budget decision, not an omission — see the
 * note in `CinematicHome.tsx`. A third WebGL context at the very bottom of a long
 * page would buy almost nothing visually while adding a third context, a third
 * dispose path and more GPU pressure on exactly the mid-tier Android devices this
 * page is judged on.
 *
 * The lead form is the SHARED `LeadForm` component, unmodified, with the same
 * `source`/`campaign` props the live homepage uses — so it posts to the same
 * endpoint, fires the same events and lands in the CRM identically.
 */
export interface FinalCtaProps {
  offers: HeroOffers;
  heading: string;
  sub: string;
  waLink: string | null;
}

export default function FinalCta({ offers, heading, sub, waLink }: FinalCtaProps) {
  const mc = offers.masterclass;

  return (
    <section className="section container-x" aria-labelledby="cinematic-final-heading">
      <div className="relative overflow-hidden rounded-[28px] px-6 py-14 sm:px-10 sm:py-20">
        {/* ---- CSS horizon. Purely decorative, zero JS, zero WebGL. ---- */}
        <div className="absolute inset-0" aria-hidden="true" style={{ background: "linear-gradient(180deg,#050d24 0%,#0a1a3f 55%,#102a5c 100%)" }} />
        <div
          className="absolute inset-x-0 bottom-[38%] h-px"
          aria-hidden="true"
          style={{ background: "linear-gradient(90deg,transparent,rgba(247,220,148,0.75),transparent)" }}
        />
        {/* Colonnade suggestion — abstract, not a specific building. */}
        <div className="absolute inset-x-0 bottom-[38%] flex justify-center gap-[3.2%] px-[12%]" aria-hidden="true">
          {Array.from({ length: 11 }).map((_, i) => (
            <span
              key={i}
              className="h-10 w-px sm:h-14"
              style={{
                background: "linear-gradient(180deg,rgba(232,191,88,0.32),transparent)",
                transform: `translateY(-100%) scaleY(${0.55 + Math.abs(5 - i) * 0.09})`,
                transformOrigin: "bottom",
              }}
            />
          ))}
        </div>
        {/* The rising path, converging on the horizon. */}
        <div
          className="absolute bottom-0 left-1/2 h-[38%] w-[64%] -translate-x-1/2"
          aria-hidden="true"
          style={{
            background: "linear-gradient(0deg, rgba(232,191,88,0.16), transparent 82%)",
            clipPath: "polygon(38% 100%, 62% 100%, 53% 0%, 47% 0%)",
          }}
        />
        <div
          className="absolute inset-0"
          aria-hidden="true"
          style={{ background: "radial-gradient(ellipse at 50% 62%, rgba(247,220,148,0.14), transparent 58%)" }}
        />

        <div className="relative z-10 mx-auto max-w-3xl text-center">
          <h2
            id="cinematic-final-heading"
            className="font-heading text-3xl font-extrabold tracking-tight text-white sm:text-[2.75rem] sm:leading-tight"
          >
            {heading}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[var(--ca-slate-300)]">{sub}</p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <TrackedLink
              href={mc ? mc.href : "/courses"}
              event="final_cta_clicked"
              props={{ slug: mc?.slug ?? "courses" }}
              className="ca-btn ca-btn-gold ca-focus w-full justify-center px-7 text-base sm:w-auto"
            >
              {mc && mc.price != null ? `Start with the ${rupees(mc.price)} masterclass` : "See what is open now"}
              <ArrowRight size={17} aria-hidden="true" />
            </TrackedLink>

            {waLink && (
              <TrackedLink
                href={waLink}
                event="whatsapp_clicked"
                props={{ surface: "final_cta" }}
                className="ca-btn ca-btn-glass ca-focus w-full justify-center px-7 text-base sm:w-auto"
              >
                <MessageCircle size={16} aria-hidden="true" /> Ask on WhatsApp
              </TrackedLink>
            )}
          </div>
        </div>

        {/* Counselling form — the shared component, unmodified. */}
        <div className="relative z-10 mx-auto mt-12 max-w-xl rounded-2xl bg-white/95 p-6 shadow-2xl backdrop-blur">
          <LeadForm source="Website" campaign="Home Counselling" compact />
        </div>
      </div>
    </section>
  );
}
