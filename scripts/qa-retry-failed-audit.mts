/**
 * READ-ONLY audit of the 21:47 UTC bulk batch, and re-validation of the FAILED
 * recipients against current state.
 *
 * Sends nothing. Imports no gateway. Prints masked identities only.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/_react-cache-shim.mjs \
 *     scripts/qa-retry-failed-audit.mts
 */
import { getSupabaseAdmin } from "../lib/supabase";
import { getCourseEnrollmentById } from "../lib/dataProvider";
import { buildBulkInstallmentReminders } from "../lib/sms/installmentReminderService";
import { lineOutstandingAmount } from "../lib/sms/installmentAttribution";

const db = getSupabaseAdmin();
if (!db) throw new Error("no service-role client");

const mask = (p?: string | null) => {
  const d = (p ?? "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `${d.slice(0, 2)}******${d.slice(-2)}` : "—";
};
const tail = (p?: string | null) => (p ?? "").replace(/\D/g, "").slice(-4);

const BATCH_FROM = "2026-07-27T21:47:00Z";
const BATCH_TO = "2026-07-27T21:48:00Z";

const { data: batch } = await db
  .from("sms_logs")
  .select("id, created_at, status, error_message, mobile, normalized_mobile, course_enrollment_id, installment_no, installment_fingerprint, campaign_id, template_id, message_body")
  .eq("trigger_event", "manual_installment_reminder")
  .gte("created_at", BATCH_FROM)
  .lt("created_at", BATCH_TO)
  .order("created_at");

const rows = batch ?? [];
console.log("=".repeat(92));
console.log("THE 21:47 UTC BATCH");
console.log("=".repeat(92));
const byStatus = rows.reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
console.log(`rows: ${rows.length}  ${JSON.stringify(byStatus)}`);
console.log(`distinct recipients: ${new Set(rows.map((r) => r.normalized_mobile)).size}`);
console.log(`campaign ids: ${[...new Set(rows.map((r) => r.campaign_id))].length}`);
console.log(`carrying an attribution key: ${rows.filter((r) => r.course_enrollment_id && r.installment_no != null).length}`);
console.log(`bodies with unresolved braces: ${rows.filter((r) => /[{}]/.test(r.message_body ?? "")).length}`);

const failed = rows.filter((r) => r.status === "FAILED");
const delivered = rows.filter((r) => r.status !== "FAILED");
console.log(`\nFAILED: ${failed.length}   other: ${delivered.length}`);
console.log(`failure error_message values: ${JSON.stringify([...new Set(failed.map((r) => r.error_message))])}`);

console.log(`\nfailed masked tails (sorted): ${failed.map((r) => tail(r.mobile)).sort().join(", ")}`);

// ---------------------------------------------------------------------------
// Re-validate the failed set against CURRENT state, using the same builder the
// review screen and the send both use. No second rule set.
// ---------------------------------------------------------------------------
const failedEnrollmentIds = [...new Set(failed.map((r) => r.course_enrollment_id).filter((x): x is string => !!x))];
console.log(`\ndistinct enrollments behind the failures: ${failedEnrollmentIds.length}`);

const preview = await buildBulkInstallmentReminders(failedEnrollmentIds, { overdueOnly: true });

console.log("\n" + "=".repeat(92));
console.log("RE-VALIDATION AGAINST CURRENT STATE (7.5h later)");
console.log("=".repeat(92));
console.log(`${"phone".padEnd(12)} ${"orig".padEnd(5)} ${"now".padEnd(9)} ${"inst".padEnd(5)} ${"amount".padEnd(9)} ${"outstanding".padEnd(12)} reason / note`);
console.log("-".repeat(92));

const logByEnrollment = new Map(failed.map((r) => [r.course_enrollment_id!, r]));
let sendableNow = 0;
const sendableIds: string[] = [];

for (const p of preview.previews) {
  const log = logByEnrollment.get(p.enrollmentId);
  const e = await getCourseEnrollmentById(p.enrollmentId);
  const line = (e?.schedule ?? []).find((l) => l.no === log?.installment_no && l.kind === "installment");
  const outstanding = line ? lineOutstandingAmount(line) : null;
  const paidNow = !!line?.paid || (outstanding !== null && outstanding <= 0);
  const note = p.sendable
    ? (paidNow ? "SETTLED SINCE — must not be chased" : `ok${p.warnings.length ? ` · ${p.warnings.length} warning(s)` : ""}`)
    : `EXCLUDED: ${p.blockReason}${p.blockDetail ? ` — ${p.blockDetail}` : ""}`;
  if (p.sendable && !paidNow) { sendableNow++; sendableIds.push(p.enrollmentId); }
  console.log(
    `${mask(log?.mobile).padEnd(12)} ${"FAILED".padEnd(5)} ${(p.sendable ? "sendable" : "blocked").padEnd(9)} ` +
    `${String(p.installmentNo ?? "—").padEnd(5)} ${String(p.amountDue ?? "—").padEnd(9)} ${String(outstanding ?? "—").padEnd(12)} ${note}`,
  );
}

console.log("-".repeat(92));
console.log(`sendable after re-validation: ${sendableNow} of ${failed.length}`);
console.log(`excluded by reason: ${JSON.stringify(preview.excludedByReason)}`);

// ---------------------------------------------------------------------------
// Prove the delivered 76 are not in the retry target set.
// ---------------------------------------------------------------------------
const deliveredEnrollments = new Set(delivered.map((r) => r.course_enrollment_id));
const overlap = sendableIds.filter((id) => deliveredEnrollments.has(id));
console.log("\n" + "=".repeat(92));
console.log("CONTAINMENT");
console.log("=".repeat(92));
console.log(`retry target enrollments: ${sendableIds.length}`);
console.log(`of those, any that already DELIVERED: ${overlap.length} ${overlap.length === 0 ? "— PASS, the delivered set is untouchable by this target list" : "<-- ABORT"}`);

// ---------------------------------------------------------------------------
// The 30-min hard guard vs the 24h warning.
// ---------------------------------------------------------------------------
const oldestFailure = failed[0]?.created_at;
const hoursSince = oldestFailure ? (Date.now() - new Date(oldestFailure).getTime()) / 3600_000 : 0;
console.log("\n" + "=".repeat(92));
console.log("IDEMPOTENCY GUARDS");
console.log("=".repeat(92));
console.log(`hours since the batch: ${hoursSince.toFixed(2)}`);
console.log(`hard guard (SAME_TRIGGER_WINDOW_MIN, service.ts:18): 30 min -> ${hoursSince * 60 > 30 ? "already elapsed, does NOT block" : "WOULD BLOCK"}`);
console.log(`24h figure (REPEAT_WARN_WINDOW_HOURS, installmentReminderService.ts:41): a non-blocking WARNING, not a block`);
console.log(`=> a retry needs no override and bypasses nothing.`);

console.log(`\nsendable enrollment ids for the retry:\n${JSON.stringify(sendableIds, null, 2)}`);
