"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Device capability tiers for the cinematic preview.
 *
 *   A — desktop, real GPU, good connection      → full scene
 *   B — laptop/tablet, capable but not generous  → reduced particles, simpler lighting
 *   C — mobile / low-power                       → PRE-RENDERED 2D, no WebGL (see below)
 *   D — no WebGL / reduced-motion / save-data    → premium static 2D, zero WebGL
 *
 * ── WHY TIER C SHIPS NO WEBGL ───────────────────────────────────────────────
 * Measured on this build, the three.js + react-three-fiber runtime is ~212 KB
 * gzipped. Production `/` never pays that on a phone: its existing hero gate
 * rejects `(pointer: coarse)` outright. If tier C mounted a canvas, the preview
 * would put 212 KB of deferred JavaScript onto Indian mobile data in exchange for
 * decorative particles, on exactly the mid-tier Android hardware the LCP/INP gate
 * is measured against.
 *
 * That is a bad trade, so tier C gets the same premium CSS treatment as tier D
 * (layered gradients, the static gold radial motif, Framer Motion transitions)
 * and mounts zero WebGL. The tier is still reported separately in telemetry so
 * `cinematic_fallback_used` distinguishes "capable phone, we chose not to" from
 * "device cannot".
 *
 * `particles` and `dprCap` are retained on tier C so that raising it to a real
 * scene later is a one-line change, not a redesign.
 *
 * Tiering is deliberately NOT based on screen width. A 1280px-wide window on a
 * throttled mid-tier Android is tier C; a 1280px window on a workstation is tier
 * A. The signals we use are, in order of trust: an actual WebGL context probe,
 * `prefers-reduced-motion`, `save-data`, effective connection type, device
 * memory, logical core count, pointer type, and only then viewport size as a
 * weak tie-breaker.
 *
 * SSR CONTRACT: the first render is ALWAYS tier D. That is what makes the hero
 * headline and CTA server-rendered and interactive before any WebGL exists —
 * the real tier is resolved in an effect, after hydration, so nothing above the
 * fold depends on a client probe.
 */
export type Tier = "A" | "B" | "C" | "D";

export interface Capability {
  tier: Tier;
  /** Resolved after hydration. `false` during SSR and first paint. */
  resolved: boolean;
  /** May we mount ANY WebGL at all? False for tier D. */
  webgl: boolean;
  /** Device pixel ratio ceiling for a canvas. */
  dprCap: number;
  /** Particle budget the scenes scale against. */
  particles: number;
  reducedMotion: boolean;
  saveData: boolean;
  /** Populated for the QA/diagnostics table; never rendered to users. */
  reason: string;
}

const TIER_D: Capability = {
  tier: "D",
  resolved: false,
  webgl: false,
  dprCap: 1,
  particles: 0,
  reducedMotion: false,
  saveData: false,
  reason: "ssr-default",
};

const CapabilityContext = createContext<Capability>(TIER_D);

interface NavigatorLike extends Navigator {
  deviceMemory?: number;
  connection?: { saveData?: boolean; effectiveType?: string };
}

/** Probe a real WebGL context, then throw it away. Cheap and definitive. */
function probeWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") || c.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    // Release immediately so we never hold a context we are not rendering into.
    const lose = gl.getExtension("WEBGL_lose_context") as { loseContext(): void } | null;
    lose?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function detect(): Capability {
  if (typeof window === "undefined") return { ...TIER_D, reason: "no-window" };

  const mq = (q: string) => {
    try {
      return window.matchMedia(q).matches;
    } catch {
      return false;
    }
  };

  const reducedMotion = mq("(prefers-reduced-motion: reduce)");
  const nav = navigator as NavigatorLike;
  const saveData = !!nav.connection?.saveData;
  const effectiveType = nav.connection?.effectiveType || "";
  const slowNet = /(^|-)2g$/.test(effectiveType) || effectiveType === "slow-2g";
  const mem = typeof nav.deviceMemory === "number" ? nav.deviceMemory : 0;
  const cores = typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : 0;
  const coarse = mq("(pointer: coarse)");
  const hasWebGL = probeWebGL();

  // ---- Tier D: hard opt-outs. Any one of these is decisive. ----
  if (reducedMotion) return { ...TIER_D, resolved: true, reducedMotion, saveData, reason: "prefers-reduced-motion" };
  if (!hasWebGL) return { ...TIER_D, resolved: true, reducedMotion, saveData, reason: "no-webgl-context" };
  if (saveData) return { ...TIER_D, resolved: true, reducedMotion, saveData, reason: "save-data" };
  if (slowNet) return { ...TIER_D, resolved: true, reducedMotion, saveData, reason: `slow-network:${effectiveType}` };
  // A device that reports very little memory gets no WebGL at all.
  if (mem > 0 && mem < 2) return { ...TIER_D, resolved: true, reducedMotion, saveData, reason: `device-memory:${mem}` };

  const base = { resolved: true, webgl: true, reducedMotion, saveData };

  // ---- Tier C: touch-primary, or modest memory/cores, or 3g. ----
  // Deliberately `webgl: false` — see the tier C rationale in the module header.
  const modest = (mem > 0 && mem < 4) || (cores > 0 && cores < 4);
  if (coarse || modest || effectiveType === "3g") {
    return {
      ...base,
      tier: "C",
      webgl: false,
      dprCap: 1,
      particles: 90,
      reason: `tier-c-2d-by-design(coarse=${coarse},mem=${mem},cores=${cores},net=${effectiveType || "?"})`,
    };
  }

  // ---- Tier B: capable, but not a generous desktop. ----
  if ((mem > 0 && mem < 8) || (cores > 0 && cores < 8) || window.innerWidth < 1280) {
    return { ...base, tier: "B", dprCap: 1.5, particles: 220, reason: `mid(mem=${mem},cores=${cores},w=${window.innerWidth})` };
  }

  // ---- Tier A. ----
  return { ...base, tier: "A", dprCap: 2, particles: 420, reason: `full(mem=${mem},cores=${cores})` };
}

export function CapabilityProvider({ children }: { children: ReactNode }) {
  const [cap, setCap] = useState<Capability>(TIER_D);

  useEffect(() => {
    setCap(detect());

    // Re-resolve if the user flips reduced-motion mid-session.
    let mql: MediaQueryList | null = null;
    const onChange = () => setCap(detect());
    try {
      mql = window.matchMedia("(prefers-reduced-motion: reduce)");
      mql.addEventListener("change", onChange);
    } catch {
      mql = null;
    }
    return () => {
      try {
        mql?.removeEventListener("change", onChange);
      } catch {
        /* ignore */
      }
    };
  }, []);

  const value = useMemo(() => cap, [cap]);
  return <CapabilityContext.Provider value={value}>{children}</CapabilityContext.Provider>;
}

export function useCapability(): Capability {
  return useContext(CapabilityContext);
}

/**
 * True only when it is safe AND worthwhile to mount a WebGL canvas. Tier D never
 * mounts one; tiers A–C do, at their own budget.
 */
export function useWebGLAllowed(): boolean {
  const cap = useCapability();
  return cap.resolved && cap.webgl;
}
