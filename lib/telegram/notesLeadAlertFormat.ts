/**
 * Pure HTML and eligibility for Notes checkout-lead alerts.
 * Sales & Admissions only. Street address, email, and click ids are never accepted.
 */
import { CHECKOUT_ABANDON_MS, PAYMENT_ABANDON_MS, type CheckoutStage, type SalesStatus } from "../store/checkoutLeadLogic";
import { paiseToRupees } from "../store/reporting";
import { escapeHtml, inrExact } from "./reports/format";
import { formatNotesAlertPhone, formatNotesAlertStamp, notesAlertText, salesAdmissionsTitleMatches } from "./notesOrderAlertFormat";

export { salesAdmissionsTitleMatches };

const RULE = "━━━━━━━━━━━━━━━━━━";

export const NOTES_LEAD_QA_PHONE = "6000000091";
export const NOTES_LEAD_QA_REQUEST_SLOT = "notes_lead_qa_request:v1";

export type NotesLeadAlertKind = "checkout" | "payment" | "converted";

export interface NotesLeadCartLine {
  product_id?: string | null;
  name: string;
  qty: number;
  line_total_paise?: number;
}

export interface NotesLeadTouch {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
}

export interface NotesLeadAlertRecord {
  id: string;
  name: string | null;
  phone: string;
  stage: CheckoutStage;
  salesStatus: SalesStatus;
  cart: NotesLeadCartLine[];
  cartValuePaise: number;
  couponCode?: string | null;
  couponDiscountPaise?: number | null;
  cartAfterDiscountPaise?: number | null;
  lastActivityAt: string;
  marketingConsent: boolean;
  touch: NotesLeadTouch | null;
  orderId: string | null;
  orderNo: string | null;
  paid: boolean;
  paidPaise: number | null;
  isTest: boolean;
  priorCheckoutMessageId: number | null;
}

export type LeadAlertDecision = "send" | "historical" | "paid" | "do_not_contact" | "active" | "progressed" | "closed";

export function notesLeadAlertSlot(kind: NotesLeadAlertKind, leadId: string): string {
  const name = kind === "checkout" ? "checkout_abandoned" : kind === "payment" ? "payment_abandoned" : "lead_converted";
  return `notes_${name}:${leadId}:sales_admissions`;
}

export function notesLeadKindForStage(stage: CheckoutStage): "checkout" | "payment" | null {
  if (stage === "CHECKOUT_ABANDONED") return "checkout";
  if (stage === "PAYMENT_ABANDONED") return "payment";
  return null;
}

/** When this lead first became due for its current abandonment window. */
export function notesLeadDueMs(stage: CheckoutStage, lastActivityAt: string): number | null {
  const at = Date.parse(lastActivityAt);
  if (!Number.isFinite(at)) return null;
  if (stage === "PAYMENT_ABANDONED" || stage === "PAYMENT_INITIATED") return at + PAYMENT_ABANDON_MS;
  if (stage === "CHECKOUT_ABANDONED" || stage === "CONTACT_CAPTURED" || stage === "DETAILS_IN_PROGRESS") return at + CHECKOUT_ABANDON_MS;
  return null;
}

export function abandonedAlertDecision(input: {
  requested: "checkout" | "payment";
  stage: CheckoutStage;
  salesStatus: SalesStatus;
  lastActivityAt: string;
  cutoffMs: number | null;
  paid: boolean;
  qa?: boolean;
}): LeadAlertDecision {
  if (input.paid || input.stage === "CONVERTED") return "paid";
  if (input.stage === "EXPIRED") return "closed";
  if (input.salesStatus === "DO_NOT_CONTACT") return "do_not_contact";
  if (input.stage === "CONTACT_CAPTURED" || input.stage === "DETAILS_IN_PROGRESS" || input.stage === "PAYMENT_INITIATED") return "active";
  if (input.requested === "checkout" && input.stage === "PAYMENT_ABANDONED") return "progressed";
  if (notesLeadKindForStage(input.stage) !== input.requested) return "closed";
  if (!input.qa) {
    const due = notesLeadDueMs(input.stage, input.lastActivityAt);
    if (input.cutoffMs == null || due == null || due < input.cutoffMs) return "historical";
  }
  return "send";
}

const WORDS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  google: "Google",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  direct: "Direct",
  autodm: "Auto-DM",
  auto_dm: "Auto-DM",
  "auto-dm": "Auto-DM",
  manychat: "Auto-DM",
  story: "Story",
  stories: "Story",
  reel: "Reel",
  reels: "Reel",
  cpc: "CPC",
  organic: "Organic",
  paid: "Paid",
  referral: "Referral",
};

export function notesLeadLabel(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const known = WORDS[raw.toLowerCase()];
  if (known) return known;
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function notesLeadAdminUrl(leadId: string): string {
  return `https://www.namanias.com/admin/notes/leads?lead=${encodeURIComponent(leadId)}`;
}

function productBlock(items: NotesLeadCartLine[]): string {
  const lines = items.length ? items : [{ name: "Notes", qty: 1 }];
  const rendered = lines.map((item) => {
    const qty = Math.max(1, Math.round(Number(item.qty) || 1));
    const name = notesAlertText(item.name);
    return { name, qty };
  });
  if (rendered.length === 1) {
    const one = rendered[0];
    const suffix = one.qty > 1 ? ` ×${one.qty}` : "";
    return `📚 <b>Product:</b> ${escapeHtml(one.name + suffix)}`;
  }
  return ["📚 <b>Products</b>", ...rendered.map((item) => `• ${escapeHtml(item.name)} ×${item.qty}`)].join("\n");
}

function attributionLines(touch: NotesLeadTouch | null): string[] {
  const source = notesLeadLabel(touch?.source);
  const medium = notesLeadLabel(touch?.medium);
  const campaign = String(touch?.campaign || "").trim();
  const content = String(touch?.content || "").trim();
  if (!source || source === "Direct") {
    const lines = ["<b>Source:</b> Direct"];
    if (campaign) lines.push(`<b>Campaign:</b> ${escapeHtml(campaign)}`);
    if (content) lines.push(`<b>Content:</b> ${escapeHtml(content)}`);
    return lines;
  }
  const lines = [`<b>Source:</b> ${escapeHtml(source)}`];
  if (medium) lines.push(`<b>Medium:</b> ${escapeHtml(medium)}`);
  if (campaign) lines.push(`<b>Campaign:</b> ${escapeHtml(campaign)}`);
  if (content) lines.push(`<b>Content:</b> ${escapeHtml(content)}`);
  return lines;
}

export function formatNotesLeadAlertHtml(input: {
  lead: NotesLeadAlertRecord;
  kind: "checkout" | "payment";
  escalation: boolean;
  converted?: { paidPaise: number; orderNo: string | null } | null;
}): string {
  const lead = input.lead;
  const converted = input.converted || null;
  const test = lead.isTest ? ["🧪 <b>TEST — NOTES SALES LEAD</b>", ""] : [];
  const title = converted
    ? "✅ <b>CONVERTED / PAID</b>"
    : input.kind === "payment"
      ? input.escalation
        ? "🔥 <b>UPDATED / HOTTER LEAD</b>"
        : "🔥 <b>HOT NOTES LEAD — PAYMENT NOT COMPLETED</b>"
      : "🛒 <b>NOTES CHECKOUT LEAD</b>";
  const blurb = converted
    ? "<b>No sales follow-up required.</b>"
    : input.kind === "payment"
      ? input.escalation
        ? "🔥 <b>HOT NOTES LEAD — PAYMENT NOT COMPLETED</b>\nPayment stage reached but no payment captured."
        : "Payment stage reached but no payment captured."
      : "Checkout started but purchase not completed.";
  const stage = input.kind === "payment" ? "Payment started, not completed" : "Checkout abandoned";
  const action = lead.isTest
    ? "<b>Sales action:</b> Synthetic QA only. Do not call."
    : converted
      ? "<b>Sales action:</b> No sales follow-up required."
      : input.kind === "payment"
        ? "<b>Sales action:</b> High intent. Check whether the student had a payment or checkout issue and assist them."
        : "<b>Sales action:</b> Call and help the student complete the Notes order.";
  const paidLine = converted
    ? [
        "",
        `Paid successfully: <b>${escapeHtml(inrExact(paiseToRupees(converted.paidPaise)))}</b>`,
        `Order: <b>${escapeHtml(converted.orderNo || "Recorded")}</b>`,
      ]
    : [];
  return [
    RULE,
    ...test,
    title,
    "",
    blurb,
    "",
    `👤 <b>Student:</b> ${escapeHtml(notesAlertText(lead.name))}`,
    `📞 <b>Phone:</b> ${escapeHtml(formatNotesAlertPhone(lead.phone, "IN"))}`,
    "",
    productBlock(lead.cart),
    `💰 <b>Cart:</b> ${escapeHtml(inrExact(paiseToRupees(lead.cartAfterDiscountPaise ?? lead.cartValuePaise)))}`,
    ...(lead.couponCode && (lead.couponDiscountPaise || 0) > 0
      ? [`Offer: ${escapeHtml(lead.couponCode)} · ${escapeHtml(inrExact(paiseToRupees(lead.couponDiscountPaise || 0)))} off`]
      : []),
    "",
    `<b>Stage:</b> ${escapeHtml(stage)}`,
    `<b>Last activity:</b> ${escapeHtml(formatNotesAlertStamp(lead.lastActivityAt))}`,
    "",
    ...attributionLines(lead.touch),
    "",
    `<b>Marketing consent:</b> ${lead.marketingConsent ? "Yes" : "No"}`,
    `<b>Do not contact:</b> No`,
    "",
    `🔗 <b>Admin:</b> <a href="${notesLeadAdminUrl(lead.id)}">Open lead</a>`,
    ...paidLine,
    "",
    action,
    RULE,
  ].join("\n");
}

export function formatNotesLeadConvertedFollowUp(input: {
  lead: NotesLeadAlertRecord;
  paidPaise: number;
  orderNo: string | null;
}): string {
  const lead = input.lead;
  return [
    RULE,
    ...(lead.isTest ? ["🧪 <b>TEST — NOTES SALES LEAD</b>", ""] : []),
    "✅ <b>NOTES LEAD CONVERTED</b>",
    "",
    `<b>${escapeHtml(notesAlertText(lead.name))}</b>`,
    productBlock(lead.cart),
    "",
    `Paid successfully: <b>${escapeHtml(inrExact(paiseToRupees(input.paidPaise)))}</b>`,
    `Order: <b>${escapeHtml(input.orderNo || "Recorded")}</b>`,
    "",
    "<b>Sales follow-up no longer required.</b>",
    RULE,
  ].join("\n");
}

/** Non-PII analytics for a sent lead alert. */
export function notesLeadAlertAnalytics(lead: NotesLeadAlertRecord, kind: NotesLeadAlertKind): Record<string, unknown> {
  return {
    schema_version: 1,
    lead_id: lead.id,
    alert_type: kind,
    product_ids: lead.cart.map((line) => line.product_id).filter((id): id is string => Boolean(id)),
    source: notesLeadLabel(lead.touch?.source) || "Direct",
    campaign: String(lead.touch?.campaign || "").trim() || null,
    is_test: lead.isTest,
  };
}
