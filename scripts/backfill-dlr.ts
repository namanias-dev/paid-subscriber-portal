/**
 * Backfill delivery status for the two real test messages via the http-dlr.php
 * PULL poller (the same pollDeliveryStatuses the cron now runs). Ensures the new
 * corrected test (MzMzNTkwNg==, sent on route 12 to 9988791797) has a log row,
 * then pulls JustGoSMS's real status for BOTH ids and prints the resulting rows.
 *   node --env-file=.env.local --import tsx scripts/backfill-dlr.ts
 */
import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "../lib/supabase";
import { pollDeliveryStatuses } from "../lib/sms/service";

const ORIG_ID = "MzMzNTg5Ng";   // 3335896 — first transport test
const NEW_ID = "MzMzNTkwNg";    // 3335906 — corrected route-12 test

async function main() {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("no supabase admin");

  // Record the corrected test send (route 12) if it isn't already logged.
  const { data: existing } = await db.from("sms_logs").select("id").eq("gateway_message_id", NEW_ID).maybeSingle();
  if (!existing) {
    const body = "Hi Naman, welcome to Naman Sharma IAS Academy. Your account has been created. Login: https://namanias.com/portal/login Code: 744CAF3.";
    const { error } = await db.from("sms_logs").insert({
      id: randomUUID(), mobile: "9988791797", normalized_mobile: "9988791797",
      student_name: "Naman Sharma", template_id: "welcome_first_login", template_name: "Welcome / First Login",
      gateway_template_id: "1707178280799637109", sender_id: "NAMIAS", route: "12",
      message_body: body, character_count: body.length, segments: 1, status: "SENT",
      gateway_message_id: NEW_ID, gateway_response: { body: "Message Submitted Successfully msg-id : MzMzNTkwNg==", httpStatus: 200 },
      sent_by_type: "ADMIN", audience_type: "test", sent_at: new Date().toISOString(), created_at: new Date().toISOString(),
    });
    if (error) throw new Error(`insert new-test log: ${error.message}`);
    console.log("Recorded corrected route-12 test in sms_logs.");
  } else {
    console.log("Corrected test already logged.");
  }

  console.log("\nRunning pull poller for both message ids…");
  const res = await pollDeliveryStatuses({ messageIds: [ORIG_ID, NEW_ID] });
  console.log(JSON.stringify(res, null, 2));

  const { data: rows } = await db.from("sms_logs").select("gateway_message_id,status,normalized_mobile,gateway_response,sent_at").in("gateway_message_id", [ORIG_ID, NEW_ID]);
  console.log("\nFinal sms_logs rows:");
  for (const r of (rows || []) as any[]) {
    console.log(`  ${r.gateway_message_id}  status=${r.status}  to=${r.normalized_mobile}  dlr=${JSON.stringify((r.gateway_response || {}).dlr)}`);
  }
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
