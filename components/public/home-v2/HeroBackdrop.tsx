"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Compass } from "lucide-react";

// Heavy WebGL scene: ssr:false + lazy so three.js is a separate chunk that only
// loads at runtime on capable devices (never in SSR or the initial bundle).
const HeroCanvas = dynamic(() => import("./HeroCanvas"), { ssr: false });

/**
 * Decide whether to run the WebGL layer. Desktop, motion-allowed, decent
 * hardware, real WebGL support, no data-saver. Everything else falls back to the
 * pure-CSS starfield below — the "mobile / low-power light path".
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

/**
 * Hero backdrop: always renders the lightweight CSS starfield (guaranteed,
 * LCP-safe fallback). On capable desktops it additionally overlays the 3D
 * canvas AFTER the browser is idle (so hero text/CTA paint first), and pauses it
 * when the hero scrolls out of view.
 */
export default function HeroBackdrop() {
  const [show3d, setShow3d] = useState(false);
  const [active, setActive] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

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

  // Pause the render loop when the hero is not on screen.
  useEffect(() => {
    if (!show3d || !ref.current) return;
    const io = new IntersectionObserver(
      ([entry]) => setActive(entry.isIntersecting),
      { threshold: 0.05 },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [show3d]);

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 -z-0" aria-hidden="true">
      {/* Pure-CSS starfield fallback — dimmed once the richer 3D layer is up. */}
      <div className={`hv2-stars transition-opacity duration-700 ${show3d ? "opacity-25" : "opacity-100"}`} />

      {/* CSS compass motif — the light-path visual (mobile / low-power / reduced
          motion). Replaced by the glowing 3D compass on capable desktops. */}
      <div
        className={`absolute -right-24 top-8 hidden opacity-70 transition-opacity duration-700 sm:block lg:right-[6%] ${show3d ? "opacity-0" : "opacity-70"}`}
        data-hv2-parallax="0.18"
      >
        <div className="hv2-float relative h-[340px] w-[340px]">
          <div className="hv2-spin absolute inset-0">
            <Compass className="h-full w-full text-[var(--ca-gold)]" strokeWidth={0.4} />
          </div>
          <div className="hv2-spin--rev absolute inset-[22%] rounded-full border border-[rgba(242,201,76,0.35)]" />
          <div className="absolute inset-0 rounded-full" style={{ boxShadow: "0 0 120px 20px rgba(242,201,76,0.18)" }} />
        </div>
      </div>

      {show3d && <HeroCanvas active={active} />}
    </div>
  );
}
