/**
 * Remove the log rows written by a retry attempt that never reached the gateway.
 *
 * WHY REMOVE THEM. sms_logs records messages that were handed to the gateway. The
 * rows this deletes failed with "fetch failed" — a TLS handshake this machine's
 * IP is not permitted to complete — so no message was ever offered to the
 * gateway, let alone a handset. Leaving them would put ten failures that are
 * about a local network into the middle of an open investigation into real
 * delivery failures, where they are indistinguishable at a glance and would
 * inflate the failure rate of a send path that did not misbehave.
 *
 * Deletes ONLY rows matching the given campaign_id AND status FAILED AND the
 * "fetch failed" transport error, prints every row it removes, and refuses to
 * touch anything with a status that implies the gateway accepted it.
 *
 *   CAMPAIGN=retry-dlr-other-... node --env-file=.env.local --import tsx \
 *     --import ./scripts/_react-cache-shim.mjs scripts/qa-cleanup-unreached-retry.mts
 */
import { getSupabaseAdmin } from "../lib/supabase";

const db = getSupabaseAdmin();
if (!db) throw new Error("no service-role client");

const campaign = process.env.CAMPAIGN;
if (!campaign) { console.error("CAMPAIGN=<campaign_id> is required"); process.exit(1); }

const mask = (p?: string | null) => {
  const d = (p ?? "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `${d.slice(0, 2)}******${d.slice(-2)}` : "—";
};

const { count: before } = await db.from("sms_logs").select("*", { count: "exact", head: true });
const { data: rows } = await db
  .from("sms_logs")
  .select("id, status, error_message, mobile, gateway_message_id, course_enrollment_id, installment_no")
  .eq("campaign_id", campaign);

console.log(`campaign ${campaign} — ${rows?.length ?? 0} row(s)`);
if (!rows?.length) { console.log("nothing to do"); process.exit(0); }

const reached = rows.filter((r) => r.status !== "FAILED" || r.error_message !== "fetch failed" || r.gateway_message_id);
if (reached.length) {
  console.error(`\nREFUSING — ${reached.length} row(s) show the gateway was reached. Not deleting anything.`);
  for (const r of reached) console.error(`  ${mask(r.mobile)} status=${r.status} err=${r.error_message} gw_id=${r.gateway_message_id}`);
  process.exit(1);
}

console.log(`\nall ${rows.length} rows failed before the gateway was reached — removing:`);
for (const r of rows) {
  console.log(`  ${r.id}  ${mask(r.mobile)}  inst ${r.installment_no}  ${r.status}  "${r.error_message}"`);
}

const { error } = await db.from("sms_logs").delete().eq("campaign_id", campaign);
if (error) { console.error(`delete failed: ${error.message}`); process.exit(1); }

const { count: after } = await db.from("sms_logs").select("*", { count: "exact", head: true });
const { data: leftover } = await db.from("sms_logs").select("id").eq("campaign_id", campaign);
console.log(`\nsms_logs ${before} -> ${after}  (removed ${(before ?? 0) - (after ?? 0)})`);
console.log(`rows still carrying this campaign id: ${leftover?.length ?? 0}`);
