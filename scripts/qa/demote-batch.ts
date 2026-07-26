/**
 * Roll back a bulk promotion batch.
 *
 * This is the command printed as `rollbackCommand` by every promotion dry run,
 * so it has to exist and work before the dry run is shown to anyone — a rollback
 * instruction that fails at the moment it is needed is worse than none, because
 * the operator proceeded believing they had a way back.
 *
 *   node --import tsx --env-file=.env.local scripts/qa/demote-batch.ts <batchId>
 *
 * Demotion is per-lead, audited and idempotent, so this is safe to re-run after
 * an interruption: leads already demoted report `changed: false` and are skipped.
 */

import { getSupabaseAdmin } from "../../lib/supabase";
import { demoteLead } from "../../lib/legacy-crm/promote";

const PAGE = 1_000;

const ACTOR = { id: "ops:demote-batch", name: "Bulk promotion rollback" };

async function main() {
  const batchId = process.argv[2];
  if (!batchId) {
    console.error("usage: demote-batch.ts <batchId>");
    process.exitCode = 1;
    return;
  }

  const db = getSupabaseAdmin();
  if (!db) throw new Error("no service-role client");

  // Page: a single request stops at 1,000 rows and looks complete. A rollback
  // that silently reverts the first 1,000 of a larger batch is the exact bug
  // this program already hit once in bulk assignment.
  const leadIds = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("lead_worklist_audit")
      .select("lead_id")
      .eq("batch_id", batchId)
      .eq("action", "promote")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`audit read failed: ${error.message}`);
    const rows = (data as { lead_id: string }[] | null) ?? [];
    for (const r of rows) leadIds.add(r.lead_id);
    if (rows.length < PAGE) break;
  }

  const ids = [...leadIds];
  console.log(`batch ${batchId}: ${ids.length} promoted lead(s) to demote`);
  if (!ids.length) {
    console.log("nothing to do — no promote audit rows carry this batch id.");
    return;
  }

  let restored = 0;
  let alreadyDemoted = 0;
  const failures: { leadId: string; error: string }[] = [];

  for (const [i, leadId] of ids.entries()) {
    try {
      const res = await demoteLead({ leadId, actor: ACTOR });
      if (res.changed) restored += 1;
      else alreadyDemoted += 1;
    } catch (e) {
      failures.push({ leadId, error: e instanceof Error ? e.message : String(e) });
    }
    if ((i + 1) % 200 === 0) console.log(`  ${i + 1}/${ids.length}`);
  }

  // Verify against the table rather than trusting the loop's own tally.
  let stillPromoted = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const slice = ids.slice(i, i + 200);
    const { count, error } = await db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .in("id", slice)
      .not("promoted_at", "is", null);
    if (error) throw new Error(`verification failed: ${error.message}`);
    stillPromoted += count ?? 0;
  }

  console.log("\nrestored to legacy      " + restored);
  console.log("already demoted         " + alreadyDemoted);
  console.log("failed                  " + failures.length);
  console.log("STILL PROMOTED (want 0) " + stillPromoted);

  for (const f of failures.slice(0, 20)) console.log(`  ! ${f.leadId}: ${f.error}`);

  if (stillPromoted > 0 || failures.length > 0) {
    console.log("\nROLLBACK INCOMPLETE — re-run this command; demotion is idempotent.");
    process.exitCode = 1;
  } else {
    console.log("\nRollback complete. Every lead in this batch is legacy again.");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
