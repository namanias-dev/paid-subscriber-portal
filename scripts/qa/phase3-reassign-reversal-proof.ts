/**
 * Prove that reverting a REASSIGNMENT restores the previous owner by name.
 *
 * Every batch in the scale run moved a lead from NULL, so reverting those only
 * demonstrates restore-to-unassigned. The case that actually distinguishes a
 * correct revert from a plausible-looking one is a reassignment: clearing the
 * field there would report success while quietly dispossessing whoever held the
 * lead before, and nothing in the result would say so.
 *
 * Run while the scale-test queues exist. Moves a slice A -> B, reverts, and
 * checks every lead came back to A.
 *
 *   node --import tsx --import ./scripts/_react-cache-shim.mjs \
 *        --env-file=.env.local scripts/qa/phase3-reassign-reversal-proof.ts
 */

import { getSupabaseAdmin } from "../../lib/supabase";
import {
  planBulkAssign, commitBulkAssign, revertAssignBatch, confirmationPhraseFor,
} from "../../lib/legacy-crm/bulkAssign";

const ACTOR = { id: "qa:phase3-scale", name: "Phase 3 scale test" };
const FROM = "qa_scale_a";
const TO = "qa_scale_b";
const N = 200;

async function main() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("no service-role client");

  const { data } = await db
    .from("leads").select("id")
    .is("merged_into", null).eq("is_legacy", true).eq("assigned_to", FROM)
    .limit(N);
  const ids = ((data as { id: string }[] | null) ?? []).map((r) => r.id);
  console.log(`slice owned by ${FROM}: ${ids.length}`);
  if (ids.length < 10) { console.log("not enough rows; is the scale state live?"); return; }

  const plan = await planBulkAssign({
    leadIds: ids, distribution: { mode: "single", assignee: TO }, scope: "legacy",
  });
  console.log(`plan: ${plan.totalChanging} changing, ${plan.totalAlreadyOwned} already owned`);
  console.log(`warnings: ${plan.warnings.join(" | ") || "(none)"}`);

  const res = await commitBulkAssign({
    plan, actor: ACTOR,
    typedConfirmation: plan.requiresTypedConfirmation
      ? confirmationPhraseFor(plan.totalChanging) : null,
  });
  console.log(`committed: assigned=${res.assigned}`);

  const mid = await ownersOf(ids);
  console.log(`now owned by ${TO}: ${count(mid, TO)}  by ${FROM}: ${count(mid, FROM)}`);

  const rev = await revertAssignBatch(res.batchId, ACTOR);
  console.log(`reverted: ${rev.reverted}`);

  const after = await ownersOf(ids);
  const backToA = count(after, FROM);
  const stuckOnB = count(after, TO);
  const cleared = [...after.values()].filter((v) => v === null).length;

  console.log(`\nafter revert  ${FROM}=${backToA}  ${TO}=${stuckOnB}  cleared=${cleared}`);
  const ok = backToA === ids.length && stuckOnB === 0 && cleared === 0;
  console.log(ok
    ? "PASS — prior owner restored by name, nobody dispossessed"
    : "FAIL — revert did not restore the previous owner");
  if (!ok) process.exitCode = 1;

  async function ownersOf(all: string[]) {
    const out = new Map<string, string | null>();
    for (let i = 0; i < all.length; i += 100) {
      const { data: rows } = await db!
        .from("leads").select("id, assigned_to").in("id", all.slice(i, i + 100));
      for (const r of (rows as { id: string; assigned_to: string | null }[] | null) ?? []) {
        out.set(r.id, r.assigned_to);
      }
    }
    return out;
  }
  function count(m: Map<string, string | null>, who: string) {
    return [...m.values()].filter((v) => v === who).length;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
