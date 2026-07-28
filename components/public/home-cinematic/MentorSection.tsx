import Image from "next/image";
import { ArrowRight, Quote } from "lucide-react";
import type { AboutContent } from "@/lib/types";
import { DEFAULT_ABOUT } from "@/lib/homeDefaults";
import TrackedLink from "./TrackedLink";
import { EYEBROW_ON_LIGHT } from "./content";

/**
 * Naman Sir — editorial mentor section. SERVER component.
 *
 * Authority, not celebrity: a portrait at a respectful scale, the admin-authored
 * biography verbatim, and one clear next step. No hype adjectives, no "as seen
 * on" strip, no numbers of our own invention.
 *
 * COPY PROVENANCE: `about.mentor_body` is admin-authored in `site_settings`. We
 * fall back to nothing rather than to `DEFAULT_ABOUT`, because the committed
 * default contains claims ("9+ years", "thousands of aspirants") that nobody has
 * verified — the same reason the trust rail rejects code-default figures.
 *
 * THE PORTRAIT IS NEVER ALTERED: no filter, no crop that cuts the face, no
 * stylisation, no generated variant. It is rendered with `object-contain` inside
 * its frame so the aspect ratio is always preserved.
 */
export interface MentorSectionProps {
  about?: AboutContent;
  portraitUrl?: string | null;
  portraitAlt?: string;
  /** Where "Talk to Naman Sir's team" should go. */
  ctaHref: string;
}

function normalize(url?: string | null): string | undefined {
  const u = url?.trim();
  if (!u) return undefined;
  return u.replace(/^https?:\/\/namanias\.com\//i, "https://www.namanias.com/");
}

export default function MentorSection({ about, portraitUrl, portraitAlt, ctaHref }: MentorSectionProps) {
  const heading = about?.mentor_heading?.trim() || "Meet Naman Sir";

  // Only render the biography when the admin actually wrote one. An unedited
  // default is a seed value, not an editorial claim.
  const body = about?.mentor_body?.trim();
  const isDefaultBody = !body || body === DEFAULT_ABOUT.mentor_body?.trim();
  const paragraphs = isDefaultBody
    ? []
    : body
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);

  const quote = about?.mentor_quote?.trim();
  const portrait = normalize(portraitUrl);

  return (
    <section className="section container-wide" aria-labelledby="cinematic-mentor-heading">
      <div className="grid items-center gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-14">
        {portrait && (
          <div className="order-2 mx-auto w-full max-w-xs lg:order-1 lg:max-w-sm">
            <div className="relative overflow-hidden rounded-[24px] border border-[var(--ca-slate-200)] bg-[var(--ca-slate-50)] p-2">
              <Image
                src={portrait}
                alt={portraitAlt?.trim() || "Naman Sir"}
                width={520}
                height={640}
                sizes="(max-width: 1024px) 70vw, 340px"
                className="mx-auto h-auto w-full rounded-[18px] object-contain"
              />
            </div>
          </div>
        )}

        <div className="order-1 lg:order-2">
          <p className={EYEBROW_ON_LIGHT}>The mentor</p>
          <h2
            id="cinematic-mentor-heading"
            className="mt-3 font-heading text-3xl font-extrabold tracking-tight text-[var(--ca-navy-900)] sm:text-4xl"
          >
            {heading}
          </h2>

          {paragraphs.length > 0 ? (
            <div className="mt-5 space-y-4">
              {paragraphs.map((p, i) => (
                <p key={i} className="text-[15px] leading-relaxed text-[var(--ca-slate-700)] sm:text-base">
                  {p.replace(/^"|"$/g, "")}
                </p>
              ))}
            </div>
          ) : (
            // No admin biography on file. Say something true and general rather
            // than publishing the unverified committed default.
            <p className="mt-5 text-[15px] leading-relaxed text-[var(--ca-slate-700)] sm:text-base">
              Naman Sir teaches the General Studies core himself and mentors aspirants directly through Prelims, Mains and
              the interview. Small batches are a deliberate constraint, not a marketing line — they are what makes personal
              answer-writing feedback possible at all.
            </p>
          )}

          {quote && (
            <blockquote className="mt-6 border-l-2 border-[var(--ca-gold)] pl-4">
              <Quote size={16} className="mb-1.5 text-[var(--ca-gold)]" aria-hidden="true" />
              <p className="font-heading text-lg font-semibold italic text-[var(--ca-navy-900)]">{quote}</p>
            </blockquote>
          )}

          <div className="mt-7">
            <TrackedLink
              href={ctaHref}
              event="mentor_cta_clicked"
              props={{ href: ctaHref }}
              className="ca-btn ca-btn-outline ca-focus px-6"
            >
              Talk to the team <ArrowRight size={15} aria-hidden="true" />
            </TrackedLink>
          </div>
        </div>
      </div>
    </section>
  );
}
