/**
 * Pure HTML for a real-time paid Notes Store order alert.
 * Parse mode is HTML. Dynamic text is escaped.
 * Name, phone and city are included for the internal business channels.
 * Street address is never accepted by this formatter.
 */
import { istYMD } from "../dates";
import { isNotesTestOrder, isQualifyingNotesOrder, notesSubjectLabel, paiseToRupees, type NotesOrderInput } from "../store/reporting";
import { escapeHtml, formatIstClock, inrExact } from "./reports/format";

const RULE = "━━━━━━━━━━━━━━━━━━";

/** Orders paid longer ago than this, at baseline time, are marked pre-existing and not alerted. */
export const NOTES_ORDER_ALERT_GRACE_MS = 15 * 60 * 1000;

export const NOTES_ORDER_ALERT_EVENT = "notes_order_paid";

export const NOTES_ALERT_DESTINATIONS = ["executive", "sales_admissions"] as const;

export type NotesAlertDestination = (typeof NOTES_ALERT_DESTINATIONS)[number];

/** Existing Sales & Admissions chat title. Sends are refused when getChat does not match. */
export const SALES_ADMISSIONS_TITLE = "Naman IAS — Sales & Admissions";

export const NOTES_ORDER_REPLAY_ORDER_NO = "NIAS-N-2026-001002";

export interface NotesAlertCustomer {
  name: string;
  phone: string;
  city: string;
}

export interface NotesAlertItem {
  name: string;
  sku: string;
  qty: number;
}

export interface NotesAlertOrder {
  id: string;
  orderNo: string;
  status: string;
  paidAt: string | null;
  /** Captured receipt in paise. Omitted on pure count fixtures. */
  amountPaidPaise?: number | null;
  items: NotesAlertItem[];
}

export interface NotesPaidAlertCounts {
  sequence: number;
  total: number;
  today: number;
}

/** Legacy single-channel key. Left in place for orders already sent. */
export function notesOrderPaidLegacySlot(orderId: string): string {
  return `notes_order_paid:${orderId}`;
}

export function notesOrderPaidSlot(orderId: string, destination: NotesAlertDestination): string {
  return `notes_order_paid:${orderId}:${destination}`;
}

export function notesOrderReplaySlot(orderId: string, destination: NotesAlertDestination): string {
  return `notes_order_manual_replay:${orderId}:customer_details_v2:${destination}`;
}

export function notesOrderReplayRequestSlot(orderNo: string): string {
  return `notes_order_replay_request:customer_details_v2:${orderNo.trim().toUpperCase()}`;
}

export function salesAdmissionsTitleMatches(title: string | null | undefined): boolean {
  const norm = (value: string) => value.replace(/[—–−-]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
  return norm(title || "") === norm(SALES_ADMISSIONS_TITLE);
}

export function notesAlertText(value: string | null | undefined): string {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  return cleaned || "Not available";
}

/** Format a stored phone for Telegram. +91 is added only when the address country is India. */
export function formatNotesAlertPhone(raw: string | null | undefined, country: string | null | undefined): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "Not available";
  const digits = trimmed.replace(/\D/g, "");
  const countryNorm = String(country || "").trim().toUpperCase();
  const india = countryNorm === "IN" || countryNorm === "IND" || countryNorm === "INDIA";
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 10 ? digits : "";
  if (india && local.length === 10) return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
  if (trimmed.startsWith("+91") && digits.length === 12) {
    const ten = digits.slice(2);
    return `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`;
  }
  return trimmed;
}

export function resolveNotesAlertCustomer(input: {
  shippingName?: string | null;
  customerName?: string | null;
  shippingPhone?: string | null;
  orderPhone?: string | null;
  country?: string | null;
  city?: string | null;
}): NotesAlertCustomer {
  const phoneRaw = String(input.shippingPhone || "").trim() || String(input.orderPhone || "").trim();
  return {
    name: notesAlertText(input.shippingName || input.customerName),
    phone: formatNotesAlertPhone(phoneRaw, input.country),
    city: notesAlertText(input.city),
  };
}

/** The verify path may alert only on the first committed paid transition. */
export function shouldFireNotesPaidAlert(input: { outcome: string; transitioned: boolean }): boolean {
  return input.outcome === "paid" && input.transitioned;
}

function positiveQty(qty: number): number {
  const n = Math.round(Number(qty));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatNotesAlertStamp(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (!Number.isFinite(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "numeric",
  }).formatToParts(d);
  const day = parts.find((part) => part.type === "day")?.value || "";
  const monthIndex = Number(parts.find((part) => part.type === "month")?.value || "0") - 1;
  const month = MONTHS[monthIndex] || "";
  return `${day} ${month} · ${formatIstClock(d)} IST`;
}

export function formatNotesSubjectLine(items: { name: string; qty: number }[]): { text: string; units: number } {
  const parts = (items.length ? items : [{ name: "Notes", qty: 1 }]).map((item) => ({
    label: notesSubjectLabel(item.name) || "Notes",
    qty: positiveQty(item.qty),
  }));
  const units = parts.reduce((sum, part) => sum + part.qty, 0);
  const text = parts.map((part) => (part.qty > 1 ? `${part.label} ×${part.qty}` : part.label)).join(" + ");
  return { text: text || "Notes", units };
}

export function formatNotesOrderAlertHtml(input: {
  orderNo: string;
  sequence: number;
  items: { name: string; qty: number }[];
  paidPaise: number;
  paidAt: string;
  todayCount: number;
  totalCount: number;
  customer: NotesAlertCustomer;
  variant?: "new" | "updated";
  couponCode?: string | null;
  couponDiscountPaise?: number | null;
}): string {
  const subject = formatNotesSubjectLine(input.items);
  const paid = inrExact(paiseToRupees(input.paidPaise));
  const todayWord = input.todayCount === 1 ? "order" : "orders";
  const heading =
    input.sequence > 0
      ? `<b>#${input.sequence} · ${escapeHtml(input.orderNo || "Order")}</b>`
      : `<b>${escapeHtml(input.orderNo || "Order")}</b>`;
  const title = input.variant === "updated" ? "📦 <b>NOTES ORDER — UPDATED ALERT</b>" : "📦 <b>NEW NOTES ORDER</b>";
  const footer =
    input.variant === "updated"
      ? `<b>Total Notes Orders:</b> ${input.totalCount}`
      : `<b>Today:</b> ${input.todayCount} ${todayWord} · <b>Total:</b> ${input.totalCount}`;
  const customer = input.customer;
  return [
    RULE,
    title,
    "",
    heading,
    "",
    `📚 <b>${escapeHtml(subject.text)}</b>`,
    `💰 Paid <b>${escapeHtml(paid)}</b>`,
    ...(input.couponCode && (input.couponDiscountPaise || 0) > 0
      ? [`Offer: ${escapeHtml(input.couponCode)} · ${escapeHtml(inrExact(paiseToRupees(input.couponDiscountPaise || 0)))} off`]
      : []),
    "",
    `👤 <b>Customer:</b> ${escapeHtml(customer.name)}`,
    `📞 <b>Phone:</b> ${escapeHtml(customer.phone)}`,
    `📍 <b>City:</b> ${escapeHtml(customer.city)}`,
    "",
    `🕒 ${escapeHtml(formatNotesAlertStamp(input.paidAt))}`,
    "",
    footer,
    RULE,
  ].join("\n");
}

function asQualifyingInput(order: NotesAlertOrder): NotesOrderInput {
  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status,
    customerId: null,
    subtotalPaise: 0,
    discountPaise: 0,
    shippingPaise: 0,
    totalPaise: 0,
    amountPaidPaise: 0,
    amountRefundedPaise: 0,
    paidAt: order.paidAt,
    shippedAt: null,
    deliveredAt: null,
    items: order.items,
    shipments: [],
    openIssues: [],
  };
}

export function isAlertQualifyingOrder(order: NotesAlertOrder): boolean {
  return isQualifyingNotesOrder(asQualifyingInput(order));
}

export function isAlertTestOrder(order: Pick<NotesAlertOrder, "orderNo" | "items">): boolean {
  return isNotesTestOrder({ orderNo: order.orderNo, items: order.items });
}

/**
 * Sequence includes this order. Total is every qualifying Notes order.
 * Today is the IST day of this payment, matching the executive brief definition.
 */
export function notesPaidAlertCounts(orders: NotesAlertOrder[], orderId: string, paidAt: string): NotesPaidAlertCounts {
  const qualifying = orders.filter(isAlertQualifyingOrder);
  const self = qualifying.find((order) => order.id === orderId);
  const pool = self
    ? qualifying
    : [
        ...qualifying,
        {
          id: orderId,
          orderNo: "",
          status: "ORDER_CONFIRMED",
          paidAt,
          items: [] as NotesAlertItem[],
        },
      ];
  const sorted = [...pool].sort((a, b) => {
    const delta = Date.parse(a.paidAt || "") - Date.parse(b.paidAt || "");
    if (delta !== 0) return delta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const day = istYMD(paidAt);
  return {
    sequence: Math.max(1, sorted.findIndex((order) => order.id === orderId) + 1),
    total: pool.length,
    today: pool.filter((order) => istYMD(order.paidAt) === day).length,
  };
}

/** Historical qualifying orders to mark skipped, without sending. */
export function notesOrdersNeedingBaselineSkip(orders: NotesAlertOrder[], cutoffMs: number, graceMs = NOTES_ORDER_ALERT_GRACE_MS): string[] {
  const markBefore = cutoffMs - graceMs;
  return orders
    .filter((order) => {
      if (!isAlertQualifyingOrder(order) || !order.paidAt) return false;
      const paidMs = Date.parse(order.paidAt);
      return Number.isFinite(paidMs) && paidMs < markBefore;
    })
    .map((order) => order.id);
}

/** Recent qualifying orders with no successful alert yet. Historical rows stay out. */
export function notesOrdersNeedingAlert(
  orders: NotesAlertOrder[],
  outboxStatus: Map<string, string>,
  cutoffMs: number,
  graceMs = NOTES_ORDER_ALERT_GRACE_MS,
): string[] {
  const markBefore = cutoffMs - graceMs;
  return orders
    .filter((order) => {
      if (!isAlertQualifyingOrder(order) || !order.paidAt) return false;
      const paidMs = Date.parse(order.paidAt);
      if (!Number.isFinite(paidMs) || paidMs < markBefore) return false;
      const status = outboxStatus.get(order.id);
      return status !== "sent" && status !== "skipped";
    })
    .map((order) => order.id);
}
