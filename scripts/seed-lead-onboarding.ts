/**
 * One-off: seed the "New Lead Onboarding" workflow as a ready DRAFT in the LIVE
 * DB. Safe + idempotent: writes only a draft graph, never publishes, never flips
 * a flag, never sends. execution_mode stays 'off'.
 *   node --env-file=.env.local --import tsx scripts/seed-lead-onboarding.ts
 */
import { seedLeadOnboarding } from "../lib/journey-automation/seedLeadOnboarding";
import { validateGraph } from "../lib/journey-automation/validate";
import { buildLeadOnboardingGraph } from "../lib/journey-automation/seedLeadOnboarding";
import { listTemplateOptions } from "../lib/journey-automation/builderStore";

const SEED_ACTOR = { id: "system:seed", name: "System Seed", role: "system", isSuper: true };

async function main() {
  console.log("Seeding New Lead Onboarding (draft, execution off)…");
  const templates = await listTemplateOptions();
  console.log(`Approved DLT templates available: ${templates.length}`);

  const res = await seedLeadOnboarding(SEED_ACTOR);
  console.log(res.created ? `Created workflow ${res.workflowId}` : `Already exists: ${res.workflowId} (no-op)`);
  console.log(`Templates used — welcome: ${res.usedTemplates.welcome}, webinarInvite: ${res.usedTemplates.webinarInvite}`);
  console.log(`Placeholder steps (need an approved template): ${res.placeholderSteps.join(", ") || "none"}`);

  const graph = buildLeadOnboardingGraph(templates);
  const report = validateGraph(
    graph.nodes.map((n) => ({ node_key: n.node_key, type: n.type, config: n.config })),
    graph.edges.map((e) => ({ source: e.source, target: e.target, branch_label: e.branch_label })),
  );
  console.log(`\nValidation: ${report.ok ? "READY" : `${report.errors} error(s), ${report.warnings} warning(s)`}`);
  for (const iss of report.issues) console.log(`  [${iss.level}] ${iss.message}`);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
