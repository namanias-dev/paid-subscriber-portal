/**
 * The DLT templates (seed) + rendering + GSM/length/segment validation.
 *
 * SOURCE OF TRUTH for the DLT-approved template IDs + bodies. The 13 templates
 * that carry a `gateway_template_id` below are the ones DLT-approved by the
 * provider ("APPROVED SMS TEMPLATES.xlsx"): the body text is byte-exact with the
 * approved DLT content and the id is the exact approved DLT template id, so the
 * gateway `message` + `templateid` pair always matches (a mismatch = rejection /
 * garbled delivery). The remaining seeds have `gateway_template_id: null` — they
 * are NOT DLT-approved yet and can never be sent (blocked by `no_dlt_id`).
 *
 * RULES enforced here:
 *  - "Rs" not "₹"; no emoji; GSM-7 charset only (warn + block on save).
 *  - Live char + segment counting; worst-case (max-length fill) flagged > 155.
 */
import type { SmsMessageType, SmsUseCase } from "./types";

export const BRAND_LINE = "Naman Sharma IAS Academy";
export const MAX_RECOMMENDED_CHARS = 155;

/** Stable trigger keys (also used as sms_auto_rules.trigger). */
export const TRIGGERS = {
  payment_success: "payment_success",
  payment_pending: "payment_pending",
  proof_uploaded: "proof_uploaded",
  admin_approval: "admin_approval",
  payment_failed: "payment_failed",
  payment_abandoned: "payment_abandoned",
  registration_created: "registration_created",
  webinar_day_before: "webinar_day_before",
  webinar_sameday_registered: "webinar_sameday_registered",
  webinar_starting_soon: "webinar_starting_soon",
  zoom_published: "zoom_published",
  webinar_sameday_invite: "webinar_sameday_invite",
  post_webinar_thankyou: "post_webinar_thankyou",
  first_login: "first_login",
  course_enrolled: "course_enrolled",
  payment_plan_changed: "payment_plan_changed",
  webinar_moved: "webinar_moved",
} as const;

export interface SeedTemplate {
  id: string;
  name: string;
  use_case: SmsUseCase;
  message_type: SmsMessageType;
  body: string;
  /**
   * Approved DLT gateway template id. NON-null => DLT-approved (body byte-exact
   * with the approved content); null => not approved yet, can never be sent.
   */
  gateway_template_id: string | null;
  /** Auto trigger key, if this template is auto-sendable. */
  trigger_event: string | null;
  /** Default audience tag (informational / used by crons). */
  audience_type: string | null;
}

/**
 * Bodies + ids of the DLT-approved rows are byte-exact with "APPROVED SMS
 * TEMPLATES.xlsx". Placeholder ORDER in each body matches the approved
 * {#var#} order left-to-right (first_name, item_short, login_url, login_code, …).
 */
export const SEED_TEMPLATES: SeedTemplate[] = [
  // ---------------- PAYMENT ----------------
  { id: "payment_pending", name: "Payment Pending", use_case: "PAYMENT", message_type: "service", trigger_event: TRIGGERS.payment_pending, audience_type: "payment_pending",
    gateway_template_id: "1707178279936988815",
    body: "Hi {first_name}, your course fee for {item_short} is pending. Login: {login_url} Code: {login_code}. Upload payment proof. Naman Sharma IAS Academy." },
  { id: "proof_received", name: "Proof Received", use_case: "PAYMENT", message_type: "service", trigger_event: TRIGGERS.proof_uploaded, audience_type: "proof_uploaded",
    gateway_template_id: "1707178280668003424",
    body: "Hi {first_name}, we received your payment proof for the course fee of {item_short}. Our team will verify it shortly. Naman Sharma IAS Academy." },
  { id: "access_approved", name: "Access Approved", use_case: "PAYMENT", message_type: "service", trigger_event: TRIGGERS.admin_approval, audience_type: "approved",
    gateway_template_id: "1707178280694450910",
    body: "Hi {first_name}, your payment for the course fee of {item_short} has been verified. Thank you. Naman Sharma IAS Academy." },
  { id: "payment_successful", name: "Payment Successful", use_case: "PAYMENT", message_type: "service", trigger_event: TRIGGERS.payment_success, audience_type: "paid",
    gateway_template_id: "1707178280720029430",
    body: "Hi {first_name}, your registration for the course {item_short} is confirmed. Login: {login_url} Code: {login_code}. Naman Sharma IAS Academy" },
  { id: "payment_failed", name: "Payment Failed / Retry", use_case: "PAYMENT", message_type: "service", trigger_event: TRIGGERS.payment_failed, audience_type: "failed",
    gateway_template_id: "1707178280000340281",
    body: "Hi {first_name}, your course fee for {item_short} was not received. Login: {login_url} Code: {login_code} to complete payment. Naman Sharma IAS Academy." },
  { id: "abandoned_nudge", name: "Payment Abandoned Nudge", use_case: "PAYMENT", message_type: "service", trigger_event: TRIGGERS.payment_abandoned, audience_type: "abandoned",
    gateway_template_id: "1707178281225847541",
    body: "Hi {first_name}, your payment for the course fee of {item_short} is pending. Login: {login_url} Code: {login_code} to complete payment. Naman Sharma IAS Academy." },

  // ---------------- WEBINAR ----------------
  { id: "webinar_registered", name: "Webinar Registration Confirmed", use_case: "WEBINAR", message_type: "service", trigger_event: TRIGGERS.registration_created, audience_type: "webinar_registered",
    gateway_template_id: "1707178280743194991",
    body: "Hi {first_name}, your webinar registration is confirmed. Login: {login_url} Code: {login_code}. Naman Sharma IAS Academy." },
  { id: "starting_soon_1hr", name: "Starting Soon", use_case: "WEBINAR", message_type: "service", trigger_event: TRIGGERS.webinar_starting_soon, audience_type: "webinar_registered",
    gateway_template_id: "1707178280774391989",
    body: "Hi {first_name}, your webinar {item_short} starts in 1 hour. Login: {login_url} to join the live session. Naman Sharma IAS Academy." },
  { id: "zoom_ready", name: "Zoom / Joining Details Ready", use_case: "WEBINAR", message_type: "service", trigger_event: TRIGGERS.zoom_published, audience_type: "webinar_registered",
    gateway_template_id: "1707178280787635098",
    body: "Hi {first_name}, your webinar registration is confirmed. Login: {login_url} Code: {login_code}. Naman Sharma IAS Academy." },
  { id: "general_webinar_invite", name: "General Webinar Invite / Sign-Up", use_case: "WEBINAR", message_type: "promotional", trigger_event: null, audience_type: null,
    gateway_template_id: "1707178272502168903",
    body: "Hi {first_name}, our next UPSC webinar is open! View list and enroll: {login_url}. Naman Sharma IAS Academy" },
  // Static promo (no variables) — DLT-locked body byte-exact with the approved sheet.
  { id: "new_webinar_enroll", name: "new webinar enroll", use_case: "WEBINAR", message_type: "promotional", trigger_event: null, audience_type: null,
    gateway_template_id: "1707178358697914131",
    body: "Confused about UPSC/IAS Preparation Join Naman Sir 2-hr LIVE UPSC Masterclass. Fee Rs.50. Enroll: https://vm.ltd/NAMIAS/fBLiXB Naman Sharma IAS Academy" },
  // --- NOT DLT-approved (no id in approved sheet) — cannot send until approved ---
  { id: "reminder_day_before", name: "Reminder Day Before", use_case: "WEBINAR", message_type: "service", trigger_event: TRIGGERS.webinar_day_before, audience_type: "webinar_registered",
    gateway_template_id: null,
    body: "Hi {first_name}, {item_short} is tomorrow at {webinar_time}. Login {login_url} for the joining link. Naman Sharma IAS Academy" },
  { id: "sameday_10am_registered", name: "Same-Day 10AM Reminder (Registered)", use_case: "WEBINAR", message_type: "service", trigger_event: TRIGGERS.webinar_sameday_registered, audience_type: "webinar_registered",
    gateway_template_id: null,
    body: "Hi {first_name}, {item_short} is TODAY at {webinar_time}! Login {login_url} code {login_code} to join. Naman Sharma IAS Academy" },
  { id: "sameday_10am_invite", name: "Same-Day 10AM Invite (Not Registered)", use_case: "WEBINAR", message_type: "promotional", trigger_event: TRIGGERS.webinar_sameday_invite, audience_type: "webinar_not_registered",
    gateway_template_id: null,
    body: "Hi {first_name}, free UPSC webinar {item_short} is TODAY at {webinar_time}. Register now: {login_url}. Naman Sharma IAS Academy" },
  { id: "missed_webinar_followup", name: "Missed Webinar Follow-up", use_case: "WEBINAR", message_type: "service", trigger_event: null, audience_type: "webinar_no_show",
    gateway_template_id: null,
    body: "Hi {first_name}, sorry we missed you at {item_short}. Catch our upcoming sessions: {login_url}. Naman Sharma IAS Academy" },
  { id: "webinar_moved", name: "Webinar Moved", use_case: "WEBINAR", message_type: "service", trigger_event: TRIGGERS.webinar_moved, audience_type: "webinar_registered",
    gateway_template_id: null,
    body: "Hi {first_name}, your registration is moved to {item_short} on {date}. Your access stays valid. Login {login_url}. Naman Sharma IAS Academy" },

  // ---------------- POST-WEBINAR -> ADMISSIONS ----------------
  { id: "post_webinar_thankyou", name: "Post-Webinar Thank You", use_case: "POST_WEBINAR", message_type: "service", trigger_event: TRIGGERS.post_webinar_thankyou, audience_type: "webinar_attendees",
    gateway_template_id: "1707178272635372891",
    body: "Hi {first_name}, thanks for attending {item_short}! Ready for the full course? Explore and enroll: {login_url}. Naman Sharma IAS Academy" },

  // ---------------- ONBOARDING / RETENTION ----------------
  { id: "welcome_first_login", name: "Welcome / First Login", use_case: "ONBOARDING", message_type: "service", trigger_event: TRIGGERS.first_login, audience_type: "first_login",
    gateway_template_id: "1707178280799637109",
    body: "Hi {first_name}, welcome to Naman Sharma IAS Academy. Your account has been created. Login: {login_url} Code: {login_code}." },
  { id: "course_enrolled", name: "Course Enrollment Confirmed", use_case: "ONBOARDING", message_type: "service", trigger_event: TRIGGERS.course_enrolled, audience_type: "paid",
    gateway_template_id: "1707178280828196940",
    body: "Hi {first_name}, your enrollment for the course {item_short} is confirmed. Login: {login_url} Code: {login_code}. Naman Sharma IAS Academy." },
  // --- NOT DLT-approved (no id in approved sheet) — cannot send until approved ---
  { id: "login_code_resend", name: "Login Code Resend", use_case: "ONBOARDING", message_type: "service", trigger_event: null, audience_type: null,
    gateway_template_id: null,
    body: "Hi {first_name}, your login code is {login_code}. Login: {login_url}. Naman Sharma IAS Academy" },
  { id: "payment_plan_changed", name: "Payment Plan Changed", use_case: "PAYMENT", message_type: "service", trigger_event: TRIGGERS.payment_plan_changed, audience_type: "paid",
    gateway_template_id: null,
    body: "Hi {first_name}, payment plan for {item_short} updated. Login {login_url} code {login_code} to view installments. Naman Sharma IAS Academy" },
  { id: "reengagement_inactive", name: "Re-Engagement Inactive", use_case: "ONBOARDING", message_type: "service", trigger_event: null, audience_type: "inactive",
    gateway_template_id: null,
    body: "Hi {first_name}, new UPSC sessions are live! Login {login_url} to continue learning. Naman Sharma IAS Academy" },
];

export function seedById(id: string): SeedTemplate | undefined {
  return SEED_TEMPLATES.find((t) => t.id === id);
}

/**
 * Canonical variable catalogue — the only tokens the send pipeline can resolve
 * (mirrors SmsVariable in ./types + the variable store). A self-serve template
 * body MAY use other {tokens}, but they are flagged as "unknown" (a warning, not
 * a hard block) because nothing fills them, so they would render empty / mark a
 * recipient as missing-vars at send time.
 */
export const KNOWN_VARIABLES: readonly string[] = [
  "name", "first_name", "mobile", "login_code", "login_url",
  "item_name", "item_short", "amount", "payment_status",
  "webinar_date", "webinar_time", "support_number",
] as const;

/** Body {tokens} that are NOT in the canonical catalogue (first-seen order). */
export function unknownVariables(body: string): string[] {
  return uniqueVariables(body).filter((v) => !KNOWN_VARIABLES.includes(v));
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------
const VAR_RE = /\{([a-z_]+)\}/g;

/** Ordered list of variable occurrences (DLT slots — duplicates kept in order). */
export function variableSlots(body: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(body))) out.push(m[1]);
  return out;
}

/** Unique variables in first-seen order (stored on the template). */
export function uniqueVariables(body: string): string[] {
  return [...new Set(variableSlots(body))];
}

/** Render a body with provided values. Missing values render empty. */
export function renderTemplate(body: string, vars: Record<string, string | number | null | undefined>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = body.replace(VAR_RE, (_full, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null || String(v).trim() === "") {
      if (!missing.includes(key)) missing.push(key);
      return "";
    }
    return String(v);
  });
  return { text, missing };
}

// ---------------------------------------------------------------------------
// GSM-7 charset + segment maths
// ---------------------------------------------------------------------------
const GSM_BASIC = new Set(
  ("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡" +
    "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà")
    .split("")
);
const GSM_EXT = new Set("^{}\\[~]|€".split(""));
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

export interface BodyAnalysis {
  length: number;
  /** GSM septet units (extension chars count as 2). */
  units: number;
  segments: number;
  gsm: boolean;
  nonGsmChars: string[];
  hasRupeeSymbol: boolean;
  hasEmoji: boolean;
  over155: boolean;
}

export function analyzeBody(text: string): BodyAnalysis {
  const chars = [...text];
  let units = 0;
  let gsm = true;
  const nonGsm = new Set<string>();
  for (const ch of chars) {
    if (GSM_BASIC.has(ch)) units += 1;
    else if (GSM_EXT.has(ch)) units += 2;
    else { gsm = false; units += 1; nonGsm.add(ch); }
  }
  const length = chars.length;
  let segments: number;
  if (gsm) segments = units <= 160 ? (units === 0 ? 0 : 1) : Math.ceil(units / 153);
  else segments = length <= 70 ? 1 : Math.ceil(length / 67); // UCS-2 fallback
  return {
    length,
    units,
    segments,
    gsm,
    nonGsmChars: [...nonGsm],
    hasRupeeSymbol: text.includes("₹"),
    hasEmoji: EMOJI_RE.test(text),
    over155: length > MAX_RECOMMENDED_CHARS,
  };
}

export interface BodyValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  analysis: BodyAnalysis;
}

/**
 * Validate a body (or rendered text). Blocks on ₹, emoji, non-GSM characters.
 * Warns (does not block) on > 155 chars so admins see segment cost.
 */
export function validateBody(text: string): BodyValidation {
  const analysis = analyzeBody(text);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (analysis.hasRupeeSymbol) errors.push('Use "Rs" instead of the ₹ symbol.');
  if (analysis.hasEmoji) errors.push("Emojis are not allowed in SMS.");
  if (!analysis.gsm) errors.push(`Non-GSM characters: ${analysis.nonGsmChars.join(" ")}`);
  if (analysis.over155) warnings.push(`${analysis.length} chars (> ${MAX_RECOMMENDED_CHARS}); ${analysis.segments} segment(s).`);
  else if (analysis.segments > 1) warnings.push(`${analysis.segments} segments.`);
  return { ok: errors.length === 0, errors, warnings, analysis };
}

// ---------------------------------------------------------------------------
// Worst-case fill (for the DLT export + Templates-tab counter)
// ---------------------------------------------------------------------------
/** Conservative realistic max-length values; login_url is overridden at runtime. */
export const WORST_SAMPLE: Record<string, string> = {
  name: "Brijmohan Sharma",
  first_name: "Brijmohan",
  mobile: "9876543210",
  login_code: "ABCDXYZ23",
  login_url: "namanias.com/portal/login",
  item_name: "UPSC Foundation Batch 2027 Weekend",
  item_short: "UPSC Foundation 2027",
  amount: "2,499",
  payment_status: "Pending",
  webinar_date: "28 Jun 2026",
  webinar_time: "10:00 AM",
  support_number: "9876543210",
};

export function worstCaseFill(body: string, loginUrlSample?: string): { text: string; analysis: BodyAnalysis } {
  const sample = { ...WORST_SAMPLE };
  if (loginUrlSample) sample.login_url = loginUrlSample;
  const { text } = renderTemplate(body, sample);
  return { text, analysis: analyzeBody(text) };
}
