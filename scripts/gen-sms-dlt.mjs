// Generates docs/sms-dlt-templates.md (a committed SNAPSHOT). The LIVE export in
// the portal (Templates tab) is always produced from lib/sms/templates.ts via
// lib/sms/dlt.ts; keep the bodies below in sync if you edit a template body.
// Run: node scripts/gen-sms-dlt.mjs
import { writeFileSync, mkdirSync } from "node:fs";

const ENTITY = "Naman Sharma IAS Academy";
const SENDER = "NAMIAS";
const ROUTE = "12";
const MAX = 155;
const LOGIN_URL_SAMPLE = "namanias.com/portal/login";

const SAMPLE = {
  name: "Brijmohan Sharma", first_name: "Brijmohan", mobile: "9876543210",
  login_code: "ABCDXYZ23", login_url: LOGIN_URL_SAMPLE,
  item_name: "UPSC Foundation Batch 2027 Weekend", item_short: "UPSC Foundation 2027",
  amount: "2,499", payment_status: "Pending", webinar_date: "28 Jun 2026", webinar_time: "10:00 AM",
  support_number: "9876543210",
};

const SEED = [
  ["payment_pending", "Payment Pending", "PAYMENT", "service", "Hi {first_name}, payment for {item_short} is pending. Login {login_url} code {login_code} & upload proof for approval. Naman Sharma IAS Academy"],
  ["proof_received", "Proof Received", "PAYMENT", "service", "Hi {first_name}, we got your payment proof for {item_short}. Our team will verify & approve access shortly. Naman Sharma IAS Academy"],
  ["access_approved", "Access Approved", "PAYMENT", "service", "Hi {first_name}, payment verified! Access for {item_short} is approved. Login {login_url} code {login_code}. Naman Sharma IAS Academy"],
  ["payment_successful", "Payment Successful", "PAYMENT", "service", "Hi {first_name}, you are registered for {item_short}. Login {login_url} code {login_code} to view details. Naman Sharma IAS Academy"],
  ["payment_failed", "Payment Failed", "PAYMENT", "service", "Hi {first_name}, payment for {item_short} did not complete. Login {login_url} code {login_code} to retry. Naman Sharma IAS Academy"],
  ["abandoned_nudge", "Abandoned Nudge", "PAYMENT", "service", "Hi {first_name}, you are almost enrolled in {item_short}! Finish payment: {login_url} code {login_code}. Naman Sharma IAS Academy"],
  ["webinar_registered", "Webinar Registered", "WEBINAR", "service", "Hi {first_name}, your seat for {item_short} is booked! Login {login_url} code {login_code} for details. Naman Sharma IAS Academy"],
  ["reminder_day_before", "Reminder Day Before", "WEBINAR", "service", "Hi {first_name}, {item_short} is tomorrow at {webinar_time}. Login {login_url} for the joining link. Naman Sharma IAS Academy"],
  ["sameday_10am_registered", "Same-Day 10AM Reminder (Registered)", "WEBINAR", "service", "Hi {first_name}, {item_short} is TODAY at {webinar_time}! Login {login_url} code {login_code} to join. Naman Sharma IAS Academy"],
  ["starting_soon_1hr", "Starting Soon (1 hr)", "WEBINAR", "service", "Hi {first_name}, {item_short} starts in 1 hour! Login now {login_url} for the live link. Naman Sharma IAS Academy"],
  ["zoom_ready", "Zoom / Joining Ready", "WEBINAR", "service", "Hi {first_name}, joining details for {item_short} are ready. Login {login_url} code {login_code}. Naman Sharma IAS Academy"],
  ["sameday_10am_invite", "Same-Day 10AM Invite (Not Registered)", "WEBINAR", "promotional", "Hi {first_name}, free UPSC webinar {item_short} is TODAY at {webinar_time}. Register now: {login_url}. Naman Sharma IAS Academy"],
  ["general_webinar_invite", "General Webinar Invite", "WEBINAR", "promotional", "Hi {first_name}, our next UPSC webinar is open! View list & enroll: {login_url}. Naman Sharma IAS Academy"],
  ["missed_webinar_followup", "Missed Webinar Follow-up", "WEBINAR", "service", "Hi {first_name}, sorry we missed you at {item_short}. Catch our upcoming sessions: {login_url}. Naman Sharma IAS Academy"],
  ["post_webinar_thankyou", "Post-Webinar Thank You", "POST_WEBINAR", "service", "Hi {first_name}, thanks for attending {item_short}! Ready for the full course? Explore & enroll: {login_url}. Naman Sharma IAS Academy"],
  ["welcome_first_login", "Welcome / First Login", "ONBOARDING", "service", "Hi {first_name}, welcome to Naman Sharma IAS Academy! Open your dashboard: {login_url} code {login_code}."],
  ["login_code_resend", "Login Code Resend", "ONBOARDING", "service", "Hi {first_name}, your login code is {login_code}. Login: {login_url}. Naman Sharma IAS Academy"],
  ["course_enrolled", "Course Enrolled", "ONBOARDING", "service", "Hi {first_name}, you are enrolled in {item_short}! Login {login_url} code {login_code} to start. Naman Sharma IAS Academy"],
  ["reengagement_inactive", "Re-Engagement Inactive", "ONBOARDING", "service", "Hi {first_name}, new UPSC sessions are live! Login {login_url} to continue learning. Naman Sharma IAS Academy"],
];

const slots = (b) => [...b.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
const dltBody = (b) => b.replace(/\{([a-z_]+)\}/g, "{#var#}");
const fill = (b) => b.replace(/\{([a-z_]+)\}/g, (_f, k) => SAMPLE[k] ?? "");

// GSM segment maths (matches lib/sms/templates.ts)
const segs = (text) => {
  const len = [...text].length;
  return len <= 160 ? 1 : Math.ceil(len / 153);
};

const out = [];
out.push("# SMS DLT Approval Sheet — Naman Sharma IAS Academy");
out.push("");
out.push("> SNAPSHOT generated by `scripts/gen-sms-dlt.mjs`. The live, always-current export is in the portal: **Admin → Communications → SMS Mission Control → Templates → Export DLT Approval Sheet**.");
out.push("");
out.push(`- **Principal Entity:** ${ENTITY}`);
out.push(`- **Sender ID (Header):** ${SENDER}`);
out.push(`- **Route:** ${ROUTE}`);
out.push('- **Brand line (every template):** "Naman Sharma IAS Academy"');
out.push(`- **Charset:** GSM-7 only · "Rs" not "₹" · no emoji · target < ${MAX} chars worst-case`);
out.push("");
out.push("Paste each registered **DLT Template ID** into the portal before a template can go Active. Portal bodies byte-match the bodies below.");
out.push("");

for (const [id, name, useCase, category, body] of SEED) {
  const filled = fill(body);
  const len = [...filled].length;
  const sg = segs(filled);
  out.push(`## ${name}  \`${id}\``);
  out.push("");
  out.push(`- **Use case:** ${useCase} · **Category:** ${category}`);
  out.push(`- **Worst-case length:** ${len} chars · **${sg} segment(s)**${len > MAX ? "  ⚠️ exceeds " + MAX : ""}`);
  out.push("- **DLT Template ID:** `________________________`");
  out.push("");
  out.push("**DLT body:**");
  out.push("");
  out.push("```");
  out.push(dltBody(body));
  out.push("```");
  out.push("");
  out.push("**Variable mapping (in order):**");
  out.push("");
  out.push("| Slot | Variable |");
  out.push("|---|---|");
  const vs = slots(body);
  if (vs.length) vs.forEach((v, i) => out.push(`| {#var#} #${i + 1} | \`${v}\` |`));
  else out.push("| — | (no variables) |");
  out.push("");
}

mkdirSync("docs", { recursive: true });
writeFileSync("docs/sms-dlt-templates.md", out.join("\n") + "\n");
console.log("Wrote docs/sms-dlt-templates.md with", SEED.length, "templates.");
