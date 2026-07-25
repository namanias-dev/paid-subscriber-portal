/**
 * Revert the opt-out QA batch that never got to revert itself.
 *
 * `scripts/qa/phase2-optout-enforcement-qa.ts` verified that marking a lead
 * opted-out actually suppresses SMS. It did that against a REAL legacy lead and
 * was interrupted between the write and its cleanup, so a real person has been
 * sitting there flagged `work_status = opted_out`, `consent_status = withdrawn`,
 * and — the part that actually matters — suppressed in `sms_opt_outs`, since
 * 21:25 UTC today.
 *
 * That script has since been deleted and replaced by a unit test against a
 * stubbed client, which is where a test like that belonged in the first place.
 * This removes what it left behind.
 *
 * Two halves, and the second is the one worth care:
 *
 *   1. The seven `leads` column writes, reverted via `revertWrite` so each one
 *      restores the audited `before_value` and leaves a reversal row pointing
 *      at what it undid. Not a hand-written UPDATE — the audit already records
 *      the true prior values, and retyping them invites a typo that would look
 *      exactly like a successful revert.
 *
 *   2. The `sms_opt_outs` row, which `revertWrite` cannot reach because it is
 *      not a column on `leads`. Left alone, the visible flags would clear while
 *      the suppression quietly persisted — the lead would look contactable and
 *      silently never receive anything. That is a worse state than the one
 *      we started in, because it is invisible.
 *
 * Refuses to touch anything not written by the QA actor.
 *
 *   node --import tsx --import ./scripts/_react-cache-shim.mjs \
 *        --env-file=.env.local scripts/qa/revert-optout-qa-batch.ts
 */

import { getSupabaseAdmin } from "../../lib/supabase";
import { revertWrite } from "../../lib/legacy-crm/writes";
import { removeOptOut, isOptedOut } from "../../lib/sms/store";

const QA_ACTOR = "qa:optout-enforcement";
const OPERATOR = { id: "operator:phase3-cleanup", name: "Phase 3 cleanup" };

function digits10(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

async function main() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("no service-role client");

  const { data, error } = await db
    .from("lead_worklist_audit")
    .select("id, lead_id, field, before_value, after_value, actor, reverted_at")
    .eq("actor", QA_ACTOR)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`could not read audit: ${error.message}`);

  const rows = (data ?? []) as {
    id: string; lead_id: string; field: string | null;
    before_value: string | null; after_value: string | null; reverted_at: string | null;
  }[];

  const open = rows.filter((r) => !r.reverted_at);
  console.log(`audit rows by ${QA_ACTOR}: ${rows.length} (${open.length} not yet reverted)`);
  if (!open.length && !rows.length) { console.log("nothing to do"); return; }

  const leadIds = [...new Set(rows.map((r) => r.lead_id))];
  if (leadIds.length > 1) {
    console.log(`REFUSING: batch spans ${leadIds.length} leads; expected 1`);
    process.exitCode = 1;
    return;
  }
  const leadId = leadIds[0];

  // --- 1. columns ------------------------------------------------------
  console.log(`\nreverting ${open.length} column write(s) on lead ${leadId}`);
  for (const r of open) {
    await revertWrite(r.id, OPERATOR);
    console.log(`  ${String(r.field).padEnd(20)} ${JSON.stringify(r.after_value)} -> ${JSON.stringify(r.before_value)}`);
  }

  // --- 2. suppression --------------------------------------------------
  const { data: leadRows } = await db
    .from("leads").select("phone, work_status, consent_status").eq("id", leadId).limit(1);
  const lead = (leadRows as { phone: string; work_status: string | null; consent_status: string | null }[] | null)?.[0];
  if (!lead) throw new Error(`lead ${leadId} not found`);

  const mobile = digits10(lead.phone);
  const wasSuppressed = await isOptedOut(mobile);
  console.log(`\nsms suppression for xxxxxx${mobile.slice(-4)}: ${wasSuppressed ? "PRESENT" : "absent"}`);

  if (wasSuppressed) {
    const { data: optRows } = await db
      .from("sms_opt_outs").select("created_by").eq("normalized_mobile", mobile).limit(1);
    const createdBy = (optRows as { created_by: string | null }[] | null)?.[0]?.created_by ?? null;
    if (createdBy !== QA_ACTOR) {
      // A genuine opt-out is a legal instruction from a human. Never lift one.
      console.log(`  REFUSING: created_by=${createdBy}, not ${QA_ACTOR}`);
      process.exitCode = 1;
      return;
    }
    await removeOptOut(mobile);
    console.log(`  removed (was created_by=${createdBy})`);
  }

  // --- verify ----------------------------------------------------------
  const { data: after } = await db
    .from("leads").select("work_status, work_status_at, work_status_by, consent_status, opted_out_at, suppression_reason, last_worked_at")
    .eq("id", leadId).limit(1);
  const a = (after as Record<string, string | null>[] | null)?.[0] ?? {};

  console.log("\nfinal lead state:");
  for (const [k, v] of Object.entries(a)) console.log(`  ${k.padEnd(20)} ${JSON.stringify(v)}`);

  const stillSuppressed = await isOptedOut(mobile);
  const { count: workStatusSet } = await db
    .from("leads").select("id", { count: "exact", head: true })
    .is("merged_into", null).eq("is_legacy", true).not("work_status", "is", null);
  const { count: suppressed } = await db
    .from("sms_opt_outs").select("normalized_mobile", { count: "exact", head: true });

  console.log("\ninvariants:");
  console.log(`  legacy work_status set : ${workStatusSet ?? 0}  (want 0)`);
  console.log(`  sms_opt_outs rows      : ${suppressed ?? 0}  (want 0)`);
  console.log(`  this lead suppressed   : ${stillSuppressed}  (want false)`);

  // consent_status must be back to the value the audit recorded, not merely
  // "not withdrawn" — 'unknown' is the honest state for every legacy lead.
  const consentOk = a.consent_status === "unknown";
  console.log(`  consent_status         : ${JSON.stringify(a.consent_status)}  (want "unknown")`);

  if ((workStatusSet ?? 0) !== 0 || (suppressed ?? 0) !== 0 || stillSuppressed || !consentOk) {
    console.log("\nNOT CLEAN");
    process.exitCode = 1;
  } else {
    console.log("\nCLEAN");
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
