/**
 * Read-only: load every seeded workflow's ACTUAL saved draft graph from the DB
 * and report, per condition node, which branch handles have a connected edge.
 * Proves whether "missing Yes path" is real in the persisted data.
 *   node --env-file=.env.local --import tsx scripts/verify-seeded-journeys.ts
 */
import { listWorkflows } from "../lib/journey-automation/store";
import { getEditorState } from "../lib/journey-automation/builderStore";
import { validateGraph } from "../lib/journey-automation/validate";

const ACTOR = { id: "system:verify", name: "System Verify", role: "system", isSuper: true };

async function main() {
  const wfs = await listWorkflows();
  console.log(`Workflows: ${wfs.length}\n`);
  for (const wf of wfs) {
    const state = await getEditorState(wf.id, ACTOR);
    if (!state) { console.log(`- ${wf.name} (${wf.id}): no editor state`); continue; }
    const { nodes, edges } = state.graph;
    console.log(`=== ${wf.name} (${wf.id}) status=${wf.status} ===`);
    for (const n of nodes.filter((x) => x.type === "condition" || x.type === "branch")) {
      const outs = edges.filter((e) => e.source === n.node_key);
      const labels = outs.map((e) => `${e.branch_label ?? "(none)"}`).join(", ");
      console.log(`  ${n.type} "${String(n.config?.title ?? n.node_key)}": ${outs.length} edge(s) [${labels}]`);
    }
    const rep = validateGraph(
      nodes.map((n) => ({ node_key: n.node_key, type: n.type, config: n.config })),
      edges.map((e) => ({ source: e.source, target: e.target, branch_label: e.branch_label })),
    );
    const structural = rep.issues.filter((i) => i.level === "error" && i.code !== "sms_no_template");
    console.log(`  validation: ${structural.length === 0 ? "OK (only pending templates)" : `${structural.length} STRUCTURAL error(s)`}`);
    for (const i of structural) console.log(`    [${i.code}] ${i.message}`);
    console.log("");
  }
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
