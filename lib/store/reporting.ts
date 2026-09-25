/**
 * Notes Store figures for the executive brief.
 * Read-only. Money stays in paise until a rupee figure is requested.
 * A qualifying order is one with paid_at set and a status past checkout.
 * Failed, expired, and still-pending checkouts are not orders and not cash.
 */

export interface NotesWindow {
  fromMs: number;
  toMs: number;
}

export interface NotesItemInput {
  name: string;
  sku: string;
  qty: number;
}

export interface NotesShipmentInput {
  provider: string;
  status: string;
  hasAwb: boolean;
  lastError: string | null;
}

export interface NotesIssueInput {
  category: string;
}

export interface NotesOrderInput {
  id: string;
  orderNo: string;
  status: string;
  customerId: string | null;
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  totalPaise: number;
  amountPaidPaise: number;
  amountRefundedPaise: number;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  items: NotesItemInput[];
  shipments: NotesShipmentInput[];
  openIssues: NotesIssueInput[];
}

export type NotesExecutiveStatus =
  | "to_pack"
  | "packed"
  | "shipment_created"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "rto"
  | "return"
  | "refund"
  | "issue";

export interface NotesSubjectLine {
  label: string;
  units: number;
  orders: number;
}

export interface NotesPeriod {
  orders: number;
  units: number;
  customers: number;
  cashRupees: number;
  shipped: number;
  delivered: number;
  cancelled: number;
  refundedRupees: number;
  subjects: NotesSubjectLine[];
}

export interface NotesFulfillmentCounts {
  toPack: number;
  packed: number;
  shipmentCreated: number;
  inTransit: number;
  outForDelivery: number;
  delivered: number;
  rto: number;
  returns: number;
  issues: number;
  open: number;
}

export interface NotesOpenOrder {
  orderNo: string;
  subjects: string;
  status: NotesExecutiveStatus;
  label: string;
  age: string | null;
  priority: number;
}

export interface NotesAttention {
  orderNo: string;
  subjects: string;
  reason: string;
}

export interface NotesStoreReport {
  today: NotesPeriod;
  yesterday: NotesPeriod;
  mtd: NotesPeriod;
  allTimeOrders: number;
  allTimeDelivered: number;
  allTimeCashRupees: number;
  allTimeRefundedRupees: number;
  fulfillment: NotesFulfillmentCounts;
  openOrders: NotesOpenOrder[];
  openOrdersTruncated: boolean;
  attention: NotesAttention[];
  providers: { label: string; count: number }[];
}

const UNPAID = new Set(["PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_EXPIRED"]);

const TERMINAL = new Set([
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
  "RTO_DELIVERED",
  "RETURN_RECEIVED",
]);

const STATUS_LABEL: Record<NotesExecutiveStatus, string> = {
  to_pack: "To pack",
  packed: "Packed",
  shipment_created: "Shipment created",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  rto: "RTO",
  return: "Return",
  refund: "Refund",
  issue: "Issue",
};

const ISSUE_LABEL: Record<string, string> = {
  ADDRESS_ISSUE: "Address issue",
  DELIVERY_DELAY: "Delivery delay",
  PICKUP_ISSUE: "Pickup issue",
  TRACKING_ISSUE: "Tracking issue",
  STATUS_MISMATCH: "Status mismatch",
  DAMAGE_ISSUE: "Damage reported",
  UPDATE_REQUEST: "Update requested",
  OTHER: "Open issue",
};

const PRIORITY: Record<NotesExecutiveStatus, number> = {
  issue: 0,
  rto: 1,
  return: 2,
  refund: 3,
  to_pack: 4,
  packed: 5,
  shipment_created: 6,
  in_transit: 7,
  out_for_delivery: 8,
  delivered: 9,
  cancelled: 10,
};

export function notesSubjectLabel(name: string): string {
  const cleaned = String(name || "")
    .replace(/\s+notes\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Notes";
}

export function paiseToRupees(paise: number): number {
  return Math.round(Number(paise) || 0) / 100;
}

export function isNotesTestOrder(order: Pick<NotesOrderInput, "orderNo" | "items">): boolean {
  if (/900001$/.test(order.orderNo || "")) return true;
  if (!order.items.length) return false;
  return order.items.every(
    (item) => /^TEST-/i.test(item.sku || "") || /^TEST ONLY\b/i.test(item.name || ""),
  );
}

/** Confirmed once payment is recorded. Checkout rows without paid_at are not orders. */
export function isQualifyingNotesOrder(order: NotesOrderInput): boolean {
  if (isNotesTestOrder(order)) return false;
  if (UNPAID.has(order.status)) return false;
  if (!order.paidAt) return false;
  return true;
}

export function notesExecutiveStatus(status: string): NotesExecutiveStatus {
  if (status === "DELIVERY_FAILED" || status === "REATTEMPT_REQUESTED") return "issue";
  if (status.startsWith("RTO_")) return "rto";
  if (status.startsWith("RETURN_")) return "return";
  if (status === "REFUND_PENDING" || status === "REFUNDED" || status === "PARTIALLY_REFUNDED") return "refund";
  if (status === "CANCELLED" || status === "CANCEL_REQUESTED") return "cancelled";
  if (status === "DELIVERED") return "delivered";
  if (status === "OUT_FOR_DELIVERY") return "out_for_delivery";
  if (status === "PICKED_UP" || status === "IN_TRANSIT") return "in_transit";
  if (status === "PICKUP_SCHEDULED") return "shipment_created";
  if (status === "PACKED" || status === "READY_FOR_PICKUP") return "packed";
  return "to_pack";
}

export function notesStatusLabel(status: NotesExecutiveStatus): string {
  return STATUS_LABEL[status];
}

function inWindow(iso: string | null, window: NotesWindow): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= window.fromMs && t < window.toMs;
}

function activeShipment(order: NotesOrderInput): NotesShipmentInput | null {
  const rows = order.shipments.filter((s) => s.status !== "cancelled");
  const live = rows.find((s) => s.status !== "failed") || rows[0] || null;
  return live;
}

function subjectText(order: NotesOrderInput): string {
  const labels = order.items
    .filter((item) => !/^TEST-/i.test(item.sku || ""))
    .map((item) => notesSubjectLabel(item.name));
  return [...new Set(labels)].join(" + ") || "Notes";
}

function unitsOf(order: NotesOrderInput): number {
  return order.items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
}

function subjectsOf(orders: NotesOrderInput[]): NotesSubjectLine[] {
  const map = new Map<string, { units: number; orders: Set<string> }>();
  for (const order of orders) {
    const seen = new Set<string>();
    for (const item of order.items) {
      const label = notesSubjectLabel(item.name);
      const row = map.get(label) || { units: 0, orders: new Set<string>() };
      row.units += Number(item.qty) || 0;
      if (!seen.has(label)) {
        row.orders.add(order.id);
        seen.add(label);
      }
      map.set(label, row);
    }
  }
  return [...map.entries()]
    .map(([label, row]) => ({ label, units: row.units, orders: row.orders.size }))
    .sort((a, b) => b.units - a.units || a.label.localeCompare(b.label));
}

function period(orders: NotesOrderInput[], window: NotesWindow): NotesPeriod {
  const placed = orders.filter((order) => inWindow(order.paidAt, window));
  const customers = new Set(placed.map((order) => order.customerId || order.id));
  return {
    orders: placed.length,
    units: placed.reduce((sum, order) => sum + unitsOf(order), 0),
    customers: customers.size,
    cashRupees: paiseToRupees(placed.reduce((sum, order) => sum + (order.amountPaidPaise || 0), 0)),
    shipped: orders.filter((order) => inWindow(order.shippedAt, window)).length,
    delivered: orders.filter((order) => inWindow(order.deliveredAt, window)).length,
    cancelled: orders.filter((order) => order.status === "CANCELLED" && inWindow(order.paidAt, window)).length,
    refundedRupees: paiseToRupees(placed.reduce((sum, order) => sum + (order.amountRefundedPaise || 0), 0)),
    subjects: subjectsOf(placed),
  };
}

function ageLabel(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const hours = Math.max(0, Math.floor((nowMs - t) / 3_600_000));
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function attentionFor(order: NotesOrderInput): string | null {
  if (order.openIssues.length) {
    return order.openIssues.map((issue) => ISSUE_LABEL[issue.category] || "Open issue").join(", ");
  }
  const shipment = activeShipment(order);
  if (shipment?.status === "failed") return shipment.lastError ? "Shipment creation failed" : "Courier booking failed";
  if (order.status === "DELIVERY_FAILED" || order.status === "REATTEMPT_REQUESTED") return "Delivery exception";
  if (order.status.startsWith("RTO_")) return "RTO";
  if (order.status === "REFUND_PENDING") return "Refund pending";
  if ((order.status === "PACKED" || order.status === "READY_FOR_PICKUP") && shipment && !shipment.hasAwb) {
    return "No courier booking";
  }
  return null;
}

function dedupe(orders: NotesOrderInput[]): NotesOrderInput[] {
  const seen = new Set<string>();
  const out: NotesOrderInput[] = [];
  for (const order of orders) {
    if (seen.has(order.id)) continue;
    seen.add(order.id);
    out.push(order);
  }
  return out;
}

export function buildNotesStoreReport(input: {
  orders: NotesOrderInput[];
  today: NotesWindow;
  yesterday: NotesWindow;
  mtd: NotesWindow;
  nowMs: number;
}): NotesStoreReport {
  const qualifying = dedupe(input.orders).filter(isQualifyingNotesOrder);
  const fulfillment: NotesFulfillmentCounts = {
    toPack: 0,
    packed: 0,
    shipmentCreated: 0,
    inTransit: 0,
    outForDelivery: 0,
    delivered: 0,
    rto: 0,
    returns: 0,
    issues: 0,
    open: 0,
  };
  const open: NotesOpenOrder[] = [];
  const attention: NotesAttention[] = [];
  const providers = new Map<string, number>();

  for (const order of qualifying) {
    const status = notesExecutiveStatus(order.status);
    if (status === "to_pack") fulfillment.toPack++;
    else if (status === "packed") fulfillment.packed++;
    else if (status === "shipment_created") fulfillment.shipmentCreated++;
    else if (status === "in_transit") fulfillment.inTransit++;
    else if (status === "out_for_delivery") fulfillment.outForDelivery++;
    else if (status === "delivered") fulfillment.delivered++;
    else if (status === "rto") fulfillment.rto++;
    else if (status === "return") fulfillment.returns++;
    else if (status === "issue" || status === "refund") fulfillment.issues++;

    const reason = attentionFor(order);
    if (reason) {
      fulfillment.issues += status === "issue" || status === "refund" || status === "rto" ? 0 : 1;
      attention.push({ orderNo: order.orderNo, subjects: subjectText(order), reason });
    }

    if (!TERMINAL.has(order.status) && status !== "cancelled") {
      fulfillment.open++;
      const stamp =
        status === "in_transit" || status === "out_for_delivery" ? order.shippedAt || order.paidAt : order.paidAt;
      open.push({
        orderNo: order.orderNo,
        subjects: subjectText(order),
        status,
        label: notesStatusLabel(status),
        age: ageLabel(stamp, input.nowMs),
        priority: PRIORITY[status],
      });
      const provider = activeShipment(order)?.provider;
      if (provider && provider !== "manual") {
        const label = provider === "shiprocket" ? "Shiprocket" : provider === "delhivery" ? "Delhivery" : provider;
        providers.set(label, (providers.get(label) || 0) + 1);
      }
    }
  }

  open.sort((a, b) => a.priority - b.priority || a.orderNo.localeCompare(b.orderNo));
  const truncated = open.length > 15;
  const listed = truncated
    ? [
        ...open.filter((row) => row.priority <= 3),
        ...open.filter((row) => row.priority > 3).slice(0, 8),
      ].filter((row, index, all) => all.findIndex((other) => other.orderNo === row.orderNo) === index)
    : open;

  return {
    today: period(qualifying, input.today),
    yesterday: period(qualifying, input.yesterday),
    mtd: period(qualifying, input.mtd),
    allTimeOrders: qualifying.length,
    allTimeDelivered: qualifying.filter((order) => order.status === "DELIVERED").length,
    allTimeCashRupees: paiseToRupees(qualifying.reduce((sum, order) => sum + (order.amountPaidPaise || 0), 0)),
    allTimeRefundedRupees: paiseToRupees(qualifying.reduce((sum, order) => sum + (order.amountRefundedPaise || 0), 0)),
    fulfillment,
    openOrders: listed,
    openOrdersTruncated: truncated,
    attention,
    providers: [...providers.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
  };
}
