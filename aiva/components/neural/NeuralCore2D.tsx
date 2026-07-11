"use client";

import { AGENTS } from "@/lib/agents/registry";
import { activityByDomain, PULSE_HEX } from "@/lib/neural/graph";
import type { Pulse } from "@/lib/events/projection";

/** Accessible, GPU-free fallback for the Neural Core. Nodes = real agents; clickable; activity-aware. */
export default function NeuralCore2D({
  pulses,
  selected,
  onSelect,
}: {
  pulses: Pulse[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const R = 150;
  const cx = 200;
  const cy = 200;
  const n = AGENTS.length;
  const activity = activityByDomain(pulses);
  const recentColor = new Map<string, string>();
  for (const p of pulses) if (!recentColor.has(p.domain)) recentColor.set(p.domain, PULSE_HEX[p.color] || "#e8ecf6");

  return (
    <div className="relative mx-auto w-full max-w-[460px]">
      <svg viewBox="0 0 400 400" className="w-full" role="group" aria-label="AIVA agent network">
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
          const active = recentColor.get(a.id);
          const isSel = selected === a.id;
          const dim = !!selected && !isSel;
          const rad = 7 + Math.min(activity[a.id] || 0, 8) * 0.7 + (isSel ? 3 : 0);
          const lx = cx + (R + 22) * Math.cos(angle);
          const ly = cy + (R + 22) * Math.sin(angle);
          return (
            <g key={a.id} style={{ cursor: "pointer", opacity: dim ? 0.4 : 1 }} onClick={() => onSelect(a.id)} tabIndex={0} role="button" aria-label={`${a.name}: ${a.blurb}`}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke={active || "#1c2b52"} strokeWidth={active ? 1.6 : 0.8} opacity={active ? 0.8 : 0.4} />
              <circle cx={x} cy={y} r={rad} fill={a.color} opacity={0.92} stroke={isSel ? "#fff" : "none"} strokeWidth={isSel ? 2 : 0}>
                {active ? <animate attributeName="r" values={`${rad};${rad + 3};${rad}`} dur="2.2s" repeatCount="indefinite" /> : null}
              </circle>
              <text x={lx} y={ly + 3} textAnchor="middle" fontSize="9" fill="#aab6d6" fontFamily="Inter, sans-serif">
                {a.name}
              </text>
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
