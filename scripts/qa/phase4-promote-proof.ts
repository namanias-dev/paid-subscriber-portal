/**
 * PHASE 4 — promotion proven against the real database, on TEST-OWNED rows.
 *
 * The unit suite proves this against a stub. That is necessary and not
 * sufficient: the stub does not have the `is_legacy` derivation trigger, real
 * JSONB round-tripping, or PostgREST's habit of coercing types on the way
 * through. Those are exactly where a byte-equality claim quietly stops being
 * true.
 *
 * So this runs the real thing against rows it creates itself and removes
 * afterwards. No real person's record is touched — the whole point of the
 * program's QA rule, and the reason the earlier opt-out residue was such a
 * problem.
 *
 * Proves, in order:
 *   1. Promotion preserves every column outside its four, byte for byte,
 *      including the attribution JSONB.
 *   2. Demotion restores the row to byte-identical state.
 *   3. A CONSTRUCTED collision blocks promotion. Phase 0 found none in
 *      production, so this is the only way to know the guard fires at all.
 *   4. Double promotion is a no-op.
 *
 *   node --import tsx --import ./scripts/_react-cache-shim.mjs \
 *        --env-file=.env.local scripts/qa/phase4-promote-proof.ts
 */

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../lib/supabase";
import {
  promoteLead, demoteLead, previewPromote,
  PROMOTION_PRESERVED, COHORT_LEGACY_PROMOTED, PROMOTED_STATUS,
  DuplicateLiveLeadError,
} from "../../lib/legacy-crm/promote";

const ACTOR = { id: "qa:phase4-proof", name: "Phase 4 proof" };
const TAG = "qa-phase4-proof";

// 5xxxxxxxxx is not a valid Indian mobile prefix (they start 6-9), so these
// cannot collide with a real person. The promote path normalizes with
// `normalizeIndianMobile`, which requires 6-9, so the test numbers must be
// valid-looking. Use a 9 prefix in a range reserved here by the tag instead.
const LEGACY_PHONE = "9999000011";
const COLLIDE_PHONE = "9999000022";

const SELECT = "*";

function db() {
  const c = getSupabaseAdmin();
  if (!c) throw new Error("no service-role client");
  return c;
}

const results: { check: string; pass: boolean; detail: string }[] = [];
function record(check: string, pass: boolean, detail = "") {
  results.push({ check, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${check}${detail ? ` — ${detail}` : ""}`);
}

async function insertLead(row: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  const { error } = await db().from("leads").insert({ id, ...row });
  if (error) throw new Error(`insert: ${error.message}`);
  return id;
}

async function fetchLead(id: string): Promise<Record<string, unknown>> {
  const { data, error } = await db().from("leads").select(SELECT).eq("id", id).limit(1);
  if (error) throw new Error(`fetch: ${error.message}`);
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) throw new Error(`lead ${id} vanished`);
  return row;
}

async function cleanup(ids: string[]) {
  for (const id of ids) {
    await db().from("lead_worklist_audit").delete().eq("lead_id", id);
    await db().from("leads").delete().eq("id", id);
  }
}

async function main() {
  console.log("=".repeat(72));
  console.log("PHASE 4 — PROMOTION PROOF (test-owned rows)");
  console.log("=".repeat(72));

  const created: string[] = [];

  try {
    // ------------------------------------------------- 1. round trip
    console.log("\n1. promote / demote round trip");

    const legacyId = await insertLead({
      name: "QA Phase4 Subject",
      phone: LEGACY_PHONE,
      status: "Not Replied",
      is_legacy: true,
      legacy_call_status_raw: "call back after 6pm - sounded keen",
      legacy_source_tab: "QA Source Tab",
      campaign_clean: "QA Campaign 2023",
      import_batch: TAG,
      import_source: TAG,
      created_at: "2023-04-11T06:30:00.000Z",
      attribution: {
        legacy: true,
        first_touch: { channel: "Offline", campaign: "QA Campaign 2023", at: "2023-04-11" },
        last_touch: { channel: "Offline" },
      },
    });
    created.push(legacyId);

    const before = await fetchLead(legacyId);
    record("test row is legacy", before.is_legacy === true, `is_legacy=${before.is_legacy}`);

    const promoteRes = await promoteLead({ leadId: legacyId, actor: ACTOR });
    record("promote reported a change", promoteRes.changed === true);

    const promoted = await fetchLead(legacyId);
    record("status reset to neutral", promoted.status === PROMOTED_STATUS, String(promoted.status));
    record("cohort set", promoted.cohort === COHORT_LEGACY_PROMOTED, String(promoted.cohort));
    record("promoted_at set", !!promoted.promoted_at);
    record("promoted_by set", promoted.promoted_by === ACTOR.id, String(promoted.promoted_by));
    record(
      "is_legacy UNCHANGED (provenance survives)",
      promoted.is_legacy === true,
      `is_legacy=${promoted.is_legacy}`,
    );

    // The byte-equality claim, column by column.
    const drifted: string[] = [];
    for (const f of PROMOTION_PRESERVED) {
      const a = JSON.stringify(before[f] ?? null);
      const b = JSON.stringify(promoted[f] ?? null);
      if (a !== b) drifted.push(`${f}: ${a} -> ${b}`);
    }
    record(
      "every preserved column byte-identical after promote",
      drifted.length === 0,
      drifted.join("; ") || `${PROMOTION_PRESERVED.length} columns checked`,
    );

    await demoteLead({ leadId: legacyId, actor: ACTOR });
    const after = await fetchLead(legacyId);

    // Full-row equality, not just the preserved list. `updated_at` legitimately
    // moves, so it is the one exclusion and it is named rather than glossed.
    const IGNORE = new Set(["updated_at"]);
    const roundTripDrift: string[] = [];
    for (const key of Object.keys(before)) {
      if (IGNORE.has(key)) continue;
      const a = JSON.stringify(before[key] ?? null);
      const b = JSON.stringify(after[key] ?? null);
      if (a !== b) roundTripDrift.push(`${key}: ${a} -> ${b}`);
    }
    record(
      "FULL ROW byte-identical after demote",
      roundTripDrift.length === 0,
      roundTripDrift.join("; ") || `${Object.keys(before).length - IGNORE.size} columns checked`,
    );

    // ------------------------------------------------- 2. idempotence
    console.log("\n2. idempotence");
    const first = await promoteLead({ leadId: legacyId, actor: ACTOR });
    const second = await promoteLead({ leadId: legacyId, actor: ACTOR });
    record("double promote is a no-op", first.changed === true && second.changed === false);
    await demoteLead({ leadId: legacyId, actor: ACTOR });

    // ------------------------------------------------- 3. collision
    console.log("\n3. constructed duplicate collision");

    const collideLegacyId = await insertLead({
      name: "QA Phase4 Collide (legacy)",
      phone: COLLIDE_PHONE,
      status: "Not Replied",
      is_legacy: true,
      import_batch: TAG,
      import_source: TAG,
      attribution: { legacy: true },
    });
    created.push(collideLegacyId);

    const preClean = await previewPromote(collideLegacyId);
    record("clean before the collision exists", preClean.ok === true, preClean.blockedReason ?? "");

    // The live twin, stored in a DIFFERENT format on purpose: if matching were
    // done on raw text this would not be found, and the block would not fire.
    const liveTwinId = await insertLead({
      name: "QA Phase4 Collide (live)",
      phone: "+91 99990 00022",
      status: "New",
      is_legacy: false,
      import_batch: TAG,
      import_source: TAG,
    });
    created.push(liveTwinId);

    const twin = await fetchLead(liveTwinId);
    record("live twin really is live", twin.is_legacy === false, `is_legacy=${twin.is_legacy}`);

    const blockedPreview = await previewPromote(collideLegacyId);
    record(
      "preview BLOCKS on the collision",
      blockedPreview.ok === false && !!blockedPreview.duplicateOf,
      blockedPreview.blockedReason ?? "(no reason given)",
    );
    record(
      "preview points at the existing live lead",
      blockedPreview.duplicateOf?.leadId === liveTwinId,
      String(blockedPreview.duplicateOf?.leadId),
    );

    let threw = false;
    try {
      await promoteLead({ leadId: collideLegacyId, actor: ACTOR });
    } catch (e) {
      threw = e instanceof DuplicateLiveLeadError;
    }
    record("commit REFUSES the collision", threw);

    const stillUnpromoted = await fetchLead(collideLegacyId);
    record("blocked lead was not modified", stillUnpromoted.promoted_at === null);

    record(
      "matched across formatting (9999000022 vs '+91 99990 00022')",
      threw,
      "raw-text matching would have missed this",
    );
  } finally {
    console.log("\ncleaning up test-owned rows");
    await cleanup(created);
    for (const id of created) {
      const { data } = await db().from("leads").select("id").eq("id", id).limit(1);
      if ((data as unknown[] | null)?.length) console.log(`  WARNING: ${id} still present`);
    }
    console.log(`  removed ${created.length}`);
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n" + "=".repeat(72));
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    for (const f of failed) console.log(`  FAILED: ${f.check} — ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
