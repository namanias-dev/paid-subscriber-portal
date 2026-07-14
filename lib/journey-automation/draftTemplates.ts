/**
 * DRAFT SMS templates the seeded journeys reference by stable `template_key`.
 *
 * These are NOT DLT-approved and NOT sendable. They are DRAFT copy for the team
 * to submit for DLT approval. Journeys reference them by key; the studio shows a
 * clear "pending DLT approval" state until the matching template is approved in
 * SMS Mission Control (single source of truth), at which point staff bind it.
 *
 * SAFETY: this file NEVER touches the send pipeline. It defines authoring intent
 * (copy + variable map) only. Nothing here can send.
 *
 * Conventions (must match the existing approved DLT templates in
 * lib/sms/templates.ts): single-brace lowercase `{tokens}`; contains the brand
 * line "Naman Sharma IAS Academy"; <=150 chars including placeholders; real
 * whitelisted destinations only (resolved from `{login_url}` at send time).
 */
import { BRAND_LINE, analyzeBody, uniqueVariables } from "@/lib/sms/templates";

/** Whitelisted destinations `{login_url}` resolves to (all real, no short links). */
export const WHITELISTED_URLS = {
  portalLogin: "https://www.namanias.com/portal/login",
  webinars: "https://www.namanias.com/webinars",
  courses: "https://www.namanias.com/courses",
} as const;

export type LoginUrlTarget = keyof typeof WHITELISTED_URLS;

export interface DraftTemplate {
  /** Stable key journeys reference (becomes the sms_templates id on approval). */
  template_key: string;
  name: string;
  /** One-line purpose. */
  purpose: string;
  use_case: "ONBOARDING" | "PAYMENT" | "WEBINAR";
  /** Journey message category used for compliance suppression. */
  category: "transactional" | "promotional" | "payment_reminder";
  body: string;
  /** Journey variable -> template placeholder is identity here (same names). */
  variableMap: string[];
  /** Which whitelisted URL `{login_url}` resolves to for this template. */
  loginUrlTarget: LoginUrlTarget;
}

/**
 * Every DRAFT template the new journeys need that is NOT already DLT-approved.
 * Steps whose approved template already exists (welcome_first_login,
 * payment_successful, webinar_registered, general_webinar_invite) are NOT here —
 * they bind directly from Mission Control.
 */
export const DRAFT_SMS_TEMPLATES: DraftTemplate[] = [
  {
    template_key: "beginner_resources",
    name: "Beginner Resources (activation)",
    purpose: "Nudge a logged-in new lead into their starter UPSC plan + notes.",
    use_case: "ONBOARDING",
    category: "transactional",
    loginUrlTarget: "portalLogin",
    body: "Hi {first_name}, log in {login_url} > Class Hub for your UPSC beginner plan and free notes. Naman Sharma IAS Academy",
    variableMap: ["first_name", "login_url"],
  },
  {
    template_key: "portal_login_reminder",
    name: "Portal Login Reminder",
    purpose: "Remind a lead/student who has not logged in to open their portal.",
    use_case: "ONBOARDING",
    category: "transactional",
    loginUrlTarget: "portalLogin",
    body: "Hi {first_name}, your portal is ready. Log in {login_url} Code {login_code} to open your dashboard. Naman Sharma IAS Academy",
    variableMap: ["first_name", "login_url", "login_code"],
  },
  {
    template_key: "installment_overdue_reminder",
    name: "Installment Overdue Reminder",
    purpose: "First reminder when a fee installment is overdue (auto-stops if paid).",
    use_case: "PAYMENT",
    category: "payment_reminder",
    loginUrlTarget: "portalLogin",
    body: "Hi {first_name}, installment for {item_short} is overdue. Log in {login_url} > Installments > Pay. Naman Sharma IAS Academy",
    variableMap: ["first_name", "item_short", "login_url"],
  },
  {
    template_key: "installment_final_reminder",
    name: "Installment Final Reminder",
    purpose: "Stronger second reminder to clear an overdue installment (auto-stops if paid).",
    use_case: "PAYMENT",
    category: "payment_reminder",
    loginUrlTarget: "portalLogin",
    body: "Hi {first_name}, please clear the {item_short} installment to keep access. Log in {login_url} > Pay. Naman Sharma IAS Academy",
    variableMap: ["first_name", "item_short", "login_url"],
  },
  {
    template_key: "webinar_join_tutorial",
    name: "Webinar Join Tutorial",
    purpose: "Tell a registrant exactly how to join their webinar from the portal.",
    use_case: "WEBINAR",
    category: "transactional",
    loginUrlTarget: "portalLogin",
    body: "Hi {first_name}, for {item_short}: log in {login_url} Code {login_code} > My Webinars > Join. Naman Sharma IAS Academy",
    variableMap: ["first_name", "item_short", "login_url", "login_code"],
  },
  {
    template_key: "webinar_day_of_reminder",
    name: "Webinar Day-of Reminder",
    purpose: "Day-of nudge to join the webinar a few minutes early.",
    use_case: "WEBINAR",
    category: "transactional",
    loginUrlTarget: "portalLogin",
    body: "Hi {first_name}, {item_short} is today. Log in {login_url} > My Webinars > Join early. Naman Sharma IAS Academy",
    variableMap: ["first_name", "item_short", "login_url"],
  },
];

export function draftByKey(key: string): DraftTemplate | undefined {
  return DRAFT_SMS_TEMPLATES.find((t) => t.template_key === key);
}

export interface DraftCheck {
  template_key: string;
  chars: number;
  withinLimit: boolean;
  hasBrand: boolean;
  bodyVariables: string[];
  mapMatchesBody: boolean;
  loginUrl: string;
  ok: boolean;
}

export const DRAFT_CHAR_LIMIT = 150;

/** Programmatic self-check used by the doc generator + tests. */
export function checkDraft(t: DraftTemplate): DraftCheck {
  const chars = analyzeBody(t.body).length;
  const withinLimit = chars <= DRAFT_CHAR_LIMIT;
  const hasBrand = t.body.includes(BRAND_LINE);
  const bodyVariables = uniqueVariables(t.body);
  const mapSet = new Set(t.variableMap);
  const mapMatchesBody =
    bodyVariables.length === t.variableMap.length && bodyVariables.every((v) => mapSet.has(v));
  const loginUrl = WHITELISTED_URLS[t.loginUrlTarget];
  return {
    template_key: t.template_key,
    chars,
    withinLimit,
    hasBrand,
    bodyVariables,
    mapMatchesBody,
    loginUrl,
    ok: withinLimit && hasBrand && mapMatchesBody,
  };
}

export function checkAllDrafts(): DraftCheck[] {
  return DRAFT_SMS_TEMPLATES.map(checkDraft);
}
