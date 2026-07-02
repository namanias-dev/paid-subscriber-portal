/**
 * Reconcile the 4 diagnostic test messages to their PROVIDER-TRUE status via the
 * pull poller (http-dlr.php). Ensures a log row exists for each, then runs
 * pollDeliveryStatuses() — which now treats a settled "Other" as FAILED — and
 * prints the resulting sms_logs rows so they can be matched against the portal.
 *   node --env-file=.env.local --import tsx scripts/reconcile-test-dlr.ts
 */
import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "../lib/supabase";
import { pollDeliveryStatuses } from "../lib/sms/service";

// stored form (unpadded, as extractMessageId writes it) -> metadata
const TESTS: { id: string; mobile: string; name: string; code: string; url: string }[] = [
  { id: "MzMzNTg5Ng", mobile: "9988791797", name: "Naman Sharma", code: "744CAF3", url: "https://namanias.com/portal/login" },
  { id: "MzMzNTkwNg", mobile: "9988791797", name: "Naman Sharma", code: "744CAF3", url: "https://namanias.com/portal/login" },
  { id: "MzMzNTkxMg", mobile: "7696052304", name: "Shritshty", code: "3K76VHT", url: "https://namanias.com/portal/login" },
  { id: "MzMzNTkxNQ", mobile: "7696052304", name: "Shritshty", code: "3K76VHT", url: "https://cutt.ly/Nt6fQ17b" },
];

async function main() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("no supabase admin");

  for (const t of TESTS) {
    const { data: existing } = await db.from("sms_logs").select("id").eq("gateway_message_id", t.id).maybeSingle();
    if (existing) continue;
    const body = `Hi ${t.name}, welcome to Naman Sharma IAS Academy. Your account has been created. Login: ${t.url} Code: ${t.code}.`;
    const { error } = await db.from("sms_logs").insert({
      id: randomUUID(), mobile: t.mobile, normalized_mobile: t.mobile,
      student_name: t.name, template_id: "welcome_first_login", template_name: "Welcome / First Login",
      gateway_template_id: "1707178280799637109", sender_id: "NAMIAS", route: "12",
      message_body: body, character_count: body.length, segments: 1, status: "SENT",
      gateway_message_id: t.id, gateway_response: { body: "Message Submitted Successfully", httpStatus: 200 },
      sent_by_type: "ADMIN", audience_type: "test", sent_at: new Date().toISOString(), created_at: new Date().toISOString(),
    });
    if (error) throw new Error(`insert ${t.id}: ${error.message}`);
    console.log(`Recorded ${t.id} (${t.mobile})`);
  }

  console.log("\nRunning pull poller (Other => FAILED) for all 4…");
  const res = await pollDeliveryStatuses({ messageIds: TESTS.map((t) => t.id) });
  console.log(JSON.stringify(res, null, 2));

  const { data: rows } = await db.from("sms_logs")
    .select("gateway_message_id,status,normalized_mobile,error_message,gateway_response,sent_at")
    .in("gateway_message_id", TESTS.map((t) => t.id));
  console.log("\nFinal sms_logs rows:");
  for (const r of (rows || []) as any[]) {
    const dlr = (r.gateway_response || {}).dlr || {};
    console.log(`  ${r.gateway_message_id}  status=${r.status}  to=${r.normalized_mobile}  err=${r.error_message || "-"}  dlr.statusText=${dlr.statusText}`);
  }
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
