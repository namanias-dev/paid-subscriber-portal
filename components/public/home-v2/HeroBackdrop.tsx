/**
 * Section-wide ambient backdrop for the Home V2 hero — a pure-CSS starfield over
 * the deep-navy space. It is LCP-safe (no JS, no assets) and sits behind every
 * hero element. The cinematic focal point (framed portrait + gold Ashoka Chakra,
 * incl. the lazy WebGL layer) lives in `HeroStageV2`, scoped around the portrait.
 */
export default function HeroBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-0" aria-hidden="true">
      <div className="hv2-stars" />
    </div>
  );
}
