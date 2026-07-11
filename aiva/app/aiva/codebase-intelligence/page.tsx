import { Card, SectionTitle } from "@/components/kit";

export const dynamic = "force-dynamic";

const REGISTRIES: { name: string; desc: string }[] = [
  { name: "ARCHITECTURE_MAP.md", desc: "Human-readable index: topology, stack, reuse boundary, app structure." },
  { name: "ROUTE_REGISTRY.json", desc: "Portal + AIVA route map with auth boundaries." },
  { name: "API_REGISTRY.json", desc: "Portal payment/webhook chokepoints + AIVA read APIs." },
  { name: "DB_SCHEMA_MAP.json", desc: "All tables by domain, key status enums, AIVA additive tables." },
  { name: "DOMAIN_MODEL_MAP.json", desc: "Each agent → real tables, source-of-truth functions, tools." },
  { name: "PAYMENT_STATE_MACHINE.json", desc: "Paid vs attempt vs abandoned; supersede; proofs; reconciliation rules." },
  { name: "ENROLLMENT_STATE_MACHINE.json", desc: "course_enrollments + legacy enrollments; access & grace." },
  { name: "ACTION_CATALOG.json", desc: "Allowlisted tools with risk + implemented/disabled state." },
  { name: "AGENT_TOOL_REGISTRY.json", desc: "Which tools each agent may invoke." },
  { name: "RISK_POLICY_MATRIX.json", desc: "Green/Amber/Red classification + v1 disabled flags." },
  { name: "EVENT_CATALOG.json", desc: "Canonical business_events + projection from existing tables." },
  { name: "DEPENDENCY_GRAPH.json", desc: "AIVA↔portal reuse graph (pure island only)." },
  { name: "CHANGE_IMPACT_RULES.json", desc: "Domain→file mapping + CI failure conditions for the sync script." },
];

export default function CodebaseIntelligencePage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-extrabold text-white">Codebase Intelligence</h1>
        <p className="text-sm text-muted">The registry that keeps every agent aware of how the portal actually works.</p>
      </div>
      <Card>
        <SectionTitle sub="Committed to docs/aiva/ in the repository. Updated by scripts/aiva-sync-codebase-intelligence.ts.">
          Registries
        </SectionTitle>
        <ul className="space-y-2">
          {REGISTRIES.map((r) => (
            <li key={r.name} className="rounded-xl border border-line bg-navy-700/30 p-3">
              <div className="font-mono text-sm text-white">{r.name}</div>
              <div className="text-sm text-muted">{r.desc}</div>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <SectionTitle>Incremental sync</SectionTitle>
        <p className="text-sm text-muted">
          On every push, the sync script reads the Git diff, determines affected domains, re-validates the
          relevant registries, and records a snapshot in <span className="font-mono">aiva_codebase_snapshots</span>.
          CI fails if a sensitive API changes without a registry update, a tool contract is stale, an approval rule
          is bypassed, or a migration breaks an agent query.
        </p>
      </Card>
    </div>
  );
}
