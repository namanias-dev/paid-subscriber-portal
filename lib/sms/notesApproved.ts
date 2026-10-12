/**
 * DLT-APPROVED NOTES STORE SMS TEMPLATES — checked-in source of truth.
 *
 * Source: "Naman_IAS_Notes_SMS_Template_Approval_Tracker Final.xlsx", sheet
 * "Notes SMS Templates", rows 6–10 (Template Text, Template ID, Template Type,
 * Approval Status = Approved). The text below is the registered DLT text and
 * must stay byte-identical to it: `Rs.` not ₹, U+2019 ’ where the registration
 * has it, the brand suffix, and the {#alp#}/{#num#}/{#urg#} slot order.
 *
 * The production `sms_templates` row for each key stores `approvedText` verbatim
 * as its body, so the generic renderer fills `{#alp#}` from a vars key named
 * `#alp#`. Every send of these ids is re-checked against this file:
 *   • sendSms refuses when the row drifts (body, DLT id, type, sender, route)
 *     or when the rendered text differs from the Notes builder's text;
 *   • the gateway refuses a Notes DLT id whose message does not match the
 *     approved skeleton with allowlisted variable values.
 *
 * No imports: the gateway and the store domain both read this file.
 */

export type NotesDltToken = "alp" | "num" | "urg";

export type NotesTemplateKey =
  | "NOTES_ORDER_CONFIRMED_01"
  | "NOTES_PAYMENT_PENDING_01"
  | "NOTES_CHECKOUT_INCOMPLETE_01"
  | "NOTES_NEW_LEAD_PROMO_01"
  | "NOTES_DISCOUNT_NOTES500_01";

export interface NotesApprovedVariable {
  /** 1-based position in the approved text. */
  slot: number;
  token: NotesDltToken;
  /** Literal placeholder in the approved text, e.g. `{#alp#}`. */
  placeholder: string;
  /** Key the renderer resolves the placeholder from (`#alp#`). */
  varKey: string;
  label: string;
  meaning: string;
}

export interface NotesApprovedTemplate {
  key: NotesTemplateKey;
  /** `sms_templates.id`. */
  id: string;
  name: string;
  dltTemplateId: string;
  dltType: "Service Implicit" | "Promotional";
  messageType: "service" | "promotional";
  category: "transactional" | "promo";
  useCase: "PAYMENT" | "ONBOARDING";
  /** `sms_logs.trigger_event` and `sms_auto_rules.trigger` for this template. */
  trigger: string;
  approvedText: string;
  variables: NotesApprovedVariable[];
  /** Approved sample values from the tracker, in slot order. */
  trackerSample: string;
  sourceRow: number;
}

export const NOTES_SMS_SENDER_ID = "NAMIAS";
export const NOTES_SMS_ROUTE = "12";
export const NOTES_SMS_ORIGIN = "https://www.namanias.com";
export const NOTES_SMS_SOURCE_FILE = "Naman_IAS_Notes_SMS_Template_Approval_Tracker Final.xlsx";

function v(slot: number, token: NotesDltToken, label: string, meaning: string): NotesApprovedVariable {
  return { slot, token, placeholder: `{#${token}#}`, varKey: `#${token}#`, label, meaning };
}

export const NOTES_APPROVED_TEMPLATES: readonly NotesApprovedTemplate[] = [
  {
    key: "NOTES_ORDER_CONFIRMED_01",
    id: "notes_order_confirmed_01",
    name: "NOTES_ORDER_CONFIRMED_01",
    dltTemplateId: "1777179058711611732",
    dltType: "Service Implicit",
    messageType: "service",
    category: "transactional",
    useCase: "PAYMENT",
    trigger: "notes_order_confirmed",
    approvedText:
      "Thank you! Your {#alp#} Notes order is confirmed. Rs.{#num#} payment received. Track: {#urg#} Naman Sharma IAS Academy.",
    variables: [
      v(1, "alp", "Subject", "Subjects on the paid order, from the order items"),
      v(2, "num", "Amount", "Captured amount on the order, rupees without Rs."),
      v(3, "urg", "Tracking URL", "Order tracking page"),
    ],
    trackerSample:
      "Thank you! Your Indian Polity Notes order is confirmed. Rs.2499 payment received. Track: https://www.namanias.com/notes/track Naman Sharma IAS Academy.",
    sourceRow: 6,
  },
  {
    key: "NOTES_PAYMENT_PENDING_01",
    id: "notes_payment_pending_01",
    name: "NOTES_PAYMENT_PENDING_01",
    dltTemplateId: "1777179057396343991",
    dltType: "Service Implicit",
    messageType: "service",
    category: "transactional",
    useCase: "PAYMENT",
    trigger: "notes_payment_pending",
    approvedText:
      "Your {#alp#} Notes order is saved, but payment of Rs.{#num#} is pending. Complete payment: {#urg#} Naman Sharma IAS Academy.",
    variables: [
      v(1, "alp", "Subject", "Subjects on the unpaid order, from the order items"),
      v(2, "num", "Amount", "Amount still due on that order, rupees without Rs."),
      v(3, "urg", "Payment URL", "Product page (single subject) or the Notes store"),
    ],
    trackerSample:
      "Your Indian Economy Notes order is saved, but payment of Rs.2999 is pending. Complete payment: https://www.namanias.com/notes/economy Pay Naman Sharma IAS Academy.",
    sourceRow: 7,
  },
  {
    key: "NOTES_CHECKOUT_INCOMPLETE_01",
    id: "notes_checkout_incomplete_01",
    name: "NOTES_CHECKOUT_INCOMPLETE_01",
    dltTemplateId: "1777179058827172599",
    dltType: "Service Implicit",
    messageType: "service",
    category: "transactional",
    useCase: "PAYMENT",
    trigger: "notes_checkout_incomplete",
    approvedText:
      "Your order for Naman Sir\u2019s handwritten UPSC Notes is currently pending. View your order details here: {#urg#} Naman Sharma IAS Academy.",
    variables: [v(1, "urg", "Checkout / cart recovery URL", "Notes store")],
    trackerSample:
      "Your order for Naman Sir\u2019s handwritten UPSC Notes is currently pending. View your order details here: https://www.namanias.com/notes Naman Sharma IAS Academy.",
    sourceRow: 8,
  },
  {
    key: "NOTES_NEW_LEAD_PROMO_01",
    id: "notes_new_lead_promo_01",
    name: "NOTES_NEW_LEAD_PROMO_01",
    dltTemplateId: "1777179057434102445",
    dltType: "Promotional",
    messageType: "promotional",
    category: "promo",
    useCase: "ONBOARDING",
    trigger: "notes_new_lead_promo",
    approvedText:
      "Naman Sir\u2019s handwritten UPSC Notes are now available in print. Get copies delivered to your home. Order: {#urg#} Naman Sharma IAS Academy.",
    variables: [v(1, "urg", "Notes Store URL", "Notes store")],
    trackerSample:
      "Naman Sir\u2019s handwritten UPSC Notes are now available in print. Get copies delivered to your home. Order: https://www.namanias.com/notes Notes Naman Sharma IAS Academy.",
    sourceRow: 9,
  },
  {
    key: "NOTES_DISCOUNT_NOTES500_01",
    id: "notes_discount_notes500_01",
    name: "NOTES_DISCOUNT_NOTES500_01",
    dltTemplateId: "1777179057448502622",
    dltType: "Promotional",
    messageType: "promotional",
    category: "promo",
    useCase: "ONBOARDING",
    trigger: "notes_discount_notes500",
    approvedText:
      "Special offer: Get Rs.500 off Naman Sir\u2019s handwritten UPSC Notes. Use code NOTES500. Order: {#urg#} Naman Sharma IAS Academy.",
    variables: [v(1, "urg", "Notes Store / checkout URL", "Notes store")],
    trackerSample:
      "Special offer: Get Rs.500 off Naman Sir\u2019s handwritten UPSC Notes. Use code NOTES500. Order: https://www.namanias.com/notes Naman Sharma IAS Academy.",
    sourceRow: 10,
  },
];

const BY_ID = new Map(NOTES_APPROVED_TEMPLATES.map((t) => [t.id, t]));
const BY_KEY = new Map(NOTES_APPROVED_TEMPLATES.map((t) => [t.key, t]));
const BY_DLT = new Map(NOTES_APPROVED_TEMPLATES.map((t) => [t.dltTemplateId, t]));

export function notesApprovedById(id: string | null | undefined): NotesApprovedTemplate | null {
  return (id && BY_ID.get(id)) || null;
}

export function notesApprovedByKey(key: string | null | undefined): NotesApprovedTemplate | null {
  return (key && BY_KEY.get(key as NotesTemplateKey)) || null;
}

export function notesApprovedByDltId(dltId: string | null | undefined): NotesApprovedTemplate | null {
  return (dltId && BY_DLT.get(String(dltId).trim())) || null;
}

export function isNotesApprovedTemplateId(id: string | null | undefined): boolean {
  return !!notesApprovedById(id);
}

/** Variable names stored on the `sms_templates` row (`uniqueVariables` of the body). */
export function notesTemplateVariableNames(t: NotesApprovedTemplate): string[] {
  return t.variables.map((x) => x.varKey);
}

/**
 * Non-ASCII characters in the approved text itself (the ’ in three templates).
 * ’ is outside GSM-7: the existing send guard refuses such bodies and the
 * gateway has never carried one, so these templates are held from provider
 * sends until the Unicode path is proven.
 */
export function notesNonAsciiCharacters(t: NotesApprovedTemplate): string[] {
  const out: string[] = [];
  for (const ch of t.approvedText) {
    if (ch.charCodeAt(0) > 0x7e && !out.includes(ch)) out.push(ch);
  }
  return out;
}

/** Fill the approved text in slot order. Values must already be validated. */
export function renderNotesApprovedText(
  t: NotesApprovedTemplate,
  values: Partial<Record<NotesDltToken, string>>,
): { ok: true; text: string } | { ok: false; missing: NotesDltToken[] } {
  const missing = t.variables.filter((x) => !values[x.token]).map((x) => x.token);
  if (missing.length) return { ok: false, missing };
  let text = t.approvedText;
  for (const x of t.variables) text = text.split(x.placeholder).join(String(values[x.token]));
  return { ok: true, text };
}

/** `{ "#alp#": "...", ... }` — the vars map the generic renderer consumes. */
export function notesRendererVars(
  t: NotesApprovedTemplate,
  values: Partial<Record<NotesDltToken, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const x of t.variables) {
    const val = values[x.token];
    if (val) out[x.varKey] = val;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Variable value rules. Shared by the builder (to refuse bad values) and the
// gateway (to refuse a message that does not match the approved skeleton).
// ---------------------------------------------------------------------------

/** DLT free-text variables were observed failing above 50 characters. */
export const NOTES_SMS_VAR_MAX = 50;

const SUBJECT_RE = /^[A-Z][A-Za-z ]{1,40}(?: \+ [A-Z][A-Za-z ]{1,40})*$/;
const AMOUNT_RE = /^[1-9]\d{0,6}(?:\.\d{2})?$/;
const URL_RE = /^https:\/\/www\.namanias\.com\/notes(?:\/track|\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

export function isValidNotesSubject(s: string): boolean {
  return [...s].length <= NOTES_SMS_VAR_MAX && SUBJECT_RE.test(s);
}

export function isValidNotesAmount(s: string): boolean {
  return AMOUNT_RE.test(s);
}

/** Allowlist: our own origin, the Notes store, its track page or one product slug. */
export function isAllowedNotesUrl(s: string): boolean {
  return [...s].length <= NOTES_SMS_VAR_MAX && URL_RE.test(s);
}

export function isValidNotesValue(token: NotesDltToken, s: string): boolean {
  if (token === "alp") return isValidNotesSubject(s);
  if (token === "num") return isValidNotesAmount(s);
  return isAllowedNotesUrl(s);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TOKEN_CAPTURE: Record<NotesDltToken, string> = {
  alp: "(.+?)",
  num: "(.+?)",
  urg: "(\\S+)",
};

/**
 * True when `message` is the approved text of the template registered under
 * `dltId`, with every slot holding a value that passes the value rules.
 * Returns null when the DLT id is not a Notes template.
 */
export function matchesNotesApprovedSkeleton(dltId: string, message: string): boolean | null {
  const t = notesApprovedByDltId(dltId);
  if (!t) return null;
  let pattern = "";
  let rest = t.approvedText;
  const order: NotesDltToken[] = [];
  for (const x of t.variables) {
    const i = rest.indexOf(x.placeholder);
    if (i < 0) return false;
    pattern += escapeRegExp(rest.slice(0, i)) + TOKEN_CAPTURE[x.token];
    order.push(x.token);
    rest = rest.slice(i + x.placeholder.length);
  }
  pattern += escapeRegExp(rest);
  const m = new RegExp(`^${pattern}$`).exec(message);
  if (!m) return false;
  return order.every((token, i) => isValidNotesValue(token, m[i + 1]));
}

// ---------------------------------------------------------------------------
// Drift between a stored row and the approved template.
// ---------------------------------------------------------------------------

export interface NotesTemplateRowLike {
  body_template?: string | null;
  gateway_template_id?: string | null;
  message_type?: string | null;
  category?: string | null;
  sender_id?: string | null;
  route?: string | null;
  status?: string | null;
}

export type NotesDriftField = "missing" | "body" | "dlt_id" | "message_type" | "category" | "sender_id" | "route" | "status";

export function notesTemplateDrift(t: NotesApprovedTemplate, row: NotesTemplateRowLike | null): NotesDriftField[] {
  if (!row) return ["missing"];
  const out: NotesDriftField[] = [];
  if ((row.body_template ?? "") !== t.approvedText) out.push("body");
  if (String(row.gateway_template_id ?? "").trim() !== t.dltTemplateId) out.push("dlt_id");
  if (row.message_type !== t.messageType) out.push("message_type");
  if (row.category !== t.category) out.push("category");
  if ((row.sender_id || NOTES_SMS_SENDER_ID) !== NOTES_SMS_SENDER_ID) out.push("sender_id");
  if ((row.route || NOTES_SMS_ROUTE) !== NOTES_SMS_ROUTE) out.push("route");
  if (row.status !== "active" && row.status !== "approved") out.push("status");
  return out;
}

/** Canonical row values for an explicit reconcile (never applied silently). */
export function notesCanonicalRow(t: NotesApprovedTemplate) {
  return {
    id: t.id,
    name: t.name,
    use_case: t.useCase,
    gateway_template_id: t.dltTemplateId,
    sender_id: NOTES_SMS_SENDER_ID,
    route: NOTES_SMS_ROUTE,
    message_type: t.messageType,
    category: t.category,
    body_template: t.approvedText,
    variables: notesTemplateVariableNames(t),
    status: "active" as const,
    is_active: true,
    auto_send_enabled: false,
    trigger_event: t.trigger,
    audience_type: "notes_store",
  };
}
