"use client";

import { useEffect } from "react";

/**
 * Home V2 motion layer (Phase B) — Lenis smooth scroll + GSAP ScrollTrigger
 * reveals / stagger / parallax. Everything is:
 *   • page-scoped: Lenis is created on mount and destroyed on unmount, so the
 *     shared shell and every other route keep native scrolling.
 *   • progressive: markup is fully visible without JS; GSAP only enhances it.
 *   • reduced-motion aware: if the user prefers reduced motion we bail entirely
 *     and leave the static (already-painted) page untouched.
 *   • code-split: gsap + lenis are dynamically imported at runtime, so they are
 *     NOT part of the initial page bundle.
 *
 * The hero is intentionally NOT reveal-animated so LCP text paints immediately.
 */
export default function HomeV2Motion() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) return;
    // Very small / low-power hint: skip Lenis hijack on tiny touch screens where
    // native momentum scrolling feels better (GSAP reveals still run).
    let cancelled = false;

    // Loaded async so we can tear everything down cleanly.
    let cleanup: (() => void) | null = null;

    (async () => {
      const [lenisMod, gsapMod, stMod] = await Promise.all([
        import("lenis"),
        import("gsap"),
        import("gsap/ScrollTrigger"),
      ]);
      if (cancelled) return;

      const Lenis = lenisMod.default;
      const gsap = (gsapMod as unknown as { default?: typeof import("gsap").gsap }).default ?? gsapMod.gsap;
      const ScrollTrigger = stMod.ScrollTrigger ?? (stMod as unknown as { default: unknown }).default;
      gsap.registerPlugin(ScrollTrigger);

      const smallScreen = window.matchMedia("(max-width: 640px)").matches;

      let lenis: import("lenis").default | null = null;
      let tickerFn: ((time: number) => void) | null = null;

      if (!smallScreen) {
        lenis = new Lenis({
          duration: 1.05,
          easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
          smoothWheel: true,
        });
        lenis.on("scroll", ScrollTrigger.update);
        tickerFn = (time: number) => lenis!.raf(time * 1000);
        gsap.ticker.add(tickerFn);
        gsap.ticker.lagSmoothing(0);
      }

      const ctx = gsap.context(() => {
        // Fade-up reveals for standalone blocks.
        gsap.utils.toArray<HTMLElement>("[data-hv2-reveal]").forEach((el) => {
          gsap.from(el, {
            opacity: 0,
            y: 30,
            duration: 0.9,
            ease: "power3.out",
            scrollTrigger: { trigger: el, start: "top 88%", once: true },
          });
        });

        // Staggered children for card grids / lists.
        gsap.utils.toArray<HTMLElement>("[data-hv2-stagger]").forEach((group) => {
          const items = Array.from(group.children);
          if (!items.length) return;
          gsap.from(items, {
            opacity: 0,
            y: 26,
            duration: 0.7,
            ease: "power3.out",
            stagger: 0.09,
            scrollTrigger: { trigger: group, start: "top 85%", once: true },
          });
        });

        // Gentle parallax drift for decorative layers (scrubbed to scroll).
        gsap.utils.toArray<HTMLElement>("[data-hv2-parallax]").forEach((el) => {
          const speed = parseFloat(el.getAttribute("data-hv2-parallax") || "0.15");
          gsap.to(el, {
            yPercent: -speed * 100,
            ease: "none",
            scrollTrigger: { trigger: el.parentElement || el, start: "top bottom", end: "bottom top", scrub: true },
          });
        });

        ScrollTrigger.refresh();
      });

      cleanup = () => {
        ctx.revert();
        if (tickerFn) gsap.ticker.remove(tickerFn);
        lenis?.destroy();
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return null;
}
