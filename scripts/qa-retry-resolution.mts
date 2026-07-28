/**
 * READ-ONLY QA of the retry fix against the REAL 21:47 UTC campaign.
 *
 * Sends nothing and writes nothing: it resolves the target set from the live log
 * and checks it against what the campaign actually contains. The gateway is never
 * imported on this path, so there is no outbound call to stub — the strongest form
 * of "zero sends" available is not being able to make one.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/_react-cache-shim.mjs \
 *     scripts/qa-retry-resolution.mts
 */
import { getSupabaseAdmin } from "../lib/supabase";
import { listLogsByCampaign } from "../lib/sms/store";
import { resolveRetryTargets, retryTargetsAreDisjoint } from "../lib/sms/retryTargets";
import { INSTALLMENT_REMINDER_TEMPLATE_ID } from "../lib/sms/installmentReminderService";

const db = getSupabaseAdmin();
if (!db) throw new Error("no service-role client");

const mask = (p?: string | null) => {
  const d = (p ?? "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `${d.slice(0, 2)}******${d.slice(-2)}` : "—";
};

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const { count: logsBefore } = await db.from("sms_logs").select("*", { count: "exact", head: true });

// Find the campaign id of the real batch.
const { data: seed } = await db
  .from("sms_logs")
  .select("campaign_id")
  .eq("trigger_event", "manual_installment_reminder")
  .gte("created_at", "2026-07-27T21:47:00Z")
  .lt("created_at", "2026-07-27T21:48:00Z")
  .limit(1)
  .single();

const campaignId = seed?.campaign_id;
if (!campaignId) throw new Error("could not find the 21:47 campaign");

console.log("=".repeat(88));
console.log("RETRY RESOLUTION AGAINST THE REAL CAMPAIGN");
console.log("=".repeat(88));
console.log(`campaign ${campaignId}\n`);

const logs = await listLogsByCampaign(campaignId);
const delivered = logs.filter((l) => l.status === "DELIVERED");
const failed = logs.filter((l) => l.status === "FAILED");

console.log(`log rows            ${logs.length}`);
console.log(`  DELIVERED         ${delivered.length}`);
console.log(`  FAILED            ${failed.length}\n`);

const targets = resolveRetryTargets(logs, { templateId: INSTALLMENT_REMINDER_TEMPLATE_ID });

check("the campaign is the one that exposed the bug", logs.length === 86 && delivered.length === 76 && failed.length === 10,
  `${logs.length} rows / ${delivered.length} delivered / ${failed.length} failed`);
check("the retry resolves to exactly 10 targets", targets.enrollmentIds.length === 10,
  `${targets.enrollmentIds.length} targets (the old client would have sent ${logs.length})`);
check("it recognises all 76 reached recipients", targets.reachedEnrollmentIds.length === 76,
  `${targets.reachedEnrollmentIds.length} reached`);
check("targets and reached are disjoint", retryTargetsAreDisjoint(targets));

const deliveredIds = new Set(delivered.map((l) => l.course_enrollment_id));
const leak = targets.enrollmentIds.filter((id) => deliveredIds.has(id));
check("no delivered recipient appears in the target set", leak.length === 0, `${leak.length} leaked`);

const failedIds = new Set(failed.map((l) => l.course_enrollment_id));
const foreign = targets.enrollmentIds.filter((id) => !failedIds.has(id));
check("every target came from a FAILED row", foreign.length === 0, `${foreign.length} not in the failed set`);

console.log(`\nresolved targets (masked, from the log):`);
const byEnrollment = new Map(failed.map((l) => [l.course_enrollment_id, l]));
for (const id of targets.enrollmentIds) {
  const l = byEnrollment.get(id);
  console.log(`  ${mask(l?.mobile)}   installment ${l?.installment_no}   original status ${l?.status} (${l?.error_message})`);
}
console.log(`\nskipped: ${JSON.stringify(targets.skipped)}`);

// A retry OF the retry, once those succeed, must find nothing.
const asIfAllDelivered = logs.map((l) => ({ ...l, status: "DELIVERED" }));
const second = resolveRetryTargets(asIfAllDelivered, { templateId: INSTALLMENT_REMINDER_TEMPLATE_ID });
check("if every row had delivered, a retry would target nobody", second.enrollmentIds.length === 0,
  `${second.enrollmentIds.length} targets`);

const { count: logsAfter } = await db.from("sms_logs").select("*", { count: "exact", head: true });
check("this QA wrote nothing", logsBefore === logsAfter, `sms_logs ${logsBefore} -> ${logsAfter}`);

console.log("\n" + "-".repeat(88));
console.log(`${pass} passed · ${fail} failed`);
process.exit(fail ? 1 : 0);
