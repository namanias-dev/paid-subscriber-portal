/**
 * buildAndValidateNotesSms — the single decision point for every Notes SMS.
 *
 * Pure: callers load the facts (load.ts) and this decides. The destination and
 * every variable come from the same order or lead record, so a message about
 * order A can only ever be addressed to order A's phone. Anything missing,
 * inconsistent or ambiguous is a blocker; a plan with any blocker or hold is
 * never sent.
 */
import {
  notesApprovedByKey,
  notesNonAsciiCharacters,
  notesTemplateDrift,
  renderNotesApprovedText,
  type NotesApprovedTemplate,
  type NotesDltToken,
  type NotesTemplateKey,
  type NotesTemplateRowLike,
} from "@/lib/sms/notesApproved";
import { normalizeIndianMobile } from "../checkoutLeadLogic";
import {
  NOTES_STORE_URL,
  NOTES_TRACK_URL,
  formatNotesAmount,
  maskNotesPhone,
  notesPaymentUrl,
  notesSubjectFromLines,
  type NotesOrderLine,
} from "./values";

/** Paid and still heading to the customer. */
export const NOTES_CONFIRMABLE_STATUSES = new Set([
  "PAYMENT_CONFIRMED", "ORDER_CONFIRMED", "PROCESSING", "PRINTING", "QUALITY_CHECK",
  "READY_TO_PACK", "PACKED", "READY_FOR_PICKUP", "PICKUP_SCHEDULED", "PICKED_UP",
  "IN_TRANSIT", "OUT_FOR_DELIVERY", "READY_FOR_COLLECTION",
]);
export const NOTES_UNPAID_STATUSES = new Set(["PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_EXPIRED"]);
/** Payment attempts the bank may still complete. */
export const NOTES_OPEN_PAYMENT_STATUSES = new Set(["INITIATED", "UNCONFIRMED", "VERIFYING"]);

export const PENDING_SUPPRESS_HOURS = 24;
export const CHECKOUT_SUPPRESS_DAYS = 7;
export const PROMO_FREQUENCY_DAYS = 7;
export const MANUAL_MAX_ORDER_AGE_DAYS = 7;

export interface NotesOrderFacts {
  id: string;
  order_no: string;
  status: string;
  phone: string | null;
  phone_key: string | null;
  customer_name: string | null;
  total_paise: number;
  amount_paid_paise: number | null;
  amount_refunded_paise: number | null;
  paid_at: string | null;
  created_at: string;
}

export interface NotesPaymentFacts {
  id: string;
  status: string;
  amount_paise: number;
  captured_at: string | null;
  created_at: string;
}

/** Another order on the same phone (phone_key), for retry/precedence checks. */
export interface NotesSiblingOrder {
  id: string;
  status: string;
  created_at: string;
  paid_at: string | null;
}

export interface NotesLeadFacts {
  id: string;
  phone: string | null;
  phone_key: string | null;
  checkout_stage: string;
  sales_status: string;
  marketing_consent: boolean;
  order_id: string | null;
  is_test: boolean;
  redacted_at: string | null;
  last_activity_at: string;
  created_at: string;
}

export interface NotesPriorSms {
  template_id: string | null;
  status: string;
  created_at: string;
  dedupe_key: string | null;
}

export interface NotesTemplateContext {
  /** The stored sms_templates row (null when absent). */
  row: NotesTemplateRowLike | null;
  /** NOTES500 only: null when the code is live, otherwise why it is not. */
  promoCodeProblem?: string | null;
}

export type NotesSmsSource =
  | { kind: "order"; orderId: string; orderNo: string | null; paymentId: string | null }
  | { kind: "checkout_lead"; leadId: string }
  | { kind: "academy_lead"; leadId: string };

export interface NotesSmsPlan {
  templateKey: NotesTemplateKey;
  templateId: string;
  dltTemplateId: string;
  dltType: NotesApprovedTemplate["dltType"];
  messageType: NotesApprovedTemplate["messageType"];
  trigger: string;
  approvedText: string;
  variables: { slot: number; token: NotesDltToken; label: string; value: string | null }[];
  /** Exact text that would be submitted. Null when a slot could not be filled. */
  text: string | null;
  destination: { digits10: string | null; masked: string };
  customerName: string | null;
  source: NotesSmsSource | null;
  dedupeKey: string | null;
  /** Record-level refusals (this order/lead). */
  blockers: string[];
  /** Template-level refusal that applies to every recipient. */
  hold: string | null;
  /** True only when there is no blocker and no hold. */
  ok: boolean;
}

/**
 * Template-level holds. Order matters only for display; any one blocks sending.
 */
export function notesTemplateHold(t: NotesApprovedTemplate, ctx: NotesTemplateContext): string | null {
  const drift = notesTemplateDrift(t, ctx.row);
  if (drift.length) return `template_drift:${drift.join(",")}`;
  const nonAscii = notesNonAsciiCharacters(t);
  if (nonAscii.length) return "approved_text_not_gsm7";
  if (t.key === "NOTES_DISCOUNT_NOTES500_01" && ctx.promoCodeProblem !== null) {
    return `promo_code_${ctx.promoCodeProblem || "unverified"}`;
  }
  return null;
}

function basePlan(t: NotesApprovedTemplate, ctx: NotesTemplateContext): NotesSmsPlan {
  return {
    templateKey: t.key,
    templateId: t.id,
    dltTemplateId: t.dltTemplateId,
    dltType: t.dltType,
    messageType: t.messageType,
    trigger: t.trigger,
    approvedText: t.approvedText,
    variables: t.variables.map((v) => ({ slot: v.slot, token: v.token, label: v.label, value: null })),
    text: null,
    destination: { digits10: null, masked: "••••" },
    customerName: null,
    source: null,
    dedupeKey: null,
    blockers: [],
    hold: notesTemplateHold(t, ctx),
    ok: false,
  };
}

function finish(plan: NotesSmsPlan, t: NotesApprovedTemplate, values: Partial<Record<NotesDltToken, string>>): NotesSmsPlan {
  plan.variables = plan.variables.map((v) => ({ ...v, value: values[v.token] ?? null }));
  const rendered = renderNotesApprovedText(t, values);
  if (rendered.ok) plan.text = rendered.text;
  else plan.blockers.push(...rendered.missing.map((m) => `missing_${m}`));
  plan.blockers = [...new Set(plan.blockers)];
  plan.ok = plan.blockers.length === 0 && plan.hold === null && plan.text !== null && plan.destination.digits10 !== null;
  return plan;
}

function setDestination(plan: NotesSmsPlan, phone: string | null, phoneKey: string | null): void {
  const digits = normalizeIndianMobile(phone);
  if (!digits) {
    plan.blockers.push("invalid_phone");
    return;
  }
  if (phoneKey && phoneKey !== digits) {
    plan.blockers.push("phone_mismatch");
    return;
  }
  plan.destination = { digits10: digits, masked: maskNotesPhone(digits) };
}

function ms(iso: string): number {
  return new Date(iso).getTime();
}

function hoursBetween(a: string, b: Date): number {
  return (b.getTime() - ms(a)) / 3_600_000;
}

function recentSends(history: NotesPriorSms[], templateIds: string[], sinceMs: number): NotesPriorSms[] {
  return history.filter(
    (h) =>
      templateIds.includes(h.template_id || "") &&
      ["QUEUED", "SENT", "DELIVERED"].includes(h.status) &&
      ms(h.created_at) >= sinceMs,
  );
}

export interface OrderPlanInput {
  templateKey: NotesTemplateKey;
  ctx: NotesTemplateContext;
  order: NotesOrderFacts | null;
  items: NotesOrderLine[];
  payments: NotesPaymentFacts[];
  /** Other orders with the same phone_key. */
  siblings: NotesSiblingOrder[];
  /** Notes SMS already logged to this phone (any template). */
  history: NotesPriorSms[];
  now: Date;
}

/** Order-based templates: ORDER_CONFIRMED and PAYMENT_PENDING. */
export function buildAndValidateNotesOrderSms(input: OrderPlanInput): NotesSmsPlan {
  const t = notesApprovedByKey(input.templateKey);
  if (!t) throw new Error(`unknown Notes template ${input.templateKey}`);
  const plan = basePlan(t, input.ctx);
  const values: Partial<Record<NotesDltToken, string>> = {};
  const order = input.order;

  if (t.key !== "NOTES_ORDER_CONFIRMED_01" && t.key !== "NOTES_PAYMENT_PENDING_01") {
    plan.blockers.push("template_not_order_based");
    return finish(plan, t, values);
  }
  if (!order) {
    plan.blockers.push("order_not_found");
    return finish(plan, t, values);
  }
  plan.customerName = order.customer_name;
  setDestination(plan, order.phone, order.phone_key);

  const subject = notesSubjectFromLines(input.items);
  if (subject.ok) values.alp = subject.subject;
  else plan.blockers.push(`subject_${subject.reason}`);

  const captured = input.payments.filter((p) => p.status === "CAPTURED");
  const latest = [...input.payments].sort((a, b) => ms(b.created_at) - ms(a.created_at))[0] || null;

  if (t.key === "NOTES_ORDER_CONFIRMED_01") {
    plan.source = { kind: "order", orderId: order.id, orderNo: order.order_no, paymentId: captured[0]?.id ?? null };
    if (!NOTES_CONFIRMABLE_STATUSES.has(order.status)) plan.blockers.push(`order_status_${order.status.toLowerCase()}`);
    if (!order.paid_at) plan.blockers.push("order_not_paid");
    if (Number(order.amount_refunded_paise || 0) > 0) plan.blockers.push("order_refunded");
    if (captured.length === 0) plan.blockers.push("no_captured_payment");
    if (captured.length > 1) plan.blockers.push("multiple_captured_payments");
    if (captured.length === 1) {
      const pay = captured[0];
      const paid = Number(order.amount_paid_paise);
      if (pay.amount_paise !== paid || paid !== Number(order.total_paise)) plan.blockers.push("amount_mismatch");
      const amount = formatNotesAmount(paid);
      if (amount) values.num = amount;
      else plan.blockers.push("amount_invalid");
      plan.dedupeKey = `${t.key}:${order.id}:${pay.id}`;
    }
    values.urg = NOTES_TRACK_URL;
    return finish(plan, t, values);
  }

  // NOTES_PAYMENT_PENDING_01
  plan.source = { kind: "order", orderId: order.id, orderNo: order.order_no, paymentId: latest?.id ?? null };
  plan.dedupeKey = `${t.key}:${order.id}`;
  if (!NOTES_UNPAID_STATUSES.has(order.status)) plan.blockers.push(`order_status_${order.status.toLowerCase()}`);
  if (order.paid_at || Number(order.amount_paid_paise || 0) > 0) plan.blockers.push("order_paid");
  if (captured.length) plan.blockers.push("payment_captured");
  if (!latest) plan.blockers.push("no_payment_attempt");
  else if (NOTES_OPEN_PAYMENT_STATUSES.has(latest.status)) plan.blockers.push("payment_in_flight");
  if (latest && latest.amount_paise !== Number(order.total_paise)) plan.blockers.push("amount_mismatch");
  const amount = formatNotesAmount(Number(order.total_paise));
  if (amount) values.num = amount;
  else plan.blockers.push("amount_invalid");
  if (hoursBetween(order.created_at, input.now) > MANUAL_MAX_ORDER_AGE_DAYS * 24) plan.blockers.push("order_too_old");

  const later = input.siblings.filter((s) => s.id !== order.id && ms(s.created_at) >= ms(order.created_at));
  if (later.some((s) => !!s.paid_at || NOTES_CONFIRMABLE_STATUSES.has(s.status))) plan.blockers.push("customer_paid_later_order");
  else if (later.length) plan.blockers.push("newer_order_attempt");
  const sinceMs = input.now.getTime() - PENDING_SUPPRESS_HOURS * 3_600_000;
  if (recentSends(input.history, [t.id], sinceMs).some((h) => h.dedupe_key !== plan.dedupeKey)) {
    plan.blockers.push("pending_sms_sent_recently");
  }
  if (subject.ok) values.urg = notesPaymentUrl(subject.slugs);
  return finish(plan, t, values);
}

export interface LeadPlanInput {
  templateKey: NotesTemplateKey;
  ctx: NotesTemplateContext;
  lead: NotesLeadFacts | null;
  /** Orders on the lead's phone_key. */
  phoneOrders: NotesSiblingOrder[];
  history: NotesPriorSms[];
  now: Date;
}

const DO_NOT_CONTACT = new Set(["DO_NOT_CONTACT", "NOT_INTERESTED"]);

/**
 * Notes checkout leads: CHECKOUT_INCOMPLETE, and the two promotional templates
 * for a lead who gave marketing consent at checkout.
 */
export function buildAndValidateNotesLeadSms(input: LeadPlanInput): NotesSmsPlan {
  const t = notesApprovedByKey(input.templateKey);
  if (!t) throw new Error(`unknown Notes template ${input.templateKey}`);
  const plan = basePlan(t, input.ctx);
  const values: Partial<Record<NotesDltToken, string>> = {};
  const lead = input.lead;

  if (t.key === "NOTES_ORDER_CONFIRMED_01" || t.key === "NOTES_PAYMENT_PENDING_01") {
    plan.blockers.push("template_is_order_based");
    return finish(plan, t, values);
  }
  if (!lead) {
    plan.blockers.push("lead_not_found");
    return finish(plan, t, values);
  }
  plan.source = { kind: "checkout_lead", leadId: lead.id };
  setDestination(plan, lead.phone, lead.phone_key);
  if (lead.is_test) plan.blockers.push("test_lead");
  if (lead.redacted_at) plan.blockers.push("lead_redacted");
  if (!lead.marketing_consent) plan.blockers.push("no_marketing_consent");
  if (DO_NOT_CONTACT.has(lead.sales_status)) plan.blockers.push("lead_do_not_contact");
  values.urg = NOTES_STORE_URL;

  if (t.key === "NOTES_CHECKOUT_INCOMPLETE_01") {
    plan.dedupeKey = `${t.key}:${lead.id}`;
    if (lead.checkout_stage !== "CHECKOUT_ABANDONED") plan.blockers.push(`lead_stage_${lead.checkout_stage.toLowerCase()}`);
    if (lead.order_id) plan.blockers.push("lead_has_order");
    if (input.phoneOrders.some((o) => ms(o.created_at) >= ms(lead.created_at))) plan.blockers.push("customer_ordered");
    const sinceMs = input.now.getTime() - CHECKOUT_SUPPRESS_DAYS * 86_400_000;
    const recent = recentSends(input.history, ["notes_checkout_incomplete_01", "notes_payment_pending_01"], sinceMs);
    if (recent.some((h) => h.dedupe_key !== plan.dedupeKey)) plan.blockers.push("recovery_sms_sent_recently");
    return finish(plan, t, values);
  }

  // Promotional templates.
  plan.dedupeKey = `${t.key}:checkout_lead:${lead.id}`;
  if (input.phoneOrders.some((o) => !!o.paid_at || NOTES_CONFIRMABLE_STATUSES.has(o.status))) plan.blockers.push("existing_notes_customer");
  applyPromoFrequency(plan, input.history, input.now);
  return finish(plan, t, values);
}

export function applyPromoFrequency(plan: NotesSmsPlan, history: NotesPriorSms[], now: Date): void {
  const sinceMs = now.getTime() - PROMO_FREQUENCY_DAYS * 86_400_000;
  const promoIds = ["notes_new_lead_promo_01", "notes_discount_notes500_01"];
  if (recentSends(history, promoIds, sinceMs).some((h) => h.dedupe_key !== plan.dedupeKey)) {
    plan.blockers.push("promo_frequency_cap");
  }
  if (history.some((h) => h.template_id === plan.templateId && ["QUEUED", "SENT", "DELIVERED"].includes(h.status) && h.dedupe_key !== plan.dedupeKey)) {
    plan.blockers.push("promo_already_received");
  }
}

export interface AcademyLeadPromoInput {
  templateKey: NotesTemplateKey;
  ctx: NotesTemplateContext;
  lead: { id: string; phone: string | null; consent_status: string | null; is_test?: boolean } | null;
  /** Notes orders on that phone. */
  phoneOrders: NotesSiblingOrder[];
  history: NotesPriorSms[];
  now: Date;
}

/**
 * Promotional templates for an academy lead. Academy leads carry
 * `consent_status`; only an explicit consent qualifies for a promotional send.
 */
export function buildAndValidateNotesAcademyLeadPromo(input: AcademyLeadPromoInput): NotesSmsPlan {
  const t = notesApprovedByKey(input.templateKey);
  if (!t) throw new Error(`unknown Notes template ${input.templateKey}`);
  const plan = basePlan(t, input.ctx);
  const values: Partial<Record<NotesDltToken, string>> = {};
  if (t.messageType !== "promotional") {
    plan.blockers.push("template_not_promotional");
    return finish(plan, t, values);
  }
  const lead = input.lead;
  if (!lead) {
    plan.blockers.push("lead_not_found");
    return finish(plan, t, values);
  }
  plan.source = { kind: "academy_lead", leadId: lead.id };
  setDestination(plan, lead.phone, null);
  if (lead.is_test) plan.blockers.push("test_lead");
  if (lead.consent_status !== "explicit") plan.blockers.push(`consent_${lead.consent_status || "unknown"}`);
  if (input.phoneOrders.some((o) => !!o.paid_at || NOTES_CONFIRMABLE_STATUSES.has(o.status))) plan.blockers.push("existing_notes_customer");
  plan.dedupeKey = `${t.key}:academy_lead:${lead.id}`;
  applyPromoFrequency(plan, input.history, input.now);
  values.urg = NOTES_STORE_URL;
  return finish(plan, t, values);
}

/** Human-readable reason text for Mission Control. */
export const NOTES_REASON_TEXT: Record<string, string> = {
  approved_text_not_gsm7:
    "Approved text contains \u2019 (U+2019), which is outside GSM-7. The existing send guard blocks non-GSM bodies and no Unicode SMS has been proven on this gateway. Held until the registered character is confirmed with the DLT agency.",
  promo_code_expired: "Approved template \u2014 automation unavailable because NOTES500 is not currently valid (code expired).",
  promo_code_inactive: "Approved template \u2014 automation unavailable because NOTES500 is not currently valid (code inactive).",
  promo_code_missing: "Approved template \u2014 automation unavailable because NOTES500 does not exist in Discounts.",
  promo_code_exhausted: "Approved template \u2014 automation unavailable because NOTES500 has no redemptions left.",
  promo_code_value_mismatch: "Approved template \u2014 NOTES500 is not a fixed Rs.500 discount, so the message would be untrue.",
  promo_code_scheduled: "Approved template \u2014 NOTES500 has not started yet.",
  promo_code_archived: "Approved template \u2014 NOTES500 is archived.",
  promo_code_unverified: "Approved template \u2014 NOTES500 validity could not be checked.",
  invalid_phone: "No valid Indian mobile on the record.",
  phone_mismatch: "The record's phone and phone key disagree.",
  order_not_found: "Order not found.",
  order_not_paid: "Order is not paid.",
  order_refunded: "Order has a refund.",
  no_captured_payment: "No captured payment on the order.",
  multiple_captured_payments: "More than one captured payment \u2014 ambiguous.",
  amount_mismatch: "Order and payment amounts disagree.",
  amount_invalid: "Amount is missing or invalid.",
  payment_captured: "Payment was captured.",
  order_paid: "Order is paid.",
  payment_in_flight: "A payment attempt may still complete at the bank.",
  no_payment_attempt: "No payment attempt on the order.",
  order_too_old: "Order is older than 7 days.",
  customer_paid_later_order: "Customer paid a later order.",
  newer_order_attempt: "Customer started a newer order.",
  pending_sms_sent_recently: "A payment-pending SMS went to this phone in the last 24 hours.",
  recovery_sms_sent_recently: "A recovery SMS went to this phone in the last 7 days.",
  subject_unknown_product: "An item is not a live Notes product.",
  subject_no_items: "Order has no items.",
  subject_subject_too_long: "Subject text exceeds 50 characters.",
  test_lead: "Test lead.",
  lead_redacted: "Lead was redacted.",
  no_marketing_consent: "No marketing consent recorded.",
  lead_do_not_contact: "Lead marked Do-not-contact / Not interested.",
  lead_has_order: "Lead already created an order.",
  customer_ordered: "Customer placed an order after this lead.",
  existing_notes_customer: "Already a paying Notes customer.",
  promo_frequency_cap: "A Notes promotion went to this phone in the last 7 days.",
  promo_already_received: "This promotion was already sent to this phone.",
  consent_unknown: "Lead consent is unknown \u2014 promotional SMS needs explicit consent.",
  consent_implied: "Lead consent is only implied \u2014 promotional SMS needs explicit consent.",
  consent_withdrawn: "Lead withdrew consent.",
  lead_not_found: "Lead not found.",
};

export function notesReasonText(code: string): string {
  if (NOTES_REASON_TEXT[code]) return NOTES_REASON_TEXT[code];
  if (code.startsWith("template_drift:")) {
    return `Stored template differs from the approved DLT registration (${code.slice(15)}). Sending is stopped until it is reconciled.`;
  }
  if (code.startsWith("order_status_")) return `Order status is ${code.slice(13).toUpperCase()}.`;
  if (code.startsWith("lead_stage_")) return `Lead stage is ${code.slice(11).toUpperCase()}.`;
  return code.replace(/_/g, " ");
}
