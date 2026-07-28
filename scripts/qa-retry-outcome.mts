/**
 * READ-ONLY report on the retry: per-recipient send outcome, the follow-up queue
 * it created, and whether each job transitioned exactly once.
 *
 *   CAMPAIGN=<original campaign id> node --env-file=.env.local --import tsx \
 *     --import ./scripts/_react-cache-shim.mjs scripts/qa-retry-outcome.mts
 */
import { getSupabaseAdmin } from "../lib/supabase";

const db = getSupabaseAdmin();
if (!db) throw new Error("no service-role client");

const original = process.env.CAMPAIGN ?? "0f4dcc21-9ed3-458e-86af-143c4fbbab04";
const jobId = `retry:${original}`;

const mask = (p?: string | null) => {
  const d = (p ?? "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `${d.slice(0, 2)}******${d.slice(-2)}` : "—";
};
const ist = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso)) : "—";

const { data: sends } = await db
  .from("sms_logs")
  .select("id, mobile, status, error_message, created_at, sent_at, installment_no, course_enrollment_id, segments, gateway_message_id")
  .eq("campaign_id", jobId)
  .order("created_at");

console.log("=".repeat(94));
console.log(`STEP 1 — the retry send (job ${jobId})`);
console.log("=".repeat(94));
console.log(`${"phone".padEnd(12)} ${"inst".padEnd(5)} ${"status".padEnd(10)} ${"seg".padEnd(4)} ${"sent (IST)".padEnd(11)} gateway id`);
console.log("-".repeat(94));
for (const l of sends ?? []) {
  console.log(
    `${mask(l.mobile).padEnd(12)} ${String(l.installment_no).padEnd(5)} ${String(l.status).padEnd(10)} ` +
    `${String(l.segments).padEnd(4)} ${ist(l.sent_at ?? l.created_at).padEnd(11)} ${l.gateway_message_id ?? "—"}` +
    `${l.error_message ? `  err=${l.error_message}` : ""}`,
  );
}
const byStatus = (sends ?? []).reduce<Record<string, number>>((a, l) => ((a[l.status] = (a[l.status] ?? 0) + 1), a), {});
console.log(`\n${sends?.length ?? 0} rows — ${JSON.stringify(byStatus)}`);

// ---- containment: did the retry touch anyone from the original 76? ----
const { data: originalLogs } = await db
  .from("sms_logs")
  .select("normalized_mobile, status")
  .eq("campaign_id", original);
const deliveredNumbers = new Set((originalLogs ?? []).filter((l) => l.status !== "FAILED").map((l) => l.normalized_mobile));
const retried = new Set((sends ?? []).map((l) => l.mobile?.replace(/\D/g, "").slice(-10)));
const overlap = [...retried].filter((n) => deliveredNumbers.has(n!));
console.log(`recipients of the original batch that DELIVERED: ${deliveredNumbers.size}`);
console.log(`of those, contacted again by the retry: ${overlap.length} ${overlap.length === 0 ? "— PASS" : "<-- INCIDENT"}`);

// ---- the follow-up queue ----
const { data: jobs } = await db
  .from("sms_scheduled_sends")
  .select("id, normalized_mobile, installment_no, status, scheduled_at, attempts, claimed_at, finished_at, sent_log_id, cancel_reason, last_error, parent_send_id, created_at")
  .eq("job_id", jobId)
  .order("scheduled_at");

console.log("\n" + "=".repeat(94));
console.log("STEP 2 — the scheduled instructions queue");
console.log("=".repeat(94));
console.log(`${"phone".padEnd(12)} ${"inst".padEnd(5)} ${"status".padEnd(10)} ${"att".padEnd(4)} ${"due (IST)".padEnd(11)} ${"finished".padEnd(11)} outcome`);
console.log("-".repeat(94));
for (const j of jobs ?? []) {
  const outcome = j.sent_log_id ? `sent, log ${j.sent_log_id.slice(0, 8)}…` : j.cancel_reason ? `cancelled: ${j.cancel_reason}` : j.last_error ? `error: ${j.last_error}` : "pending";
  console.log(
    `${mask(j.normalized_mobile).padEnd(12)} ${String(j.installment_no).padEnd(5)} ${String(j.status).padEnd(10)} ` +
    `${String(j.attempts).padEnd(4)} ${ist(j.scheduled_at).padEnd(11)} ${ist(j.finished_at).padEnd(11)} ${outcome}`,
  );
}
const jobStatus = (jobs ?? []).reduce<Record<string, number>>((a, j) => ((a[j.status] = (a[j.status] ?? 0) + 1), a), {});
console.log(`\n${jobs?.length ?? 0} jobs — ${JSON.stringify(jobStatus)}`);

const dueAt = jobs?.[0]?.scheduled_at;
if (dueAt) {
  const mins = (new Date(dueAt).getTime() - Date.now()) / 60000;
  console.log(`first job due ${ist(dueAt)} IST — ${mins > 0 ? `${mins.toFixed(1)} min from now` : `${Math.abs(mins).toFixed(1)} min ago`}`);
}

// ---- each job must have transitioned exactly once ----
console.log("\nEXACTLY-ONCE CHECKS");
const oneAttempt = (jobs ?? []).filter((j) => j.attempts <= 1).length;
console.log(`  jobs with at most one attempt        : ${oneAttempt} of ${jobs?.length ?? 0}`);
const sentJobs = (jobs ?? []).filter((j) => j.status === "sent");
const distinctLogs = new Set(sentJobs.map((j) => j.sent_log_id));
console.log(`  jobs marked sent                     : ${sentJobs.length}`);
console.log(`  distinct send logs behind them        : ${distinctLogs.size} ${sentJobs.length === distinctLogs.size ? "— one log each, no double-send" : "<-- MISMATCH"}`);
const distinctParents = new Set((jobs ?? []).map((j) => j.parent_send_id));
console.log(`  distinct parent sends                : ${distinctParents.size} (one per retried reminder)`);

// Any instructions log at all — the definitive proof of whether step 2 went out.
const { data: instructionLogs } = await db
  .from("sms_logs")
  .select("id, mobile, status, created_at, error_message")
  .eq("template_id", "installment_instructions")
  .order("created_at");
console.log(`\n  logs on the instructions template     : ${instructionLogs?.length ?? 0}`);
for (const l of instructionLogs ?? []) {
  console.log(`    ${ist(l.created_at)} IST  ${mask(l.mobile)}  ${l.status}${l.error_message ? `  ${l.error_message}` : ""}`);
}

const { count: total } = await db.from("sms_logs").select("*", { count: "exact", head: true });
console.log(`\nsms_logs total: ${total}`);
