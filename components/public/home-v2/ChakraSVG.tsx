/**
 * Home V2 — dignified gold Ashoka-Chakra rendered as pure SVG.
 *
 * This is an INSPIRED-BY treatment (accurate 24 evenly-spaced spokes, true circle
 * rim + hub) built procedurally in the navy+gold `ca-*` language — it is NOT a
 * reproduction of the official State Emblem. It powers the mobile / low-power /
 * reduced-motion "light path" behind the hero portrait and the small national
 * seal medallion. Never distorted: the viewBox is square and spokes are uniform.
 */
export default function ChakraSVG({
  size = 320,
  className = "",
  spin = false,
  strokeWidth = 0.7,
  hubRadius = 5,
  glow = true,
}: {
  size?: number;
  className?: string;
  spin?: boolean;
  strokeWidth?: number;
  hubRadius?: number;
  glow?: boolean;
}) {
  const spokes = Array.from({ length: 24 });
  const gold = "var(--ca-gold, #c9a227)";
  const goldBright = "var(--ca-gold-bright, #f2c94c)";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`${spin ? "hv2-spin" : ""} ${className}`}
      aria-hidden="true"
      style={glow ? { filter: "drop-shadow(0 0 6px rgba(242,201,76,0.45))" } : undefined}
    >
      {/* Outer rim */}
      <circle cx="50" cy="50" r="47" fill="none" stroke={gold} strokeWidth={strokeWidth * 1.4} />
      <circle cx="50" cy="50" r="44" fill="none" stroke={goldBright} strokeWidth={strokeWidth * 0.6} opacity={0.6} />
      {/* Hub */}
      <circle cx="50" cy="50" r={hubRadius} fill="none" stroke={gold} strokeWidth={strokeWidth} />
      <circle cx="50" cy="50" r={hubRadius * 0.4} fill={goldBright} />
      {/* 24 uniform spokes from hub to rim */}
      {spokes.map((_, i) => {
        const a = (i * 360) / 24;
        return (
          <line
            key={i}
            x1="50"
            y1={50 - hubRadius}
            x2="50"
            y2="6"
            stroke={gold}
            strokeWidth={strokeWidth}
            transform={`rotate(${a} 50 50)`}
          />
        );
      })}
    </svg>
  );
}
