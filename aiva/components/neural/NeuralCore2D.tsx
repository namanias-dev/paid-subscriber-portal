"use client";

import { AGENTS } from "@/lib/agents/registry";
import type { Pulse } from "@/lib/events/projection";

const COLOR: Record<string, string> = {
  green: "#16a34a",
  gold: "#f2c94c",
  red: "#dc2626",
  blue: "#38bdf8",
  purple: "#a855f7",
  orange: "#fb923c",
  white: "#e8ecf6",
};

/** Accessible, GPU-free fallback for the Neural Core. Nodes = real agents; recent pulses listed. */
export default function NeuralCore2D({ pulses }: { pulses: Pulse[] }) {
  const R = 150;
  const cx = 200;
  const cy = 200;
  const n = AGENTS.length;
  const recentByDomain = new Map<string, string>();
  for (const p of pulses) if (!recentByDomain.has(p.domain)) recentByDomain.set(p.domain, p.color);

  return (
    <div className="relative mx-auto w-full max-w-[420px]">
      <svg viewBox="0 0 400 400" className="w-full" role="img" aria-label="AIVA agent network">
        <defs>
          <radialGradient id="core2d" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f2c94c" />
            <stop offset="60%" stopColor="#0057ff" />
            <stop offset="100%" stopColor="#0b1f4d" />
          </radialGradient>
        </defs>
        {AGENTS.map((a, i) => {
          const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
          const x = cx + R * Math.cos(angle);
          const y = cy + R * Math.sin(angle);
          const active = recentByDomain.get(a.id);
          return (
            <g key={a.id}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke={active ? COLOR[active] : "#1c2b52"} strokeWidth={active ? 1.6 : 0.8} opacity={active ? 0.8 : 0.4} />
              <circle cx={x} cy={y} r={active ? 9 : 7} fill={a.color} opacity={0.9}>
                {active ? <animate attributeName="r" values="7;11;7" dur="2.2s" repeatCount="indefinite" /> : null}
              </circle>
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r={34} fill="url(#core2d)">
          <animate attributeName="r" values="32;37;32" dur="3s" repeatCount="indefinite" />
        </circle>
        <text x={cx} y={cy + 5} textAnchor="middle" fontSize="16" fontWeight="800" fill="#050d24" fontFamily="Sora, sans-serif">
          AIVA
        </text>
      </svg>
    </div>
  );
}
