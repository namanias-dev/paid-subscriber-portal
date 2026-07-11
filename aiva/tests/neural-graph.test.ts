import { describe, it, expect } from "vitest";
import { nodeLayout, activityByDomain, synapseEdges, pulseSummary } from "@/lib/neural/graph";
import { AGENTS } from "@/lib/agents/registry";
import type { Pulse } from "@/lib/events/projection";

function pulse(event_type: string, domain: string): Pulse {
  return { id: `${event_type}:${Math.random()}`, event_type, domain: domain as never, color: "green", occurred_at: new Date().toISOString(), label: event_type };
}

describe("neural graph layout", () => {
  it("returns one position per agent, within the sphere radius", () => {
    const layout = nodeLayout(2.8);
    expect(Object.keys(layout)).toHaveLength(AGENTS.length);
    for (const a of AGENTS) {
      const [x, y, z] = layout[a.id];
      const r = Math.sqrt(x * x + y * y + z * z);
      expect(r).toBeLessThanOrEqual(2.8 + 1e-6);
      expect(r).toBeGreaterThan(0);
    }
  });

  it("is deterministic across calls", () => {
    expect(nodeLayout()).toEqual(nodeLayout());
  });
});

describe("activityByDomain", () => {
  it("counts pulses per domain and zero-fills known agents", () => {
    const a = activityByDomain([pulse("payment.paid", "revenue"), pulse("payment.paid", "revenue"), pulse("lead.created", "admissions")]);
    expect(a.revenue).toBe(2);
    expect(a.admissions).toBe(1);
    expect(a.security).toBe(0);
  });
});

describe("synapseEdges", () => {
  it("produces de-duplicated undirected edges", () => {
    const edges = synapseEdges(2);
    expect(edges.length).toBeGreaterThan(0);
    const keys = edges.map(([a, b]) => [a, b].sort().join("::"));
    expect(new Set(keys).size).toBe(keys.length);
    for (const [a, b] of edges) expect(a).not.toBe(b);
  });
});

describe("pulseSummary", () => {
  it("tallies real event categories only", () => {
    const s = pulseSummary([
      pulse("payment.paid", "revenue"),
      pulse("webinar.registered", "admissions"),
      pulse("webinar.registered", "admissions"),
      pulse("lead.created", "admissions"),
      pulse("payment.proof_uploaded", "revenue"),
      pulse("course.viewed", "admissions"),
    ]);
    expect(s).toEqual({ paid: 1, webinar: 2, leads: 1, proofs: 1 });
  });
});
