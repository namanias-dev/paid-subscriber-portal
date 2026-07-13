import ChakraSVG from "./ChakraSVG";

/**
 * Section-wide ambient backdrop for the Home V2 hero — a pure-CSS starfield over
 * the deep-navy space plus a large, semi-transparent, slowly-revolving gold
 * Ashoka Chakra near the top (reusing the same `ChakraSVG` motif). Both are
 * LCP-safe (inline SVG + CSS only, no JS, no assets, no WebGL) and sit behind
 * every hero element. The cinematic focal point (framed portrait + hero Chakra,
 * incl. the lazy WebGL layer) lives in `HeroStageV2`, scoped around the portrait.
 */
export default function HeroBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-0" aria-hidden="true">
      <div className="hv2-stars" />

      {/* Revolving ambient Chakra watermark (slow CSS spin; static + lighter on
          mobile and under prefers-reduced-motion). */}
      <div className="hv2-chakra-ambient">
        <div className="hv2-chakra-ambient__spin">
          <ChakraSVG size={820} glow={false} strokeWidth={0.5} hubRadius={4} />
        </div>
      </div>
    </div>
  );
}
