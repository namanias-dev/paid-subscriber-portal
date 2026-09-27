/**
 * Pure HTML for a real-time paid Notes Store order alert.
 * Parse mode is HTML. Dynamic text is escaped. No customer contact data.
 */
import { istYMD } from "../dates";
import { isNotesTestOrder, isQualifyingNotesOrder, notesSubjectLabel, paiseToRupees, type NotesOrderInput } from "../store/reporting";
import { escapeHtml, formatIstClock, inrExact } from "./reports/format";

const RULE = "━━━━━━━━━━━━━━━━━━";

/** Orders paid longer ago than this, at baseline time, are marked pre-existing and not alerted. */
export const NOTES_ORDER_ALERT_GRACE_MS = 15 * 60 * 1000;

export const NOTES_ORDER_ALERT_EVENT = "notes_order_paid";

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

export function notesOrderPaidSlot(orderId: string): string {
  return `notes_order_paid:${orderId}`;
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
}): string {
  const subject = formatNotesSubjectLine(input.items);
  const paid = inrExact(paiseToRupees(input.paidPaise));
  const paidLine =
    subject.units > 1
      ? `${subject.units} units · Paid <b>${escapeHtml(paid)}</b>`
      : `Paid <b>${escapeHtml(paid)}</b>`;
  const todayWord = input.todayCount === 1 ? "order" : "orders";
  const heading =
    input.sequence > 0
      ? `<b>#${input.sequence} · ${escapeHtml(input.orderNo || "Order")}</b>`
      : `<b>${escapeHtml(input.orderNo || "Order")}</b>`;
  return [
    RULE,
    "📦 <b>NEW NOTES ORDER</b>",
    "",
    heading,
    "",
    `<b>${escapeHtml(subject.text)}</b>`,
    paidLine,
    "",
    escapeHtml(formatNotesAlertStamp(input.paidAt)),
    "",
    `Today: <b>${input.todayCount} ${todayWord}</b> · Total: <b>${input.totalCount}</b>`,
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
