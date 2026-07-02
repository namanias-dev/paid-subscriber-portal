/**
 * Send ONE real test SMS via the SAME production path (sendSms → JustGoSMS).
 * HARD-LOCKED to a single recipient so it can never hit a student number.
 *
 * Reuses the live DB template (welcome_first_login = Welcome / First Login,
 * DLT id 1707178280799637109). Forces the env kill-switch ON for THIS process
 * only, temporarily enables the DB soft-switch, sends, then restores the
 * soft-switch to its prior value. Prints the full (credential-free) gateway
 * response + final log status.
 *
 * Requires in .env.local: SMS_API_AUTH_KEY, SMS_API_USERNAME, SMS_API_PASSWORD.
 *   node --env-file=.env.local --import tsx scripts/send-test-sms.ts
 */
const TEST_MOBILE = "9988791797"; // ONLY this number — never a student.
const TEMPLATE_ID = "welcome_first_login";
const TEST_VARS = { name: "Rahul Verma", login_code: "TS9AB4Z" };

// Force the env hard kill-switch ON for this process before any SMS import.
process.env.SMS_ENABLED = "true";

import { gatewayConfigured } from "../lib/sms/config";
import { getSettings, updateSettings, getLog } from "../lib/sms/store";
import { previewSms, sendSms } from "../lib/sms/service";

async function main() {
  if (!gatewayConfigured()) {
    console.error(
      "BLOCKED: JustGoSMS credentials are not configured.\n" +
        "  Missing one or more of SMS_API_AUTH_KEY / SMS_API_USERNAME / SMS_API_PASSWORD in .env.local.\n" +
        "  Add them and re-run — no SMS was sent."
    );
    process.exit(2);
  }

  // Preview so we log EXACTLY what will be sent.
  const preview = await previewSms(TEMPLATE_ID, TEST_VARS);
  console.log("Template:", TEMPLATE_ID, "(Welcome / First Login)");
  console.log("Recipient:", TEST_MOBILE);
  console.log("Rendered body:", preview?.text);
  console.log("Missing vars:", preview?.missing, "| errors:", preview?.errors, "| segments:", preview?.segments);
  if (!preview || !preview.ok) {
    console.error("BLOCKED: preview not sendable — aborting.");
    process.exit(3);
  }

  // Temporarily flip the DB soft-switch on (restore afterwards).
  const before = await getSettings();
  const wasEnabled = before.enabled;
  if (!wasEnabled) await updateSettings({ enabled: true }, "test-send-script");

  let result;
  try {
    result = await sendSms({
      mobile: TEST_MOBILE,
      templateId: TEMPLATE_ID,
      variables: TEST_VARS,
      sentBy: { type: "ADMIN", userId: null },
      triggerEvent: null,
      audienceType: "test",
      allowRecentOverride: true, // ignore the 30-min same-template guard for the test
    });
  } finally {
    if (!wasEnabled) await updateSettings({ enabled: false }, "test-send-script");
  }

  console.log("\n=== sendSms result ===");
  console.log(JSON.stringify(result, null, 2));

  if (result.logId) {
    const log = await getLog(result.logId);
    console.log("\n=== sms_logs row (gateway response) ===");
    console.log(JSON.stringify(
      {
        id: log?.id,
        status: log?.status,
        gateway_template_id: log?.gateway_template_id,
        sender_id: log?.sender_id,
        route: log?.route,
        gateway_message_id: log?.gateway_message_id,
        error_message: log?.error_message,
        gateway_response: log?.gateway_response,
        sent_at: log?.sent_at,
      },
      null,
      2
    ));
  }

  console.log(`\n${result.ok ? "ACCEPTED by gateway" : "NOT accepted — see error/gateway_response above (do NOT retry blindly)"}`);
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
