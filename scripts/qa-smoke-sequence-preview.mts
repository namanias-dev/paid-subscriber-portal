/**
 * Read-only post-deploy smoke: for real At-Risk Fees students, render the exact
 * two messages the preview modal shows. READS ONLY — no insert, no send, no
 * gateway import is even reachable from here.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/_react-cache-shim.mjs \
 *     scripts/qa-smoke-sequence-preview.mts
 */
import { getAllCourseEnrollments } from "../lib/dataProvider";
import { buildReminderContext, buildReminderFor } from "../lib/sms/installmentReminderService";
import { buildFollowUpPreview, FOLLOW_UP_DELAY_MINUTES } from "../lib/sms/installmentFollowUp";
import { getSupabaseAdmin } from "../lib/supabase";

const mask = (p: string | null | undefined) => {
  const d = (p ?? "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `${d.slice(0, 2)}******${d.slice(-2)}` : "—";
};

const db = getSupabaseAdmin();
const { count: logsBefore } = db ? await db.from("sms_logs").select("*", { count: "exact", head: true }) : { count: null };

const enrollments = await getAllCourseEnrollments();
const followUp = await buildFollowUpPreview();

const now = Date.now();
const candidates = enrollments
  .filter((e) => e.status !== "cancelled" && e.phone)
  .filter((e) =>
    (e.schedule || []).some(
      (l) => l.kind === "installment" && !l.paid && l.status !== "waived" && l.status !== "cancelled" && l.due && new Date(l.due).getTime() < now,
    ),
  )
  .slice(0, 3);

const built = await buildReminderContext(candidates, { now, overdueOnly: true });
if (!built.ok) throw new Error(`context failed: ${built.reason} — ${built.detail}`);

console.log("=".repeat(78));
console.log(`SMOKE — the sequence as staff see it in the preview modal (READ-ONLY)`);
console.log("=".repeat(78));

for (const c of candidates) {
  const p = buildReminderFor(c, built.ctx);
  console.log(`\n${mask(c.phone)}  ·  installment no. ${p.installmentNo}  ·  Rs.${p.amountDue}  ·  sendable: ${p.sendable}`);
  console.log(`  NOW      [${p.segments} seg · DLT ${p.dltTemplateId}]`);
  console.log(`           ${p.body}`);
  console.log(`  +${FOLLOW_UP_DELAY_MINUTES}min   [${followUp.segments} seg · DLT ${followUp.dltTemplateId}]`);
  console.log(`           ${followUp.body}`);
  console.log(`  combined ${p.segments + followUp.segments} segments for this student`);
  const braces = /[{}]/.test(p.body) || /[{}]/.test(followUp.body);
  console.log(`  unresolved placeholders: ${braces ? "YES <-- BUG" : "none"}`);
  if (braces) process.exit(1);
}

const { count: logsAfter } = db ? await db.from("sms_logs").select("*", { count: "exact", head: true }) : { count: null };
console.log("\n" + "-".repeat(78));
console.log(`step 2 body is identical for every student, so the review screen shows it once.`);
console.log(`sms_logs ${logsBefore} -> ${logsAfter}  ${logsBefore === logsAfter ? "(unchanged — this smoke sent nothing)" : "(CHANGED <-- BUG)"}`);
console.log(logsBefore === logsAfter ? "PASS" : "FAIL");
process.exit(logsBefore === logsAfter ? 0 : 1);
