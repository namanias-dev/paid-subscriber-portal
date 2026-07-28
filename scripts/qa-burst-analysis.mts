/**
 * READ-ONLY: did the 51/sec burst plausibly cause the dlr:Other failures?
 *
 * Sends nothing. The point is to test the burst hypothesis against the log rather
 * than assume it, including the evidence that argues AGAINST it.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/_react-cache-shim.mjs \
 *     scripts/qa-burst-analysis.mts
 */
import { getSupabaseAdmin } from "../lib/supabase";

const db = getSupabaseAdmin();
if (!db) throw new Error("no service-role client");

const { data: batch } = await db
  .from("sms_logs")
  .select("id, created_at, sent_at, status, error_message, segments, route, sender_id, gateway_message_id")
  .eq("trigger_event", "manual_installment_reminder")
  .gte("created_at", "2026-07-27T21:47:00Z")
  .lt("created_at", "2026-07-27T21:48:00Z")
  .order("created_at");

const rows = batch ?? [];
const t0 = new Date(rows[0]?.created_at ?? 0).getTime();
const tN = new Date(rows[rows.length - 1]?.created_at ?? 0).getTime();

console.log("=".repeat(88));
console.log("BURST PROFILE");
console.log("=".repeat(88));
console.log(`rows                ${rows.length}`);
console.log(`wall clock          ${((tN - t0) / 1000).toFixed(2)}s`);
console.log(`implied rate        ${(rows.length / Math.max((tN - t0) / 1000, 0.001)).toFixed(1)}/sec`);
console.log(`gateway msg ids     ${rows.filter((r) => r.gateway_message_id).length} of ${rows.length} rows carry one`);
console.log(`routes / senders    ${JSON.stringify([...new Set(rows.map((r) => `${r.sender_id}/${r.route}`))])}`);

// Per-100ms histogram — shows whether it was paced at all.
const buckets = new Map<number, { n: number; failed: number }>();
for (const r of rows) {
  const b = Math.floor((new Date(r.created_at).getTime() - t0) / 100);
  const cur = buckets.get(b) ?? { n: 0, failed: 0 };
  cur.n++;
  if (r.status === "FAILED") cur.failed++;
  buckets.set(b, cur);
}
console.log(`\nper-100ms arrival histogram (bar = sends, F = failures in that slice):`);
for (const [b, v] of [...buckets.entries()].sort((a, c) => a[0] - c[0])) {
  console.log(`  +${String(b * 100).padStart(4)}ms  ${"#".repeat(v.n).padEnd(24)} ${v.n.toString().padStart(2)}${v.failed ? `   ${"F".repeat(v.failed)}` : ""}`);
}

// Where in the burst did the failures land? If burst pressure caused them, they
// should skew to the dense slices rather than spread evenly.
const failed = rows.filter((r) => r.status === "FAILED");
const positions = failed.map((r) => rows.findIndex((x) => x.id === r.id) + 1);
console.log(`\nfailure positions within the ordered batch (1..${rows.length}): ${positions.sort((a, b) => a - b).join(", ")}`);
const firstHalf = positions.filter((p) => p <= rows.length / 2).length;
console.log(`first half ${firstHalf} · second half ${positions.length - firstHalf}  -> ${firstHalf === positions.length || firstHalf === 0 ? "CLUSTERED" : "spread across the whole batch"}`);

// ---------------------------------------------------------------------------
// The counter-evidence: isolated single sends failing the same way.
// ---------------------------------------------------------------------------
const { data: window } = await db
  .from("sms_logs")
  .select("created_at, template_id, trigger_event, status, error_message")
  .gte("created_at", "2026-07-27T18:00:00Z")
  .lt("created_at", "2026-07-28T06:00:00Z")
  .order("created_at");

const all = window ?? [];
const dlrOther = all.filter((r) => r.error_message === "dlr:Other");
console.log("\n" + "=".repeat(88));
console.log("COUNTER-EVIDENCE — dlr:Other outside the burst");
console.log("=".repeat(88));
console.log(`dlr:Other in the 12h window: ${dlrOther.length}`);
const byTrigger = dlrOther.reduce<Record<string, number>>((a, r) => ((a[r.trigger_event ?? "—"] = (a[r.trigger_event ?? "—"] ?? 0) + 1), a), {});
console.log(`by trigger: ${JSON.stringify(byTrigger, null, 2)}`);
for (const r of dlrOther.filter((r) => r.trigger_event !== "manual_installment_reminder")) {
  console.log(`  ISOLATED SEND FAILED THE SAME WAY: ${r.created_at}  ${r.template_id}  trigger=${r.trigger_event}`);
}

const bulkFailRate = failed.length / rows.length;
const isolated = all.filter((r) => r.trigger_event !== "manual_installment_reminder");
const isolatedFailed = isolated.filter((r) => r.error_message === "dlr:Other");
console.log(`\nfailure rate inside the 51/sec burst : ${(bulkFailRate * 100).toFixed(1)}%  (${failed.length}/${rows.length})`);
console.log(`failure rate on non-burst traffic    : ${((isolatedFailed.length / Math.max(isolated.length, 1)) * 100).toFixed(1)}%  (${isolatedFailed.length}/${isolated.length})`);
console.log(`\nNOTE: the non-burst sample is ${isolated.length} messages — far too small to compare rates`);
console.log(`      with any confidence. It establishes that dlr:Other happens WITHOUT a burst;`);
console.log(`      it cannot establish that the burst did or did not raise the rate.`);
