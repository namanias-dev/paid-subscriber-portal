"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import SceneMount from "./SceneMount";
import { useCapability } from "./CapabilityProvider";
import { cinematic } from "./analytics";
import { JOURNEY_STAGES } from "./content";

const JourneyScene = dynamic(() => import("./scenes/JourneyScene"), { ssr: false });

/**
 * The UPSC Journey — the single scroll-driven scene.
 *
 * STRUCTURE: a tall section whose first child is a `sticky` visual band, followed
 * by six real `<li>` cards. The browser scrolls the page normally; the sticky band
 * stays in view while the cards pass through it. There is no wheel handler, no
 * `preventDefault`, no programmatic scrolling, and no scroll snapping — so the
 * back button, in-page anchors, keyboard PageDown and Safari's scroll restoration
 * all behave exactly as they do on any other page.
 *
 * ACCESSIBILITY: the six stages are a real ordered list with real headings and
 * real internal links, present in the server-rendered HTML. On tier D (or with JS
 * off) the sticky band is a static gradient and the list is the whole experience,
 * which is why nothing here is conveyed by the canvas alone.
 */
export default function JourneySection() {
  const cap = useCapability();
  const sectionRef = useRef<HTMLDivElement>(null);
  // Scroll progress lives in a ref, not state: the scene samples it inside
  // useFrame, so writing it must not trigger a React render.
  const progress = useRef(0);
  const [activeStage, setActiveStage] = useState(0);
  const seen = useRef<Set<number>>(new Set());

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    let raf = 0;
    const measure = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      if (total <= 0) {
        progress.current = 0;
        return;
      }
      const p = Math.min(1, Math.max(0, -rect.top / total));
      progress.current = p;
      const stage = Math.min(JOURNEY_STAGES.length - 1, Math.floor(p * JOURNEY_STAGES.length));
      setActiveStage((prev) => (prev === stage ? prev : stage));
    };

    const onScroll = () => {
      // Coalesce to one measurement per frame — reading layout on every scroll
      // event is the classic INP regression here.
      if (!raf) raf = requestAnimationFrame(measure);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    measure();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // One analytics event per stage, the first time it becomes active.
  useEffect(() => {
    if (seen.current.has(activeStage)) return;
    seen.current.add(activeStage);
    const s = JOURNEY_STAGES[activeStage];
    if (s) cinematic.journeyStage(activeStage, s.key);
  }, [activeStage]);

  return (
    <section ref={sectionRef} className="hv2-space relative" aria-labelledby="cinematic-journey-heading">
      {/* Sticky visual band. `sticky` keeps the page scroll native. */}
      <div className="pointer-events-none sticky top-0 h-screen w-full overflow-hidden">
        <div className="hv2-stars absolute inset-0" aria-hidden="true" />
        {/* CSS path + horizon. Always rendered, so tiers C and D (and a
            JS-disabled browser) get a finished-looking scene, and the canvas
            simply composites over it on tiers A and B. */}
        <div className="absolute inset-0" aria-hidden="true">
          <div
            className="absolute bottom-[32%] left-1/2 h-[52%] w-[70%] -translate-x-1/2"
            style={{
              background: "linear-gradient(0deg, rgba(232,191,88,0.20), transparent 88%)",
              clipPath: "polygon(41% 100%, 59% 100%, 52% 0%, 48% 0%)",
            }}
          />
          <div
            className="absolute inset-x-0 bottom-[32%] h-px"
            style={{ background: "linear-gradient(90deg,transparent,rgba(247,220,148,0.55),transparent)" }}
          />
          <div
            className="absolute inset-0"
            style={{ background: "radial-gradient(ellipse at 50% 68%, rgba(247,220,148,0.10), transparent 60%)" }}
          />
        </div>
        <SceneMount className="absolute inset-0" rootMargin="300px" particleScale={0.7}>
          {({ active, particles, dprCap, reduced }) => (
            <JourneyScene
              active={active}
              particles={particles}
              dprCap={dprCap}
              reduced={reduced}
              progress={progress}
            />
          )}
        </SceneMount>
        {/* Stage rail — a compact, non-interactive progress cue. */}
        <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-2" aria-hidden="true">
          {JOURNEY_STAGES.map((s, i) => (
            <span
              key={s.key}
              className="h-1 rounded-full transition-all duration-500"
              style={{
                width: i === activeStage ? 28 : 12,
                background: i <= activeStage ? "var(--ca-gold-bright)" : "rgba(255,255,255,0.22)",
              }}
            />
          ))}
        </div>
      </div>

      {/* The real content. Pulled up over the sticky band. */}
      <div className="container-wide relative z-10 -mt-[100vh]">
        <div className="mx-auto max-w-2xl pt-20 text-center sm:pt-28">
          <p className="ca-eyebrow">The journey</p>
          <h2
            id="cinematic-journey-heading"
            className="mt-3 font-heading text-3xl font-extrabold tracking-tight text-white sm:text-5xl"
          >
            Six stages, in the order they actually happen
          </h2>
          <p className="mt-4 text-base text-[var(--ca-slate-300)] sm:text-lg">
            Most aspirants lose a year by starting at stage two. Here is the whole route, and where you would join it.
          </p>
        </div>

        <ol className="mx-auto mt-16 max-w-2xl pb-24 sm:mt-24">
          {JOURNEY_STAGES.map((s, i) => {
            const Icon = s.icon;
            return (
              // Spacing is CSS-breakpoint driven, NOT tier driven: tight on
              // phones (where no canvas mounts, so tall gaps would just be empty
              // scrolling) and tall on desktop (where the gaps are what give the
              // camera room to travel). Because it never depends on the resolved
              // tier, the layout cannot shift after hydration.
              <li key={s.key} className="mb-6 last:mb-0 sm:mb-[38vh]">
                <div
                  className="ca-glass p-6 transition-opacity duration-500 sm:p-7"
                  style={{ opacity: cap.resolved && cap.webgl ? (i === activeStage ? 1 : 0.55) : 1 }}
                >
                  <div className="flex items-center gap-4">
                    <span className="hv2-node h-12 w-12 shrink-0" aria-hidden="true">
                      <Icon size={21} strokeWidth={2} />
                    </span>
                    <div>
                      <p className="ca-eyebrow">{s.stage}</p>
                      <h3 className="font-heading text-xl font-bold text-white sm:text-2xl">{s.title}</h3>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-[var(--ca-slate-300)] sm:text-base">{s.desc}</p>
                  <Link
                    href={s.href}
                    className="ca-focus mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--ca-gold-bright)] hover:underline"
                  >
                    Explore this stage <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
