/**
 * Zero-send audit for this run. Read-only.
 *
 * Two independent proofs:
 *   1) NOTHING was ever sent on the new instructions template — if a follow-up
 *      had fired for real, there would be a log row carrying its id.
 *   2) Every log created during this session is accounted for by name, so a
 *      count that moved cannot hide a send of mine inside unrelated traffic.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/_react-cache-shim.mjs \
 *     scripts/qa-zero-send-audit.mts
 */
import { getSupabaseAdmin } from "../lib/supabase";
import { INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID } from "../lib/sms/installmentFollowUp";

const db = getSupabaseAdmin();
if (!db) throw new Error("no service-role client");

const mask = (p: string | null | undefined) => {
  const d = (p ?? "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `${d.slice(0, 2)}******${d.slice(-2)}` : "—";
};

console.log("=".repeat(84));
console.log("ZERO-SEND AUDIT");
console.log("=".repeat(84));

const { count: total } = await db.from("sms_logs").select("*", { count: "exact", head: true });
console.log(`sms_logs total: ${total}`);

// ---- proof 1: the new template has never been sent ----
const { data: instructionLogs, count: instructionCount } = await db
  .from("sms_logs")
  .select("id, created_at, status, template_id, gateway_template_id", { count: "exact" })
  .or(`template_id.eq.${INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID},gateway_template_id.eq.1777178519743722233`);

console.log(`\nlogs on the Installment Instructions template (either id): ${instructionCount ?? 0}`);
console.log(
  instructionCount
    ? `  <-- UNEXPECTED\n${JSON.stringify(instructionLogs, null, 2)}`
    : "  PASS — step 2 has never gone out to anyone, so no follow-up fired for real.",
);

// ---- proof 2: account for every log written today ----
const since = new Date(Date.now() - 8 * 3600 * 1000).toISOString();
const { data: recent } = await db
  .from("sms_logs")
  .select("id, created_at, template_id, template_name, status, mobile, trigger_event, sent_by_type, campaign_id, course_enrollment_id, installment_no")
  .gte("created_at", since)
  .order("created_at", { ascending: false });

console.log(`\nlogs created in the last 8h: ${recent?.length ?? 0}`);
for (const r of recent ?? []) {
  console.log(
    `  ${r.created_at}  ${mask(r.mobile)}  ${(r.template_id ?? "—").padEnd(26)} ${(r.status ?? "—").padEnd(9)}` +
      ` trigger=${r.trigger_event ?? "—"} by=${r.sent_by_type ?? "—"}` +
      ` enr=${r.course_enrollment_id ? "yes" : "no"} inst=${r.installment_no ?? "—"}`,
  );
}

const mine = (recent ?? []).filter(
  (r) => r.template_id === INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID || r.gateway_template_id === "1777178519743722233",
);
console.log(`\nof those, attributable to the new sequence: ${mine.length}`);

// ---- the queue itself ----
const { data: queue } = await db.from("sms_scheduled_sends").select("id, status, cancel_reason, scheduled_at, sent_log_id");
const byStatus = (queue ?? []).reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
console.log(`\nsms_scheduled_sends rows: ${queue?.length ?? 0}  ${JSON.stringify(byStatus)}`);
const everSent = (queue ?? []).filter((r) => r.sent_log_id);
console.log(`rows that ever produced a real send: ${everSent.length}`);

console.log("\n" + "-".repeat(84));
const clean = (instructionCount ?? 0) === 0 && mine.length === 0 && everSent.length === 0;
console.log(clean ? "PASS — zero real sends from this work." : "FAIL — see above.");
process.exit(clean ? 0 : 1);
