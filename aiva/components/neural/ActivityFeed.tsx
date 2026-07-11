"use client";

import { timeAgo } from "@/components/kit";
import { PULSE_HEX, pulseSummary } from "@/lib/neural/graph";
import { agentById } from "@/lib/agents/registry";
import type { Pulse } from "@/lib/events/projection";

/** Live activity feed woven beside the brain. Real events only; newest first. */
export default function ActivityFeed({
  pulses,
  loading,
  collected,
  onSelect,
}: {
  pulses: Pulse[];
  loading: boolean;
  collected?: number;
  onSelect: (id: string) => void;
}) {
  const s = pulseSummary(pulses);
  const chips: { label: string; tone: string }[] = [];
  if (typeof collected === "number") chips.push({ label: `₹${Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(collected)} collected`, tone: "#16a34a" });
  if (s.webinar > 0) chips.push({ label: `${s.webinar} webinar reg${s.webinar > 1 ? "s" : ""}`, tone: "#38bdf8" });
  if (s.paid > 0) chips.push({ label: `${s.paid} payment${s.paid > 1 ? "s" : ""}`, tone: "#16a34a" });
  if (s.leads > 0) chips.push({ label: `${s.leads} new lead${s.leads > 1 ? "s" : ""}`, tone: "#f2c94c" });
  if (s.proofs > 0) chips.push({ label: `${s.proofs} proof${s.proofs > 1 ? "s" : ""} pending`, tone: "#fb923c" });

  return (
    <div className="neural-feed">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="neural-live-dot" />
          <span className="aiva-label">Live activity</span>
        </div>
        <span className="text-xs text-muted">{loading ? "syncing…" : `${pulses.length} events · updates ~20s`}</span>
      </div>

      {chips.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c.label} className="aiva-chip border-line text-ink">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: c.tone }} /> {c.label}
            </span>
          ))}
        </div>
      ) : null}

      <ul className="neural-feed-list">
        {pulses.slice(0, 16).map((p, i) => {
          const agent = agentById(p.domain);
          return (
            <li
              key={p.id}
              className={`neural-feed-item ${i === 0 ? "just-in" : ""}`}
              onClick={() => agent && onSelect(agent.id)}
              style={{ cursor: agent ? "pointer" : "default" }}
            >
              <span className="neural-feed-dot" style={{ background: PULSE_HEX[p.color] || "#e8ecf6" }} />
              <span className="neural-feed-label">{p.label}</span>
              <span className="neural-feed-meta">
                {agent?.name || p.domain} · {timeAgo(p.occurred_at)}
              </span>
            </li>
          );
        })}
        {!loading && pulses.length === 0 ? <li className="text-sm text-muted">No recent activity in the current window.</li> : null}
      </ul>
    </div>
  );
}
