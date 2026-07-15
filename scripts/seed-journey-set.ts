/**
 * One-off: seed the FULL journey set as ready DRAFTS in the LIVE DB. Safe +
 * idempotent: writes only draft graphs, never publishes, never flips a flag,
 * never sends. execution_mode stays 'off'.
 *   node --env-file=.env.local --import tsx scripts/seed-journey-set.ts
 */
import { seedLeadOnboarding, buildLeadOnboardingGraph, SEED_NAME } from "../lib/journey-automation/seedLeadOnboarding";
import { seedJourneySet, JOURNEY_DEFS } from "../lib/journey-automation/seedJourneySet";
import { listTemplateOptions } from "../lib/journey-automation/builderStore";
import { validateGraph } from "../lib/journey-automation/validate";
import type { BuilderGraph, AutomationTemplateOption } from "../types/journey-automation";

const SEED_ACTOR = { id: "system:seed", name: "System Seed", role: "system", isSuper: true };

function report(name: string, graph: BuilderGraph) {
  const rep = validateGraph(
    graph.nodes.map((n) => ({ node_key: n.node_key, type: n.type, config: n.config })),
    graph.edges.map((e) => ({ source: e.source, target: e.target, branch_label: e.branch_label })),
  );
  const pending = rep.issues.filter((i) => i.code === "sms_no_template");
  const other = rep.issues.filter((i) => i.level === "error" && i.code !== "sms_no_template");
  console.log(`\n=== ${name} ===`);
  console.log(`  validation: ${other.length === 0 ? "READY (pending templates only)" : `${other.length} blocking error(s)`}`);
  console.log(`  pending-DLT steps: ${pending.length}`);
  for (const i of pending) console.log(`    - ${i.message}`);
  for (const i of other) console.log(`    [BLOCKING] ${i.message}`);
}

async function main() {
  console.log("Seeding full journey set (drafts, execution off)…");
  const templates = await listTemplateOptions();
  console.log(`Approved DLT templates available: ${templates.length}`);
  const byKey = new Map(templates.map((t: AutomationTemplateOption) => [t.sms_template_id, t]));

  const lead = await seedLeadOnboarding(SEED_ACTOR);
  console.log(`\n${SEED_NAME}: ${lead.created ? `created ${lead.workflowId}` : `exists ${lead.workflowId} (draft re-synced)`}`);
  report(SEED_NAME, buildLeadOnboardingGraph(templates));

  const rest = await seedJourneySet(SEED_ACTOR);
  for (const r of rest) {
    console.log(`\n${r.name}: ${r.created ? `created ${r.workflowId}` : `exists ${r.workflowId} (draft re-synced)`}`);
    const def = JOURNEY_DEFS.find((d) => d.name === r.name)!;
    report(r.name, def.build(byKey));
  }
  console.log("\nAll journeys seeded as drafts. Nothing sends; flags remain OFF.");
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
