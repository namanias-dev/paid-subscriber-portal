/**
 * Retry ONLY the FAILED recipients of the 2026-07-27 21:47 UTC bulk installment
 * reminder batch. THIS SCRIPT PERFORMS REAL SENDS and is the one authorised
 * exception to the zero-sends rule.
 *
 * IT REUSES THE EXISTING SEND PATH. The target list is re-resolved by
 * `buildBulkInstallmentReminders` — the same builder the review screen and the
 * live send both call — and delivered by `sendBatch`, the same function the bulk
 * route calls, with the same template, trigger and actor type. Nothing about
 * rendering, screening, the hard send guard, opt-out suppression, caps or the
 * insert-then-send dedupe is reimplemented here. The one layer not executed is
 * the route's HTTP permission wrapper, which reads a signed admin cookie that
 * cannot exist outside a browser request; forging one would be worse than
 * stating this plainly.
 *
 * DRY RUN BY DEFAULT. It sends only with CONFIRM_SEND=yes, so a careless
 * invocation prints the plan and exits.
 *
 * WHY STEP 2 IS NOT QUEUED. The authorisation covers ten messages. Queueing the
 * +30min instructions would make it twenty, and would hand these ten a follow-up
 * the 76 delivered recipients never got. Suppressing it keeps the retry inside
 * its authorisation AND leaves all 86 recipients treated identically. Sending
 * the instructions to anyone remains a deliberate, separate decision.
 *
 *   CONFIRM_SEND=yes node --env-file=.env.local --import tsx \
 *     --import ./scripts/_react-cache-shim.mjs \
 *     scripts/retry-failed-installment-reminders.mts
 */
import { getSupabaseAdmin } from "../lib/supabase";
import { getCourseEnrollmentById } from "../lib/dataProvider";
import { sendBatch } from "../lib/sms/service";
import { buildBulkInstallmentReminders, INSTALLMENT_REMINDER_TEMPLATE_ID } from "../lib/sms/installmentReminderService";
import { lineOutstandingAmount } from "../lib/sms/installmentAttribution";
import type { CourseEnrollment } from "../lib/types";

const db = getSupabaseAdmin();
if (!db) throw new Error("no service-role client");

const LIVE = process.env.CONFIRM_SEND === "yes";
const EXPECTED_FAILURES = 10;
const BATCH_FROM = "2026-07-27T21:47:00Z";
const BATCH_TO = "2026-07-27T21:48:00Z";

const mask = (p?: string | null) => {
  const d = (p ?? "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `${d.slice(0, 2)}******${d.slice(-2)}` : "—";
};
const die = (msg: string): never => { console.error(`\nABORT — ${msg}`); process.exit(1); };

// ---------------------------------------------------------------------------
// 1. Re-derive the target set FROM THE LOG, never from a pasted list.
// ---------------------------------------------------------------------------
const { data: batch, error } = await db
  .from("sms_logs")
  .select("id, status, error_message, mobile, normalized_mobile, course_enrollment_id, installment_no, campaign_id")
  .eq("trigger_event", "manual_installment_reminder")
  .gte("created_at", BATCH_FROM)
  .lt("created_at", BATCH_TO);
if (error) die(`could not read the batch: ${error.message}`);

const rows = batch ?? [];
const failed = rows.filter((r) => r.status === "FAILED");
const deliveredEnrollmentIds = new Set(rows.filter((r) => r.status !== "FAILED").map((r) => r.course_enrollment_id));

console.log("=".repeat(94));
console.log(`RETRY OF FAILED INSTALLMENT REMINDERS — ${LIVE ? "*** LIVE, REAL SENDS ***" : "DRY RUN"}`);
console.log("=".repeat(94));
console.log(`batch window       ${BATCH_FROM} .. ${BATCH_TO}`);
console.log(`rows in batch      ${rows.length}  (${rows.length - failed.length} delivered, ${failed.length} failed)`);
console.log(`failure reasons    ${JSON.stringify([...new Set(failed.map((r) => r.error_message))])}`);

if (failed.length !== EXPECTED_FAILURES) {
  die(`expected exactly ${EXPECTED_FAILURES} FAILED rows, found ${failed.length}. Refusing to act on a set I do not recognise.`);
}

const failedEnrollmentIds = [...new Set(failed.map((r) => r.course_enrollment_id).filter((x): x is string => !!x))];
if (failedEnrollmentIds.length !== EXPECTED_FAILURES) {
  die(`${failed.length} failed rows map to ${failedEnrollmentIds.length} enrollments; the 1:1 mapping the retry relies on does not hold.`);
}

// ---------------------------------------------------------------------------
// 2. Re-validate against CURRENT state with the production builder.
//    7.5 hours is long enough for a student to have paid.
// ---------------------------------------------------------------------------
const preview = await buildBulkInstallmentReminders(failedEnrollmentIds, { overdueOnly: true });
if (preview.blockReason) die(`the builder refused the whole set: ${preview.blockReason} — ${preview.blockDetail}`);

const logByEnrollment = new Map(failed.map((r) => [r.course_enrollment_id!, r]));
const targets: { enrollmentId: string; masked: string; installmentNo: number | null; amount: number | null }[] = [];
const dropped: { masked: string; reason: string }[] = [];

for (const p of preview.previews) {
  const log = logByEnrollment.get(p.enrollmentId);
  const masked = mask(log?.mobile);
  const e = await getCourseEnrollmentById(p.enrollmentId);

  if (!e) { dropped.push({ masked, reason: "enrollment no longer readable" }); continue; }
  if (e.status === "cancelled") { dropped.push({ masked, reason: "enrolment cancelled" }); continue; }

  // Settled-since check, independent of the builder, on the SAME line the
  // original reminder named. This is the failure the auto-cancel rules exist for.
  const line = (e.schedule ?? []).find((l) => l.no === log?.installment_no && l.kind === "installment");
  if (!line) { dropped.push({ masked, reason: `installment ${log?.installment_no} no longer in the schedule (plan change)` }); continue; }
  if (line.status === "waived" || line.status === "cancelled") { dropped.push({ masked, reason: `installment ${line.status}` }); continue; }
  if (line.paid || lineOutstandingAmount(line) <= 0) { dropped.push({ masked, reason: "PAID SINCE the original send" }); continue; }

  if (!p.sendable) { dropped.push({ masked, reason: `${p.blockReason}${p.blockDetail ? ` — ${p.blockDetail}` : ""}` }); continue; }

  targets.push({ enrollmentId: p.enrollmentId, masked, installmentNo: p.installmentNo, amount: p.amountDue });
}

// ---------------------------------------------------------------------------
// 3. Containment: the delivered 76 must be unreachable.
// ---------------------------------------------------------------------------
const overlap = targets.filter((t) => deliveredEnrollmentIds.has(t.enrollmentId));
if (overlap.length) die(`${overlap.length} target(s) already DELIVERED in the original batch. Refusing to re-send to a success.`);

console.log(`\nTARGET LIST — ${targets.length} recipient(s)`);
console.log("-".repeat(94));
for (const t of targets) {
  console.log(`  ${t.masked}   installment no. ${t.installmentNo}   Rs.${t.amount}`);
}
if (dropped.length) {
  console.log(`\nDROPPED BY RE-VALIDATION — ${dropped.length}`);
  for (const d of dropped) console.log(`  ${d.masked}   ${d.reason}`);
} else {
  console.log(`\nDROPPED BY RE-VALIDATION — none; all ${targets.length} are still unpaid and still sendable.`);
}
console.log(`\ncontainment        ${overlap.length} of the 76 delivered recipients are reachable by this list`);
console.log(`step 2 (+30m)      NOT queued — the authorisation covers ${EXPECTED_FAILURES} messages, and the delivered 76 got no instructions either`);

if (!targets.length) { console.log("\nNothing to send. Exiting."); process.exit(0); }
if (targets.length > EXPECTED_FAILURES) die(`target count ${targets.length} exceeds the authorised ${EXPECTED_FAILURES}`);

if (!LIVE) {
  console.log(`\nDRY RUN — nothing was sent. Re-run with CONFIRM_SEND=yes to send to the ${targets.length} above.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 4. Send, through the same sendBatch the bulk route uses.
// ---------------------------------------------------------------------------
const { count: logsBefore } = await db.from("sms_logs").select("*", { count: "exact", head: true });
const jobId = `retry-dlr-other-${Date.now()}`;

const enrollments = new Map<string, CourseEnrollment>();
for (const e of await Promise.all(targets.map((t) => getCourseEnrollmentById(t.enrollmentId)))) {
  if (e) enrollments.set(e.id, e);
}
const previewById = new Map(preview.previews.map((p) => [p.enrollmentId, p]));

const recipients = targets.flatMap((t) => {
  const e = enrollments.get(t.enrollmentId);
  const p = previewById.get(t.enrollmentId);
  if (!e || !p) return [];
  return [{
    mobile: e.phone,
    variables: Object.fromEntries(p.variables.map((v) => [v.token, v.value])),
    relatedEntity: { student_name: e.student_name, course_id: e.course_id, user_id: e.student_id ?? null },
    installmentKey: p.installmentKey,
  }];
});

console.log(`\nsending ${recipients.length} … (job ${jobId})`);
const result = await sendBatch({
  recipients,
  templateId: INSTALLMENT_REMINDER_TEMPLATE_ID,
  sentBy: { userId: null, type: "ADMIN" },
  audienceType: "installment_reminder",
  triggerEvent: "manual_installment_reminder",
  campaignId: jobId,
  // Deliberately NOT overridden: the 30-min guard stays armed, so if any of these
  // had been sent again in the meantime the send would refuse rather than repeat.
  allowRecentOverride: false,
});

console.log(`\nsendBatch: requested ${result.requested} · sent ${result.sent} · failed ${result.failed} · mode ${result.mode} · skipped ${JSON.stringify(result.skipped)}`);

// ---------------------------------------------------------------------------
// 5. Per-recipient outcome from the log this job wrote.
// ---------------------------------------------------------------------------
const { data: jobLogs } = await db
  .from("sms_logs")
  .select("mobile, status, error_message, course_enrollment_id, installment_no, gateway_message_id")
  .eq("campaign_id", jobId);

console.log(`\nPER-RECIPIENT OUTCOME (job ${jobId})`);
console.log("-".repeat(94));
for (const l of jobLogs ?? []) {
  console.log(`  ${mask(l.mobile)}   inst ${l.installment_no}   ${l.status}${l.error_message ? `   ${l.error_message}` : ""}`);
}

const { count: logsAfter } = await db.from("sms_logs").select("*", { count: "exact", head: true });
const { data: queued } = await db.from("sms_scheduled_sends").select("id, status, course_enrollment_id").eq("job_id", jobId);
const { count: queueTotal } = await db.from("sms_scheduled_sends").select("*", { count: "exact", head: true });

console.log("\n" + "=".repeat(94));
console.log(`sms_logs           ${logsBefore} -> ${logsAfter}  (+${(logsAfter ?? 0) - (logsBefore ?? 0)})`);
console.log(`instructions jobs queued by this retry: ${queued?.length ?? 0}   (whole queue: ${queueTotal ?? 0})`);
console.log("=".repeat(94));
