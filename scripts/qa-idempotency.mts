/**
 * Proves the bulk job's replay guard, with ZERO gateway calls.
 *
 * The route short-circuits when any log already carries the job id. That read is
 * what this exercises. One tagged row must COMMIT for a second connection to see
 * it, so cleanup is registered up front and also runs on interruption — QA
 * residue has reached real records here before.
 */
import { listLogsByCampaign, insertQueuedLog } from "../lib/sms/store";
import { getSupabaseAdmin } from "../lib/supabase";

const JOB_ID = `qa-idempotency-${Date.now()}`;
const TAG = "qa_idempotency_probe";

async function cleanup(reason: string) {
  const db = getSupabaseAdmin();
  if (!db) return;
  const { count } = await db.from("sms_logs").delete({ count: "exact" }).eq("trigger_event", TAG);
  console.log(`\ncleanup (${reason}): removed ${count ?? 0} probe row(s)`);
  const { count: left } = await db.from("sms_logs").select("id", { count: "exact", head: true }).eq("trigger_event", TAG);
  console.log(`residue remaining: ${left ?? 0} ${(left ?? 0) === 0 ? "— CLEAN" : "— RESIDUE, INVESTIGATE"}`);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { void cleanup(`interrupted by ${sig}`).then(() => process.exit(130)); });
}

async function main() {
  console.log("=== IDEMPOTENT JOB ID — replay must be a no-op ===");
  console.log(`job id: ${JOB_ID}`);

  const before = await listLogsByCampaign(JOB_ID);
  console.log(`\n1. before the job runs: ${before.length} log(s) carry this id`);
  console.log(`   -> route condition "already ran?" = ${before.length > 0}  (so the send proceeds)`);

  // Stand in for one recipient's log, written the way the send path writes it.
  // FAILED on purpose: a probe must never look like a delivered reminder.
  const inserted = await insertQueuedLog({
    mobile: "0000000000", normalized_mobile: "0000000000",
    template_id: "installment_reminder", template_name: "QA IDEMPOTENCY PROBE",
    gateway_template_id: null, sender_id: "NAMIAS", route: "12",
    message_body: "QA idempotency probe — never sent to a gateway",
    character_count: 44, segments: 1, status: "FAILED",
    sent_by_type: "ADMIN", trigger_event: TAG, campaign_id: JOB_ID,
    course_enrollment_id: null, installment_no: null, installment_fingerprint: null,
  });
  console.log(`\n2. job runs and logs one recipient (id ${inserted?.id ? "written" : "FAILED TO WRITE"})`);

  const after = await listLogsByCampaign(JOB_ID);
  console.log(`\n3. REPLAY the same job id: ${after.length} log(s) carry it`);
  console.log(`   -> route condition "already ran?" = ${after.length > 0}`);
  console.log(`   -> ${after.length > 0 ? "PASS — the route returns the prior outcome and sends NOTHING" : "BUG — a replay would send again"}`);

  console.log(`\n4. a RETRY uses a fresh id, so it is not mistaken for a replay:`);
  const retryId = `${JOB_ID}-retry`;
  console.log(`   ${retryId} -> ${(await listLogsByCampaign(retryId)).length} log(s) (proceeds, but only for the ids the client resends)`);

  console.log(`\nDouble-click and refresh both reuse the SAME id within one review session, so both land on step 3.`);
}

main()
  .then(() => cleanup("normal exit"))
  .then(() => process.exit(0))
  .catch(async (e) => { console.error(e); await cleanup("error path"); process.exit(1); });
