/**
 * Prove the printed rollback one-liner actually rolls back.
 *
 * Seeds test-owned legacy rows, promotes them under one batch id, then invokes
 * `scripts/qa/demote-batch.ts` as a subprocess using the exact command string a
 * dry run prints — not by importing the function, because the thing under test
 * is the command an operator would paste at 2am, argv parsing included.
 *
 *   node --import tsx --import ./scripts/_react-cache-shim.mjs \
 *        --env-file=.env.local scripts/qa/phase4-rollback-proof.ts
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../lib/supabase";
import { promoteLead } from "../../lib/legacy-crm/promote";

const ACTOR = { id: "qa:phase4-rollback", name: "Phase 4 rollback proof" };
const MARK = "qa-phase4-rollback";
const N = 5;

function db() {
  const c = getSupabaseAdmin();
  if (!c) throw new Error("no service-role client");
  return c;
}

async function fetchRows(ids: string[]) {
  const { data, error } = await db().from("leads").select("*").in("id", ids).order("id");
  if (error) throw new Error(error.message);
  return (data as Record<string, unknown>[]) ?? [];
}

async function main() {
  console.log("=".repeat(72));
  console.log("PHASE 4 — ROLLBACK ONE-LINER PROOF (test-owned rows)");
  console.log("=".repeat(72));

  const ids: string[] = [];
  let failed = false;

  try {
    const statuses = ["Not Replied", "Interested", "Call Back", "New", "Lost"];
    for (let i = 0; i < N; i++) {
      const id = randomUUID();
      const { error } = await db().from("leads").insert({
        id,
        name: `QA Rollback ${i}`,
        // 9-prefixed, clearly synthetic, and not a dialable Indian mobile range
        phone: `+9199000${String(10000 + i).slice(-5)}`,
        is_legacy: true,
        status: statuses[i],
        legacy_call_status_raw: `sheet wording ${i}`,
        legacy_source_tab: "QA_ROLLBACK",
        import_source: MARK,
        attribution: { legacy: true, first_touch: { channel: "sheet", campaign: `c${i}` } },
      });
      if (error) throw new Error(`seed failed: ${error.message}`);
      ids.push(id);
    }
    console.log(`seeded ${ids.length} test legacy leads`);

    const before = await fetchRows(ids);

    const batchId = randomUUID();
    for (const id of ids) await promoteLead({ leadId: id, actor: ACTOR, batchId });
    const promotedCount = (await fetchRows(ids)).filter((r) => r.promoted_at !== null).length;
    console.log(`promoted ${promotedCount}/${N} under batch ${batchId}`);
    if (promotedCount !== N) throw new Error("seeding promotion did not take");

    // The exact command a dry run prints.
    console.log(`\n$ node --import tsx --env-file=.env.local scripts/qa/demote-batch.ts ${batchId}\n`);
    const out = execFileSync(
      "node",
      ["--import", "tsx", "--env-file=.env.local", "scripts/qa/demote-batch.ts", batchId],
      { encoding: "utf8", stdio: "pipe" },
    );
    console.log(out.trim().split("\n").map((l) => "  | " + l).join("\n"));

    const after = await fetchRows(ids);

    // Byte-equality, column by column, including the JSONB.
    const diffs: string[] = [];
    for (const b of before) {
      const a = after.find((r) => r.id === b.id);
      if (!a) { diffs.push(`${b.id}: row vanished`); continue; }
      for (const k of Object.keys(b)) {
        const bv = JSON.stringify(b[k]);
        const av = JSON.stringify(a[k]);
        if (bv !== av) diffs.push(`${String(b.id).slice(0, 8)}.${k}: ${bv} -> ${av}`);
      }
    }

    const stillPromoted = after.filter((r) => r.promoted_at !== null).length;

    console.log("\n" + "-".repeat(72));
    console.log(`still promoted after rollback (want 0)   ${stillPromoted}`);
    console.log(`column diffs across round trip (want 0)  ${diffs.length}`);
    for (const d of diffs.slice(0, 20)) console.log(`  ! ${d}`);

    failed = stillPromoted !== 0 || diffs.length !== 0;
    console.log(failed ? "\nFAIL — rollback did not restore prior state." : "\nPASS — rollback restored every column byte-identically.");
  } finally {
    if (ids.length) {
      await db().from("lead_worklist_audit").delete().in("lead_id", ids);
      await db().from("leads").delete().in("id", ids);
      const { count } = await db().from("leads")
        .select("id", { count: "exact", head: true }).eq("import_source", MARK);
      console.log(`\ncleanup: ${ids.length} test rows removed; ${count ?? 0} remain (want 0)`);
    }
  }

  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
