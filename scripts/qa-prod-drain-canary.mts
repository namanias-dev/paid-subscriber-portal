/**
 * Prove the PRODUCTION cron is actually draining `sms_scheduled_sends`.
 *
 * A scheduled job that nothing drains is the classic failure mode here, and an
 * empty queue leaves no trace either way — so "the endpoint exists" proves
 * nothing. This plants one canary row that is DUE NOW and points at an
 * enrollment id that does not exist, then watches prod flip it.
 *
 * WHY A NONEXISTENT ENROLLMENT: re-validation cannot find the enrollment, so the
 * only decision the drain can reach is cancel(enrollment_gone). The row therefore
 * cannot produce a send no matter what — the canary is unsendable BY CONSTRUCTION,
 * not by luck or timing. Its transition from pending to cancelled is only possible
 * if prod claimed and evaluated it, which is exactly the evidence needed.
 *
 * Touches nothing but its own row, which it deletes at the end (including on
 * SIGINT). parent_send_id is a READ-ONLY reference to an existing log.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/_react-cache-shim.mjs \
 *     scripts/qa-prod-drain-canary.mts
 */
import { getSupabaseAdmin } from "../lib/supabase";
import { INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID } from "../lib/sms/installmentFollowUp";

const db = getSupabaseAdmin();
if (!db) throw new Error("no service-role client");

const CANARY_ENROLLMENT = `qa-drain-canary-${Date.now()}`;
let canaryId: string | null = null;

async function cleanup() {
  if (!canaryId) return;
  await db!.from("sms_scheduled_sends").delete().eq("id", canaryId);
  console.log(`\ncleanup: canary row ${canaryId.slice(0, 8)}… deleted`);
  canaryId = null;
}
process.on("SIGINT", async () => { await cleanup(); process.exit(130); });
process.on("SIGTERM", async () => { await cleanup(); process.exit(143); });

try {
  // A real log id to satisfy the parent_send_id FK. Read-only.
  const { data: anyLog } = await db.from("sms_logs").select("id").limit(1).single();
  if (!anyLog) throw new Error("no sms_logs row to reference");

  const { count: beforeCount } = await db.from("sms_logs").select("*", { count: "exact", head: true });

  const { data: inserted, error } = await db
    .from("sms_scheduled_sends")
    .insert({
      template_id: INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID,
      normalized_mobile: "9999999999",
      student_name: "QA Drain Canary",
      course_enrollment_id: CANARY_ENROLLMENT,
      installment_no: 1,
      parent_send_id: anyLog.id,
      scheduled_at: new Date(Date.now() - 60_000).toISOString(), // already due
      status: "pending",
      actor_type: "SYSTEM",
      job_id: CANARY_ENROLLMENT,
    })
    .select("id, status, scheduled_at")
    .single();
  if (error) throw error;
  canaryId = inserted.id;

  console.log("=".repeat(76));
  console.log("PROD CRON DRAIN PROOF — canary planted");
  console.log("=".repeat(76));
  console.log(`row            ${canaryId}`);
  console.log(`enrollment     ${CANARY_ENROLLMENT} (does not exist -> unsendable by construction)`);
  console.log(`scheduled_at   ${inserted.scheduled_at} (already due)`);
  console.log(`status         ${inserted.status}`);
  console.log(`sms_logs count ${beforeCount}`);
  console.log(`\nwaiting for the production cron (*/2) to claim and evaluate it...\n`);

  const startedAt = Date.now();
  let final: { status: string; attempts: number; cancel_reason: string | null; finished_at: string | null; sent_log_id: string | null } | null = null;

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const { data: row } = await db
      .from("sms_scheduled_sends")
      .select("status, attempts, cancel_reason, finished_at, sent_log_id")
      .eq("id", canaryId)
      .single();
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`  +${String(elapsed).padStart(3)}s  status=${row?.status}  attempts=${row?.attempts}  reason=${row?.cancel_reason ?? "-"}`);
    if (row && row.status !== "pending") { final = row as typeof final; break; }
  }

  const { count: afterCount } = await db.from("sms_logs").select("*", { count: "exact", head: true });

  console.log("\n" + "-".repeat(76));
  if (!final) {
    console.log("FAIL — the row was never claimed. Nothing is draining the queue in production.");
    await cleanup();
    process.exit(1);
  }

  const drained = final.status === "cancelled" && final.cancel_reason === "enrollment_gone";
  console.log(`drained by prod       ${final.status !== "pending" ? "YES" : "NO"}  (status ${final.status}, attempt ${final.attempts})`);
  console.log(`cancel reason         ${final.cancel_reason}`);
  console.log(`finished_at           ${final.finished_at}`);
  console.log(`re-validated at send  ${drained ? "YES — it refused to send because the enrollment was gone" : "NO"}`);
  console.log(`sent                  ${final.sent_log_id ? `YES (${final.sent_log_id}) <-- UNEXPECTED` : "NO"}`);
  console.log(`sms_logs ${beforeCount} -> ${afterCount ?? "?"}  ${afterCount === beforeCount ? "(unchanged — zero real sends)" : "(CHANGED)"}`);
  console.log("-".repeat(76));
  console.log(drained && afterCount === beforeCount
    ? "PASS — the production cron claimed a due job, re-validated it, cancelled it with a\n       reason, and sent nothing. The queue is being drained for real."
    : "FAIL — see above.");

  await cleanup();
  process.exit(drained && afterCount === beforeCount ? 0 : 1);
} catch (e) {
  console.error("\nERROR:", (e as Error).message);
  await cleanup();
  process.exit(1);
}
