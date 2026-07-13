"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { motion, useReducedMotion, useMotionValue, useSpring, useTransform, useScroll, type MotionValue } from "framer-motion";
import ChakraSVG from "./ChakraSVG";

// Heavy WebGL scene: ssr:false + lazy so three.js is a separate chunk that only
// loads at runtime on capable desktops (never in SSR or the initial bundle).
const HeroCanvas = dynamic(() => import("./HeroCanvas"), { ssr: false });

/**
 * Decide whether to run the WebGL layer. Desktop, motion-allowed, decent
 * hardware, real WebGL support, no data-saver. Everything else falls back to the
 * static gold-Chakra "light path" behind the portrait.
 */
function canUse3D(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    if (window.matchMedia("(max-width: 768px)").matches) return false;
    if (window.matchMedia("(pointer: coarse)").matches) return false;
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    if (typeof nav.deviceMemory === "number" && nav.deviceMemory > 0 && nav.deviceMemory < 4) return false;
    if (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency < 4) return false;
    if (nav.connection?.saveData) return false;
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return false;
  } catch {
    return false;
  }
  return true;
}

/** Small IPS-insignia inspired gold star accent (pure SVG). */
function StarAccent({ className, size = 26 }: { className?: string; size?: number }) {
  const pts: string[] = [];
  const outer = 12;
  const inner = 4.8;
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    pts.push(`${(Math.cos(a) * r + 12).toFixed(2)},${(Math.sin(a) * r + 12).toFixed(2)}`);
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <polygon points={pts.join(" ")} fill="var(--ca-gold-bright, #f2c94c)" opacity={0.85} />
    </svg>
  );
}

/**
 * Home V2 hero stage — the luminous focal point. Naman Sir's admin-uploaded
 * portrait is framed in a floating glass / gold-rimmed panel over deep-navy
 * space, with a soft cinematic key-light, subtle mouse-tilt + scroll parallax,
 * and a national-seal medallion. Behind it a gold Ashoka Chakra glows:
 *   • Always: a static SVG Chakra + concentric rings (the mobile / low-power /
 *     reduced-motion "light path").
 *   • Capable desktops only: a lazy WebGL scene mounts AFTER idle (so the
 *     portrait + text paint first) and the static Chakra fades back.
 * The portrait is a `priority` next/image so it is the LCP element.
 */
export default function HeroStageV2({ src, alt }: { src: string; alt: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [show3d, setShow3d] = useState(false);
  const [active, setActive] = useState(true);

  // Mouse tilt (desktop). Values normalised to [-0.5, 0.5].
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rotateX = useSpring(useTransform(my, [-0.5, 0.5], [6, -6]), { stiffness: 150, damping: 18 });
  const rotateY = useSpring(useTransform(mx, [-0.5, 0.5], [-6, 6]), { stiffness: 150, damping: 18 });

  // Scroll parallax — gentle vertical drift as the section moves through view.
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const parallaxY = useSpring(useTransform(scrollYProgress, [0, 1], [-24, 24]), { stiffness: 120, damping: 24 });
  const chakraY = useSpring(useTransform(scrollYProgress, [0, 1], [30, -30]), { stiffness: 90, damping: 24 });

  const zero = useMotionValue(0);
  const tiltX: MotionValue<number> = reduce ? zero : rotateX;
  const tiltY: MotionValue<number> = reduce ? zero : rotateY;
  const driftY: MotionValue<number> = reduce ? zero : parallaxY;
  const chakraDrift: MotionValue<number> = reduce ? zero : chakraY;

  // Mount the WebGL layer only on capable desktops, after the browser is idle.
  useEffect(() => {
    if (!canUse3D()) return;
    type IdleWin = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const w = window as IdleWin;
    let idleId: number | undefined;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const start = () => setShow3d(true);
    if (typeof w.requestIdleCallback === "function") {
      idleId = w.requestIdleCallback(start, { timeout: 2500 });
    } else {
      timerId = setTimeout(start, 1200);
    }
    return () => {
      if (idleId !== undefined && typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(idleId);
      if (timerId) clearTimeout(timerId);
    };
  }, []);

  // Pause the render loop when the hero scrolls out of view.
  useEffect(() => {
    if (!show3d || !ref.current) return;
    const io = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting), { threshold: 0.05 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [show3d]);

  function onMove(e: React.MouseEvent) {
    if (reduce) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  }
  function onLeave() {
    mx.set(0);
    my.set(0);
  }

  // Bottom-fade mask so the shoulders melt into the panel (transparent-PNG safe).
  const feather = "linear-gradient(to bottom, #000 74%, rgba(0,0,0,0.5) 90%, transparent 100%)";

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className="relative mx-auto mt-4 w-full max-w-sm lg:mt-0 lg:max-w-md"
      style={{ perspective: 1200 }}
    >
      {/* ---- Backdrop layer: Chakra glow behind the portrait ---- */}
      <div className="pointer-events-none absolute inset-0 -z-0 overflow-visible" aria-hidden="true">
        {/* Cinematic key-light behind the head/shoulders */}
        <div
          className="absolute left-1/2 top-[6%] h-[78%] w-[86%] -translate-x-1/2 rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, rgba(242,201,76,0.22), rgba(28,58,110,0.28) 55%, transparent)" }}
        />

        {/* Static gold Chakra (the light path). Fades back once WebGL is up. */}
        <motion.div
          style={{ y: chakraDrift }}
          className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-700 ${show3d ? "opacity-0" : "opacity-100"}`}
        >
          <div className="relative">
            <ChakraSVG size={420} spin={!reduce} />
            {/* Concentric wireframe rings */}
            <div className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(242,201,76,0.18)]" />
            <div className="absolute left-1/2 top-1/2 h-[620px] w-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(242,201,76,0.10)]" />
          </div>
        </motion.div>

        {/* WebGL Chakra scene — capable desktops only, after idle. */}
        {show3d && (
          <div className="absolute left-1/2 top-1/2 h-[720px] w-[720px] -translate-x-1/2 -translate-y-1/2">
            <HeroCanvas active={active} />
          </div>
        )}
      </div>

      {/* ---- Foreground: framed portrait panel ---- */}
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        style={{ rotateX: tiltX, rotateY: tiltY, y: driftY, transformStyle: "preserve-3d" }}
        className="relative z-10 will-change-transform"
      >
        <div
          className="relative overflow-hidden rounded-[28px] border border-[rgba(242,201,76,0.35)] p-3 backdrop-blur-xl"
          style={{
            background: "linear-gradient(160deg, rgba(28,58,110,0.55), rgba(11,20,38,0.65))",
            boxShadow: "0 30px 90px -30px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 60px -18px rgba(242,201,76,0.35)",
          }}
        >
          {/* Gold rim highlight */}
          <div
            className="pointer-events-none absolute inset-0 rounded-[28px]"
            style={{ boxShadow: "inset 0 0 0 1px rgba(242,201,76,0.25)" }}
            aria-hidden="true"
          />
          <Image
            src={src}
            alt={alt}
            width={620}
            height={760}
            priority
            sizes="(max-width: 1024px) 80vw, 440px"
            className="mx-auto h-auto w-full max-h-[420px] object-contain sm:max-h-[520px] lg:max-h-[560px]"
            style={{ WebkitMaskImage: feather, maskImage: feather }}
          />

          {/* Corner IPS-star accents */}
          <StarAccent className="absolute right-4 top-4" size={24} />
          <StarAccent className="absolute left-4 top-10 opacity-70" size={16} />
        </div>

        {/* National-seal medallion — inspired-by (Chakra + motto), dignified. */}
        <div className="absolute -bottom-5 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full border border-[rgba(242,201,76,0.5)] backdrop-blur-md"
            style={{
              background: "radial-gradient(closest-side, rgba(28,58,110,0.9), rgba(11,20,38,0.95))",
              boxShadow: "0 0 24px -6px rgba(242,201,76,0.5)",
            }}
          >
            <ChakraSVG size={40} spin={!reduce} glow={false} strokeWidth={1} hubRadius={7} />
          </div>
          <span className="mt-1.5 text-[11px] font-semibold text-[var(--ca-gold-bright)]" lang="sa">
            सत्यमेव जयते
          </span>
        </div>
      </motion.div>
    </div>
  );
}
