/**
 * PHASE 3 — the measurement I could not take, taken with the feature itself.
 *
 * Queue-depth latency at realistic scale was left unverified because staging
 * 60,000 assignments inside one rolled-back transaction blew the transport's
 * budget. Phase 3 shipped a reversible, audited, batch-tagged bulk assignment
 * path; the right way to build that state is to use it.
 *
 * This does three things at once:
 *
 *   1. Assigns ~60,000 legacy leads in COMMITTED batches of BULK_ASSIGN_MAX,
 *      producing the large-fraction planner state (66% of the legacy set left
 *      unassigned, which is where `idx_leads_legacy_unassigned_created`'s
 *      selectivity moves most).
 *   2. Measures the three plans that matter, cold.
 *   3. Reverts every batch through `revertAssignBatch` — an end-to-end
 *      reversal test at 60,000 rows, which is far stronger evidence than the
 *      small-batch reversal tests in the suite.
 *
 *
 * WHY TEMPORARY ACCOUNTS RATHER THAN REAL COUNSELLORS
 *
 * `listAssignableCounsellors` only accepts active admins holding
 * manage_students_leads, so this cannot run against invented names — that
 * validation is the point of it. But pointing it at Suraj or Abhishek would
 * drop 20,000 leads into a queue a real person may open mid-run.
 *
 * So it creates three accounts that cannot be logged into: `password_hash` is
 * a sentinel that is not a valid bcrypt digest, and authentication goes
 * through `bcrypt.compare(password, row.password_hash || "")`
 * (lib/dataProvider.ts:991), which returns false for a malformed digest for
 * every possible input. They are removed at the end.
 *
 * THE ASSIGNMENTS ARE COMMITTED. Ownership is the only column touched, no
 * message can be sent by it, and the revert restores the prior owner exactly.
 * The window is minutes and the accounts holding the leads are not real.
 *
 *   node --import tsx --import ./scripts/_react-cache-shim.mjs \
 *        --env-file=.env.local scripts/qa/phase3-scale-assign-measure-revert.ts
 */

import { getSupabaseAdmin } from "../../lib/supabase";
import {
  planBulkAssign, commitBulkAssign, revertAssignBatch, queueDepths,
  confirmationPhraseFor, BULK_ASSIGN_MAX,
} from "../../lib/legacy-crm/bulkAssign";

const ACTOR = { id: "qa:phase3-scale", name: "Phase 3 scale test" };
const TARGET_TOTAL = 60_000;
const COUNSELLORS = ["qa_scale_a", "qa_scale_b", "qa_scale_c"];

// Not a bcrypt digest. bcrypt.compare returns false for every input.
const UNUSABLE_HASH = "!no-login-qa-scale-account";

const LATENCY_CEILING_MS = 1_000;

function db() {
  const c = getSupabaseAdmin();
  if (!c) throw new Error("no service-role client");
  return c;
}

async function ensureAccounts() {
  const client = db();
  for (const u of COUNSELLORS) {
    const { data } = await client.from("admin_users").select("id").eq("username", u).limit(1);
    if ((data as unknown[] | null)?.length) continue;
    const { error } = await client.from("admin_users").insert({
      username: u,
      name: `QA Scale ${u.slice(-1).toUpperCase()}`,
      password_hash: UNUSABLE_HASH,
      role_id: "support_ops",
      role: "Support / Operations",
      status: "active",
      must_change_password: false,
      created_by: ACTOR.id,
    });
    if (error) throw new Error(`could not create ${u}: ${error.message}`);
  }
  console.log(`assignable test counsellors ready: ${COUNSELLORS.join(", ")}`);
}

async function removeAccounts() {
  const client = db();
  for (const u of COUNSELLORS) {
    // Only ever remove an account this script created.
    const { data } = await client
      .from("admin_users").select("id, created_by").eq("username", u).limit(1);
    const row = (data as { id: string; created_by: string | null }[] | null)?.[0];
    if (!row) continue;
    if (row.created_by !== ACTOR.id) {
      console.log(`  REFUSING to remove ${u}: created_by=${row.created_by}`);
      continue;
    }
    await client.from("admin_users").delete().eq("id", row.id);
    console.log(`  removed ${u}`);
  }
}

async function legacyAssignedCount(): Promise<number> {
  const { count, error } = await db()
    .from("leads").select("id", { count: "exact", head: true })
    .is("merged_into", null).eq("is_legacy", true).not("assigned_to", "is", null);
  if (error) throw new Error(`legacyAssignedCount: ${error.message}`);
  return count ?? 0;
}

async function main() {
  const startedAt = Date.now();
  console.log("=".repeat(72));
  console.log("PHASE 3 — SCALE ASSIGN / MEASURE / REVERT");
  console.log("=".repeat(72));

  const before = await legacyAssignedCount();
  console.log(`\nlegacy_assigned before: ${before}`);
  if (before !== 0) {
    console.log("REFUSING: expected a clean starting state of 0 assigned.");
    process.exitCode = 1;
    return;
  }

  await ensureAccounts();

  // ---------------------------------------------------------------- assign
  const batchIds: string[] = [];
  let assignedTotal = 0;

  console.log(`\nassigning ~${TARGET_TOTAL} in batches of ${BULK_ASSIGN_MAX}`);
  while (assignedTotal < TARGET_TOTAL) {
    const plan = await planBulkAssign({
      filter: { scope: "legacy", assignedMode: "unassigned" },
      distribution: { mode: "round_robin", assignees: COUNSELLORS },
    });
    if (!plan.totalChanging) { console.log("  no more unassigned leads"); break; }

    const res = await commitBulkAssign({
      plan,
      actor: ACTOR,
      typedConfirmation: plan.requiresTypedConfirmation
        ? confirmationPhraseFor(plan.totalChanging) : null,
    });
    batchIds.push(res.batchId);
    assignedTotal += res.assigned;

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
    console.log(
      `  batch ${String(batchIds.length).padStart(2)} ` +
      `assigned=${String(res.assigned).padStart(5)} ` +
      `total=${String(assignedTotal).padStart(6)} ` +
      `drift=${res.driftedSincePreview.length} missing=${res.missing.length} ` +
      `[${elapsed}s]`,
    );
  }

  // ------------------------------------------------------- per-counsellor
  console.log("\nper-counsellor queue depth");
  const depths = await queueDepths("legacy");
  for (const d of depths.filter((x) => x.depth > 0)) {
    console.log(`  ${d.username.padEnd(24)} ${String(d.depth).padStart(7)}`);
  }
  const deepest = depths[0];

  const nowAssigned = await legacyAssignedCount();
  const pctUnassigned = (100 * (178183 - nowAssigned) / 178183).toFixed(1);
  console.log(`\nlegacy_assigned now: ${nowAssigned}  (${pctUnassigned}% of the set still unassigned)`);

  // ------------------------------------------------------------- measure
  console.log("\nplans (see the EXPLAIN output printed by the SQL harness)");
  console.log(`  deepest queue: ${deepest?.username} @ ${deepest?.depth}`);
  console.log(`  ceiling: ${LATENCY_CEILING_MS} ms`);
  console.log("\n  >>> RUN THE EXPLAIN BLOCK NOW (separate connection, see companion SQL) <<<");
  console.log(`  >>> deepest counsellor = ${deepest?.username} <<<`);

  const holdMs = Number(process.env.QA_HOLD_MS ?? "0");
  if (holdMs > 0) {
    console.log(`\nholding assigned state for ${holdMs} ms so measurements can run...`);
    await new Promise((r) => setTimeout(r, holdMs));
  }

  // ------------------------------------------- reversal to a REAL prior owner
  //
  // Every batch above moved a lead from NULL, so reverting them only proves
  // restore-to-unassigned. The case that actually matters is a REASSIGNMENT:
  // clearing the field there would look like a successful revert while quietly
  // dispossessing whoever held the lead before. So move a slice from A to B and
  // check it comes back to A, by name.
  console.log("\nreassignment reversal (the case where clearing != restoring)");
  const { data: aRows } = await db()
    .from("leads").select("id")
    .is("merged_into", null).eq("is_legacy", true).eq("assigned_to", COUNSELLORS[0])
    .limit(300);
  const slice = ((aRows as { id: string }[] | null) ?? []).map((r) => r.id);
  console.log(`  moving ${slice.length} leads ${COUNSELLORS[0]} -> ${COUNSELLORS[1]}`);

  const reassignPlan = await planBulkAssign({
    leadIds: slice,
    distribution: { mode: "single", assignee: COUNSELLORS[1] },
    scope: "legacy",
  });
  const reassignRes = await commitBulkAssign({
    plan: reassignPlan,
    actor: ACTOR,
    typedConfirmation: reassignPlan.requiresTypedConfirmation
      ? confirmationPhraseFor(reassignPlan.totalChanging) : null,
  });
  console.log(`  reassigned=${reassignRes.assigned} drift=${reassignRes.driftedSincePreview.length}`);

  const revReassign = await revertAssignBatch(reassignRes.batchId, ACTOR);
  const { data: backRows } = await db()
    .from("leads").select("id, assigned_to").in("id", slice.slice(0, 200));
  const back = (backRows as { id: string; assigned_to: string | null }[] | null) ?? [];
  const restoredToA = back.filter((r) => r.assigned_to === COUNSELLORS[0]).length;
  const wronglyCleared = back.filter((r) => r.assigned_to === null).length;
  console.log(`  reverted=${revReassign.reverted}`);
  console.log(`  sampled ${back.length}: restored_to_${COUNSELLORS[0]}=${restoredToA} wrongly_cleared=${wronglyCleared}`);
  const reassignOk = back.length > 0 && restoredToA === back.length && wronglyCleared === 0;
  console.log(`  ${reassignOk ? "PASS" : "FAIL"} — prior owner restored by name, not cleared`);

  // -------------------------------------------------------------- revert
  console.log(`\nreverting ${batchIds.length} batches`);
  let revertedTotal = 0;
  for (const [i, b] of batchIds.entries()) {
    const r = await revertAssignBatch(b, ACTOR);
    revertedTotal += r.reverted;
    console.log(`  batch ${String(i + 1).padStart(2)} reverted=${String(r.reverted).padStart(5)} skipped=${r.skipped}`);
  }

  // -------------------------------------------------------------- verify
  const after = await legacyAssignedCount();
  const finalDepths = (await queueDepths("legacy")).filter((d) => d.depth > 0);

  console.log("\n" + "=".repeat(72));
  console.log("RESULT");
  console.log("=".repeat(72));
  console.log(`  assigned            : ${assignedTotal}`);
  console.log(`  reverted            : ${revertedTotal}`);
  console.log(`  legacy_assigned now : ${after}  (want 0)`);
  console.log(`  non-empty queues    : ${finalDepths.length}  (want 0)`);
  console.log(`  reassign reversal   : ${reassignOk ? "PASS" : "FAIL"}`);

  await removeAccounts();

  const clean = after === 0 && revertedTotal === assignedTotal && finalDepths.length === 0 && reassignOk;
  console.log(`\n${clean ? "CLEAN" : "NOT CLEAN"}  [${((Date.now() - startedAt) / 1000).toFixed(0)}s]`);
  if (!clean) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
