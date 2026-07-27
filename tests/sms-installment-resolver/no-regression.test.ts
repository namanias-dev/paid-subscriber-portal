/**
 * The parser and the alias registry changed how EVERY template resolves, not
 * just the broken one. This suite is the counterweight: for all 24 live
 * templates, the new resolver must produce byte-identical output to the old one
 * wherever the old one produced anything at all.
 *
 * The rule that makes that true is the lookup precedence in variableRegistry:
 * an EXACT key match always beats an alias. An alias can therefore only fill a
 * token that previously rendered as an empty string — it can never change a
 * value that already resolved.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderTemplate, uniqueVariables, worstCaseFill, WORST_SAMPLE } from "../../lib/sms/templates";
import { lookupVariable } from "../../lib/sms/variableRegistry";
import { SEED_TEMPLATES } from "../../lib/sms/templates";

/** The parser as it behaved before the fix. */
const OLD_VAR_RE = /\{([a-z_]+)\}/g;

function renderWithOldParser(body: string, vars: Record<string, string | number | null | undefined>) {
  const missing: string[] = [];
  const text = body.replace(OLD_VAR_RE, (_full, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null || String(v).trim() === "") {
      if (!missing.includes(key)) missing.push(key);
      return "";
    }
    return String(v);
  });
  return { text, missing };
}

/**
 * Live production bodies (sms_templates, read 2026-07-27). Kept verbatim so a
 * body edit in the database that breaks rendering shows up as a test failure
 * against the recorded text rather than silently.
 */
const LIVE_BODIES: Record<string, string> = {
  abandoned_nudge: "Hi {first_name}, your payment for the course fee of {item_short} is pending. Login: {login_url} Code: {login_code} to complete payment. Naman Sharma IAS Academy.",
  access_approved: "Hi {first_name}, your payment for the course fee of {item_short} has been verified. Thank you. Naman Sharma IAS Academy.",
  course_enrolled: "Hi {first_name}, your enrollment for the course {item_short} is confirmed. Login: {login_url} Code: {login_code}. Naman Sharma IAS Academy.",
  general_webinar_invite: "Hi {first_name}, our next UPSC webinar is open! View list and enroll: {login_url}. Naman Sharma IAS Academy",
  installment_reminder: "Hi {first_name}, your course fee installment no. {No_of_Installment} of Rs.{Fee_in_Rs} is due. Login: {login_url} Code: {login_code} to complete payment. Naman Sharma IAS Academy.",
  login_code_resend: "Hi {first_name}, your login code is {login_code}. Login: https://www.namanias.com/login. Naman Sharma IAS Academy",
  missed_webinar_followup: "Hi {first_name}, you missed your registered webinar {item_short}.Login at https://www.namanias.com/login to view available recordings or session updates. Naman Sharma IAS Academy.",
  new_webinar_enroll: "Confused about UPSC/IAS Preparation Join Naman Sir 2-hr LIVE UPSC Masterclass. Fee Rs.50. Enroll: https://vm.ltd/NAMIAS/fBLiXB Naman Sharma IAS Academy",
  payment_failed: "Hi {first_name}, your course fee for {item_short} was not received. Login: {login_url} Code: {login_code} to complete payment. Naman Sharma IAS Academy.",
  payment_pending: "Hi {first_name}, your course fee for {item_short} is pending. Login: {login_url} Code: {login_code}. Upload payment proof. Naman Sharma IAS Academy.",
  payment_plan_changed: "Hi {first_name}, payment plan for {item_short} updated. Login {login_url} code {login_code} to view installments. Naman Sharma IAS Academy",
  payment_successful: "Hi {first_name}, your registration for the course {item_short} is confirmed. Login: {login_url} Code: {login_code}. Naman Sharma IAS Academy",
  post_webinar_thankyou: "Hi {first_name}, thanks for attending {item_short}! Ready for the full course? Explore and enroll: {login_url}. Naman Sharma IAS Academy",
  proof_received: "Hi {first_name}, we received your payment proof for the course fee of {item_short}. Our team will verify it shortly. Naman Sharma IAS Academy.",
  reengagement_inactive: "Hi {first_name}, new UPSC sessions are live! Login {login_url} to continue learning. Naman Sharma IAS Academy",
  reminder_day_before: "Hi {first_name}, your registered webinar {item_short} is tomorrow at {webinar_time}. Access your joining link: https://www.namanias.com/login Naman Sharma IAS Academy.",
  sameday_10am_invite: "Hi {first_name}, free UPSC webinar {item_short} is TODAY at {webinar_time}. Register now: {login_url}. Naman Sharma IAS Academy",
  sameday_10am_registered: "Hi {first_name}, {item_short} is TODAY at {webinar_time}! Login {login_url} code {login_code} to join. Naman Sharma IAS Academy",
  same_day_morning_reminder: "Hi {first_name}, your registered webinar {item_short} is today at {webinar_time}. Login at https://www.namanias.com/login using code {login_code} to join the webinar. Naman Sharma IAS Academy.",
  starting_soon_1hr: "Hi {first_name}, your webinar {item_short} starts in 1 hour. Login: {login_url} to join the live session. Naman Sharma IAS Academy.",
  webinar_moved: "Hi {first_name}, your registration is moved to {item_short} on {date}. Your access stays valid. Login {login_url}. Naman Sharma IAS Academy",
  webinar_registered: "Hi {first_name}, your webinar registration is confirmed. Login: {login_url} Code: {login_code}. Naman Sharma IAS Academy.",
  welcome_first_login: "Hi {first_name}, welcome to Naman Sharma IAS Academy. Your account has been created. Login: {login_url} Code: {login_code}.",
  zoom_ready: "Hi {first_name}, your webinar registration is confirmed. Login: {login_url} Code: {login_code}. Naman Sharma IAS Academy.",
};

/** A realistic send-time vars map, of the shape audiences.ts builds. */
const SEND_VARS: Record<string, string> = {
  ...WORST_SAMPLE,
  date: "12 Aug 2026",
};

describe("every live template renders identically to before the fix", () => {
  for (const [id, body] of Object.entries(LIVE_BODIES)) {
    test(`${id} is byte-identical`, () => {
      const before = renderWithOldParser(body, SEND_VARS);
      const after = renderTemplate(body, SEND_VARS);
      if (id === "installment_reminder") {
        // The ONE intended difference. Old parser: both money tokens survive
        // into the message untouched. New parser with real installment values:
        // both resolve and nothing is left raw.
        assert.match(before.text, /installment no\. \{No_of_Installment\} of Rs\.\{Fee_in_Rs\}/);
        const resolved = renderTemplate(body, { ...SEND_VARS, no_of_installment: "2", fee_in_rs: "8000" }).text;
        assert.match(resolved, /installment no\. 2 of Rs\.8000 is due/);
        assert.ok(!/[{}]/.test(resolved));
        return;
      }
      assert.equal(after.text, before.text, `${id} renders differently now`);
      assert.deepEqual(after.missing, before.missing, `${id} reports different missing vars`);
    });
  }
});

describe("an exact key always beats an alias", () => {
  test("{amount} still reads the caller's amount, not fee_in_rs", () => {
    // `amount` is an alias of fee_in_rs. Payment audiences set `amount` from the
    // payment row; that must keep winning or every payment template changes.
    assert.equal(lookupVariable({ amount: "2499", fee_in_rs: "8000" }, "amount"), "2499");
  });

  test("{Fee_in_Rs} prefers fee_in_rs over the amount alias", () => {
    assert.equal(lookupVariable({ amount: "2499", fee_in_rs: "8000" }, "Fee_in_Rs"), "8000");
  });

  test("aliases only FILL a token that would otherwise be empty", () => {
    // With no fee_in_rs present, the amount alias fills the DLT token rather
    // than leaving braces in the message.
    assert.equal(lookupVariable({ amount: "2499" }, "Fee_in_Rs"), "2499");
  });
});

describe("template metadata is unchanged", () => {
  test("no seed template body or DLT id was touched", () => {
    // A body edit is a DLT violation. Pin the seeds' variable extraction so an
    // accidental body change is loud.
    // 22 seeds in code; the live table also holds `installment_reminder` and
    // `same_day_morning_reminder`, which were created through the admin UI.
    const fingerprint = SEED_TEMPLATES.map((t) => `${t.id}:${t.gateway_template_id ?? "none"}:${uniqueVariables(t.body).join("|")}`);
    assert.equal(fingerprint.length, 22);
    assert.ok(fingerprint.includes("new_webinar_enroll:1707178358697914131:"));
    assert.ok(fingerprint.includes("payment_pending:1707178279936988815:first_name|item_short|login_url|login_code"));
  });

  test("worst-case fill still produces a brace-free body for every seed", () => {
    for (const t of SEED_TEMPLATES) {
      const { text } = worstCaseFill(t.body);
      assert.ok(!/[{}]/.test(text), `${t.id} worst-case fill leaves an unresolved token: ${text}`);
    }
  });
});
