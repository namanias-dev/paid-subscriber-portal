"use client";

import dynamic from "next/dynamic";
import SceneMount from "./SceneMount";

/**
 * The hero's WebGL layer, isolated behind `ssr: false` so three.js lands in its
 * own async chunk that is never part of the route's first load and never part of
 * the global layout bundle.
 */
const HeroScene = dynamic(() => import("./scenes/HeroScene"), { ssr: false });

/**
 * Static gold radial motif used on tier D and until WebGL mounts. Pure CSS, so it
 * costs nothing and there is never a frame where the hero looks unfinished.
 */
function StaticMotif() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div
        className="absolute left-1/2 top-1/2 h-[560px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-70"
        style={{
          background:
            "radial-gradient(closest-side, rgba(232,191,88,0.16), rgba(232,191,88,0.05) 55%, transparent 72%)",
        }}
      />
      <div className="absolute left-1/2 top-1/2 h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(232,191,88,0.22)]" />
      <div className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[rgba(232,191,88,0.12)]" />
    </div>
  );
}

export default function HeroSceneLayer() {
  return (
    <SceneMount
      className="pointer-events-none absolute inset-0"
      fallback={<StaticMotif />}
      rootMargin="0px"
      particleScale={1}
    >
      {({ active, particles, dprCap, reduced }) => (
        <HeroScene active={active} particles={particles} dprCap={dprCap} reduced={reduced} />
      )}
    </SceneMount>
  );
}
