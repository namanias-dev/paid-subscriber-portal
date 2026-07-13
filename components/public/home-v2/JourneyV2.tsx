import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { JOURNEY_V2 } from "./content";

/**
 * The aspirant's journey — the cinematic spine of Home V2. A glowing gold path
 * ascends from "confused beginner" to "officer", with milestone nodes for each
 * stage. Fully server-rendered (real headings + real internal links); the 3D
 * ascending-path visual (Phase C) will mount behind this as decoration only.
 */
export default function JourneyV2() {
  return (
    <section className="hv2-space relative overflow-hidden py-20 sm:py-28">
      <div className="hv2-stars" aria-hidden="true" />
      <div className="container-wide relative z-10">
        <div className="mx-auto max-w-2xl text-center">
          <p className="ca-eyebrow">The journey</p>
          <h2 className="mt-3 font-heading text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
            From confused beginner to <span className="hv2-gold-text">officer</span>
          </h2>
          <p className="mt-4 text-lg text-[var(--ca-slate-300)]">
            Every aspirant walks the same path. We make sure you never walk it alone — one clear ascent, milestone by milestone.
          </p>
        </div>

        <ol className="relative mx-auto mt-16 max-w-4xl">
          {/* The glowing spine */}
          <span
            className="hv2-spine-glow absolute left-[27px] top-2 bottom-2 w-[3px] rounded-full sm:left-1/2 sm:-ml-[1.5px]"
            aria-hidden="true"
          />

          {JOURNEY_V2.map((step, i) => {
            const Icon = step.icon;
            const left = i % 2 === 0;
            return (
              <li key={step.stage} className="relative mb-10 last:mb-0 sm:mb-14">
                <div className={`flex items-start gap-5 sm:w-1/2 ${left ? "sm:pr-14" : "sm:ml-auto sm:flex-row-reverse sm:pl-14"}`}>
                  {/* Node */}
                  <span className="hv2-node z-10 h-14 w-14 shrink-0" aria-hidden="true">
                    <Icon size={24} strokeWidth={2} />
                  </span>

                  {/* Card */}
                  <div className={`ca-glass flex-1 p-5 ${left ? "sm:text-right" : "sm:text-left"}`}>
                    <p className="ca-eyebrow">{step.stage}</p>
                    <h3 className="mt-1 font-heading text-xl font-bold text-white">{step.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-[var(--ca-slate-300)]">{step.desc}</p>
                    <Link
                      href={step.href}
                      className={`ca-focus mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[var(--ca-gold-bright)] hover:underline ${left ? "sm:flex-row-reverse" : ""}`}
                    >
                      Explore <ArrowRight size={14} aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
