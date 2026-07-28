import ChakraSVG from "./ChakraSVG";

/**
 * How many gold "knowledge motes" drift outward from the ambient Chakra. Each
 * mote's direction, distance, size, duration, peak opacity and negative delay
 * live in the `.hv2-mote:nth-child(n)` block in `app/globals.css` — keep the two
 * in sync. They are kept out of inline styles because as markup they added ~9.5KB
 * to every response (the RSC payload echoes them), roughly 45ms of transfer on a
 * 1.6Mbps link, whereas the stylesheet is already being fetched and is cached.
 */
const MOTE_COUNT = 18;

/**
 * Section-wide ambient backdrop for the Home V2 hero — a pure-CSS starfield over
 * the deep-navy space plus a large, semi-transparent, slowly-revolving gold
 * Ashoka Chakra near the top (reusing the same `ChakraSVG` motif), wrapped in a
 * warm gold bloom and a drifting field of gold knowledge-motes. Everything here
 * is LCP-safe (inline SVG + CSS only, no JS, no assets, no WebGL) and sits behind
 * every hero element. The cinematic focal point (framed portrait + hero Chakra,
 * incl. the lazy WebGL layer) lives in `HeroStageV2`, scoped around the portrait.
 */
export default function HeroBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-0" aria-hidden="true">
      <div className="hv2-stars" />

      {/* Revolving ambient Chakra watermark (slow CSS spin; static under
          prefers-reduced-motion). The bloom and the mote field are decorative
          siblings pinned to the same centre, painted behind the Chakra itself. */}
      <div className="hv2-chakra-ambient">
        <div className="hv2-chakra-aura" />
        <div className="hv2-chakra-motes">
          {Array.from({ length: MOTE_COUNT }, (_, i) => (
            <span key={i} className="hv2-mote" />
          ))}
        </div>
        <div className="hv2-chakra-ambient__spin">
          <ChakraSVG size={820} glow={false} strokeWidth={0.5} hubRadius={4} />
        </div>
      </div>
    </div>
  );
}
