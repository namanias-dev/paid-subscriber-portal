"use client";

/** Tiny inline SVG trend sparkline (no deps, no first-load cost). Values oldest→newest. */
export default function Sparkline({ values, label }: { values: number[]; label?: string }) {
  if (!values || values.length < 2) return null;
  const w = 160;
  const h = 36;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 4) - 2).toFixed(1)}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  const stroke = up ? "#34d399" : "#f87171";
  return (
    <div className="aiva-spark">
      {label ? <div className="aiva-label mb-1">{label}</div> : null}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label || "trend"}>
        <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </div>
  );
}
