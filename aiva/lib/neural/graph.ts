import { AGENTS } from "@/lib/agents/registry";
import type { Pulse } from "@/lib/events/projection";

/**
 * Pure geometry + activity helpers for the Neural Core. No Three.js / React here so the
 * layout is deterministic, testable, and shared by both the 3D brain and the 2D fallback.
 */

export type Vec3 = [number, number, number];

/**
 * Deterministic fibonacci-sphere layout — organic "brain" spread, but stable across renders
 * so a node never jumps between frames. Keyed by agent id.
 */
export function nodeLayout(radius = 2.8): Record<string, Vec3> {
  const map: Record<string, Vec3> = {};
  const n = AGENTS.length;
  const golden = Math.PI * (3 - Math.sqrt(5));
  AGENTS.forEach((a, i) => {
    const y = n > 1 ? 1 - (i / (n - 1)) * 2 : 0; // 1 .. -1
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * golden;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    map[a.id] = [x * radius, y * radius, z * radius];
  });
  return map;
}

/** Count of recent pulses per domain — drives node glow / edge activity intensity. */
export function activityByDomain(pulses: Pulse[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of AGENTS) out[a.id] = 0;
  for (const p of pulses) {
    if (p.domain in out) out[p.domain] += 1;
    else out[p.domain] = 1;
  }
  return out;
}

function dist(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * "Synapse" edges connecting each node to its nearest neighbours, forming a brain-like mesh.
 * Deterministic and de-duplicated (a<->b listed once).
 */
export function synapseEdges(neighbors = 2): [string, string][] {
  const layout = nodeLayout();
  const ids = AGENTS.map((a) => a.id);
  const seen = new Set<string>();
  const edges: [string, string][] = [];
  for (const id of ids) {
    const near = ids
      .filter((o) => o !== id)
      .map((o) => ({ o, d: dist(layout[id], layout[o]) }))
      .sort((x, y) => x.d - y.d)
      .slice(0, neighbors);
    for (const { o } of near) {
      const key = [id, o].sort().join("::");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([id, o]);
    }
  }
  return edges;
}

/** Human summary counts from the recent pulse window (real events only, no fabrication). */
export function pulseSummary(pulses: Pulse[]): { paid: number; webinar: number; leads: number; proofs: number } {
  let paid = 0;
  let webinar = 0;
  let leads = 0;
  let proofs = 0;
  for (const p of pulses) {
    if (p.event_type === "payment.paid" || p.event_type === "installment.paid") paid += 1;
    else if (p.event_type === "webinar.registered") webinar += 1;
    else if (p.event_type === "lead.created") leads += 1;
    else if (p.event_type === "payment.proof_uploaded") proofs += 1;
  }
  return { paid, webinar, leads, proofs };
}

export const PULSE_HEX: Record<string, string> = {
  green: "#16a34a",
  gold: "#f2c94c",
  red: "#dc2626",
  blue: "#38bdf8",
  purple: "#a855f7",
  orange: "#fb923c",
  white: "#e8ecf6",
};
