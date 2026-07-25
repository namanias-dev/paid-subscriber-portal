/**
 * Revert every outstanding bulk-assign batch written by a QA actor.
 *
 * Recovery path for a scale run that was stopped part-way — the assignments are
 * committed by design, so an interrupted run leaves them in place. Goes through
 * `revertAssignBatch`, the same path an operator would use, rather than a bulk
 * UPDATE, so this also exercises the thing it is cleaning up after.
 *
 *   node --import tsx --import ./scripts/_react-cache-shim.mjs \
 *        --env-file=.env.local scripts/qa/revert-scale-batches.ts
 */

import { getSupabaseAdmin } from "../../lib/supabase";
import { revertAssignBatch } from "../../lib/legacy-crm/bulkAssign";

const QA_ACTORS = ["qa:phase3-scale"];
const ACTOR = { id: "operator:phase3-cleanup", name: "Phase 3 cleanup" };
const PAGE = 1000;

async function main() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("no service-role client");

  // Page: a 60,000-row run leaves far more audit rows than one response holds.
  const batches = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("lead_worklist_audit")
      .select("batch_id, actor, reverted_at")
      .in("actor", QA_ACTORS)
      .eq("action", "assign")
      .is("reverted_at", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data as { batch_id: string | null }[] | null) ?? [];
    for (const r of rows) {
      if (r.batch_id) batches.set(r.batch_id, (batches.get(r.batch_id) ?? 0) + 1);
    }
    if (rows.length < PAGE) break;
  }

  console.log(`outstanding QA assign batches: ${batches.size}`);
  if (!batches.size) { console.log("nothing to revert"); }

  let total = 0;
  for (const [b, n] of batches) {
    const r = await revertAssignBatch(b, ACTOR);
    total += r.reverted;
    console.log(`  ${b} rows=${n} reverted=${r.reverted} skipped=${r.skipped}`);
  }

  // ------------------------------------------------------------- orphans
  //
  // Leads that changed owner under a batch whose audit insert never ran. The
  // old commit path applied every UPDATE before writing any audit row, so a
  // statement timeout partway through left assignments that `revertAssignBatch`
  // cannot see — it looks for work in the audit table, and there is none.
  //
  // Identified by the thing that makes them safe to touch: they are assigned to
  // an account this QA run created, which no other process writes. Their prior
  // owner is known to be NULL because the run refuses to start unless
  // legacy_assigned is 0. Each one still gets an audit row, written before the
  // change, so the trail explains the correction instead of a value silently
  // reverting to null.
  const TEST_ACCOUNTS = ["qa_scale_a", "qa_scale_b", "qa_scale_c"];
  const orphans: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("leads").select("id")
      .is("merged_into", null).eq("is_legacy", true)
      .in("assigned_to", TEST_ACCOUNTS)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data as { id: string }[] | null) ?? [];
    orphans.push(...rows.map((r) => r.id));
    if (rows.length < PAGE) break;
  }

  if (orphans.length) {
    console.log(`\norphaned assignments (applied, never audited): ${orphans.length}`);
    const { randomUUID } = await import("node:crypto");
    const recoveryBatch = randomUUID();
    for (let i = 0; i < orphans.length; i += 100) {
      const part = orphans.slice(i, i + 100);
      await db.from("lead_worklist_audit").insert(part.map((id) => ({
        id: randomUUID(),
        lead_id: id,
        actor: ACTOR.id,
        action: "revert",
        field: "assigned_to",
        before_value: null,
        after_value: null,
        batch_id: recoveryBatch,
        metadata: {
          bulk: true,
          recovery: "orphaned by a commit that applied updates before writing audit rows",
        },
      })));
      await db.from("leads").update({ assigned_to: null }).in("id", part);
    }
    console.log(`  cleared under recovery batch ${recoveryBatch}`);
  }

  const { count } = await db
    .from("leads").select("id", { count: "exact", head: true })
    .is("merged_into", null).eq("is_legacy", true).not("assigned_to", "is", null);

  console.log(`\nreverted ${total}, orphans cleared ${orphans.length}`);
  console.log(`legacy_assigned now: ${count ?? 0}  (want 0)`);

  // Remove any test accounts the scale run created.
  for (const u of ["qa_scale_a", "qa_scale_b", "qa_scale_c"]) {
    const { data } = await db
      .from("admin_users").select("id, created_by").eq("username", u).limit(1);
    const row = (data as { id: string; created_by: string | null }[] | null)?.[0];
    if (!row) continue;
    if (!QA_ACTORS.includes(row.created_by ?? "")) {
      console.log(`REFUSING to remove ${u}: created_by=${row.created_by}`);
      continue;
    }
    await db.from("admin_users").delete().eq("id", row.id);
    console.log(`removed test account ${u}`);
  }

  if ((count ?? 0) !== 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
