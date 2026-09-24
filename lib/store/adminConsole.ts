/** Notes admin operations view. Pure helpers: no courier calls, no status writes. */

export type AdminSort = "newest" | "oldest" | "value_desc" | "value_asc" | "updated" | "action";

export interface AdminQuote {
  provider: string;
  courier: string;
  service: string;
  ratePaise: number;
  etaText: string | null;
  etaDays: number | null;
  courierId?: string | null;
}

export interface RankedQuote extends AdminQuote {
  key: string;
  lowest: boolean;
  fastest: boolean;
  bestValue: boolean;
}

const PREP = new Set(["ORDER_CONFIRMED", "PAYMENT_CONFIRMED", "PROCESSING", "PRINTING", "QUALITY_CHECK", "READY_TO_PACK"]);

export function orderIndexLabel(orderNo: string): string {
  const match = String(orderNo || "").match(/(\d+)\s*$/);
  if (!match) return "";
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return "";
  return `#${n}`;
}

export function formatAdminWhen(value: string | null | undefined): string | null {
  if (!value) return null;
  const wall = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
    ? `${value.replace(" ", "T")}+05:30`
    : value.includes("T")
      ? value
      : `${value}T00:00:00+05:30`;
  const date = new Date(wall);
  if (Number.isNaN(date.getTime())) return null;
  const dated = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
  }).format(date);
  if (!value.includes(":") && !value.includes("T")) return dated;
  const time = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${dated} · ${time}`;
}

export function fulfillmentLabel(status: string, pickupFailed: boolean): string {
  if (pickupFailed) return "Pickup issue";
  switch (status) {
    case "PAYMENT_PENDING":
      return "Payment confirming";
    case "PAYMENT_CONFIRMED":
    case "ORDER_CONFIRMED":
      return "New";
    case "PROCESSING":
    case "PRINTING":
    case "QUALITY_CHECK":
    case "READY_TO_PACK":
      return "Preparing";
    case "PACKED":
    case "READY_FOR_PICKUP":
      return "Packed";
    case "PICKUP_SCHEDULED":
      return "Pickup scheduled";
    case "PICKED_UP":
      return "Shipped";
    case "IN_TRANSIT":
      return "In transit";
    case "OUT_FOR_DELIVERY":
      return "Out for delivery";
    case "DELIVERED":
      return "Delivered";
    case "DELIVERY_FAILED":
    case "REATTEMPT_REQUESTED":
      return "Delivery issue";
    case "CANCELLED":
    case "CANCEL_REQUESTED":
    case "PAYMENT_FAILED":
    case "PAYMENT_EXPIRED":
      return "Cancelled";
    default:
      if (status.startsWith("RTO_")) return "Returned";
      if (status.startsWith("RETURN_")) return "Return";
      if (status.startsWith("REFUND") || status === "PARTIALLY_REFUNDED") return "Refund";
      return status.replaceAll("_", " ").toLowerCase();
  }
}

export type BadgeTone = "neutral" | "navy" | "gold" | "amber" | "green" | "red";

export function fulfillmentTone(status: string, pickupFailed: boolean): BadgeTone {
  if (pickupFailed || status === "DELIVERY_FAILED" || status === "REFUND_PENDING" || status === "PAYMENT_PENDING") return "amber";
  if (status === "CANCELLED" || status === "PAYMENT_FAILED" || status.startsWith("RTO_")) return "red";
  if (status === "DELIVERED") return "green";
  if (status === "PICKUP_SCHEDULED" || status === "PACKED" || status === "READY_FOR_PICKUP") return "gold";
  if (PREP.has(status) || status === "IN_TRANSIT" || status === "PICKED_UP" || status === "OUT_FOR_DELIVERY") return "navy";
  return "neutral";
}

export function pickupFailedActivity(activity: string | null | undefined): boolean {
  return /not done|pickup exception|pickup failed/i.test(activity || "");
}

export interface ActionInput {
  status: string;
  awb?: string | null;
  pickupFailed?: boolean;
  addressMismatch?: boolean;
  openIssue?: boolean;
  paymentPending?: boolean;
  trackingStale?: boolean;
}

export function actionRequiredReasons(input: ActionInput): string[] {
  const reasons: string[] = [];
  if (input.paymentPending || input.status === "PAYMENT_PENDING") reasons.push("Payment confirmation pending");
  if (input.addressMismatch) reasons.push("Address mismatch");
  if ((input.status === "PACKED" || input.status === "READY_FOR_PICKUP") && !input.awb) reasons.push("No active shipment");
  if (input.pickupFailed) reasons.push("Pickup wasn't completed");
  if (input.status === "DELIVERY_FAILED" || input.status === "REATTEMPT_REQUESTED") reasons.push("Courier exception");
  if (input.openIssue) reasons.push("Customer issue open");
  if (input.status.startsWith("RETURN_")) reasons.push("Return action required");
  if (input.status === "REFUND_PENDING") reasons.push("Refund pending");
  if (input.trackingStale) reasons.push("Tracking stale");
  return reasons;
}

export type PrimaryAction =
  | "reconcile"
  | "prepare"
  | "pack"
  | "compare"
  | "label"
  | "resolve_pickup"
  | "tracking"
  | "review_issue"
  | "none";

export function primaryAction(input: ActionInput): PrimaryAction {
  if (input.pickupFailed) return "resolve_pickup";
  if (input.paymentPending || input.status === "PAYMENT_PENDING") return "reconcile";
  if (input.openIssue && (input.status === "DELIVERED" || input.status.startsWith("RETURN_"))) return "review_issue";
  if ((input.status === "PACKED" || input.status === "READY_FOR_PICKUP") && !input.awb) return "compare";
  if (input.status === "PICKUP_SCHEDULED") return "label";
  if (input.status === "PICKED_UP" || input.status === "IN_TRANSIT" || input.status === "OUT_FOR_DELIVERY") return "tracking";
  if (input.openIssue) return "review_issue";
  if (input.status === "READY_TO_PACK") return "pack";
  if (PREP.has(input.status)) return "prepare";
  return "none";
}

export const PRIMARY_LABEL: Record<PrimaryAction, string> = {
  reconcile: "Reconcile payment",
  prepare: "Prepare order",
  pack: "Mark packed",
  compare: "Compare couriers",
  label: "Print label",
  resolve_pickup: "Check pickup",
  tracking: "View tracking",
  review_issue: "Review issue",
  none: "View order",
};

const NEXT_PREP: Record<string, string> = {
  ORDER_CONFIRMED: "PROCESSING",
  PAYMENT_CONFIRMED: "PROCESSING",
  PROCESSING: "PRINTING",
  PRINTING: "QUALITY_CHECK",
  QUALITY_CHECK: "READY_TO_PACK",
  READY_TO_PACK: "PACKED",
};

export function nextPreparationStatus(status: string): string | null {
  return NEXT_PREP[status] || null;
}

export function hasActiveShipment(status: string | null | undefined, awb: string | null | undefined): boolean {
  if (!awb) return false;
  return status !== "cancelled" && status !== "failed";
}

function quoteKey(q: AdminQuote): string {
  return `${q.provider}|${q.courier}|${q.service}|${q.ratePaise}`;
}

function etaValue(q: AdminQuote): number | null {
  if (q.etaDays != null && Number.isFinite(q.etaDays)) return q.etaDays;
  return null;
}

export function rankQuotes(quotes: AdminQuote[], mode: "price" | "eta" = "price"): RankedQuote[] {
  const priced = quotes.filter((q) => Number.isFinite(q.ratePaise) && q.ratePaise > 0);
  if (!priced.length) return [];
  const lowestRate = Math.min(...priced.map((q) => q.ratePaise));
  const etas = priced.map(etaValue).filter((n): n is number => n != null);
  const fastestEta = etas.length ? Math.min(...etas) : null;
  const fastestGroup = fastestEta == null ? [] : priced.filter((q) => etaValue(q) === fastestEta);
  const bestRate = fastestGroup.length ? Math.min(...fastestGroup.map((q) => q.ratePaise)) : null;
  const ranked = priced.map((q) => {
    const lowest = q.ratePaise === lowestRate;
    const fastest = fastestEta != null && etaValue(q) === fastestEta;
    const bestValue = fastest && bestRate != null && q.ratePaise === bestRate && !lowest;
    return { ...q, key: quoteKey(q), lowest, fastest, bestValue };
  });
  ranked.sort((a, b) => {
    if (mode === "eta") {
      const ae = etaValue(a) ?? 999;
      const be = etaValue(b) ?? 999;
      if (ae !== be) return ae - be;
    }
    if (a.ratePaise !== b.ratePaise) return a.ratePaise - b.ratePaise;
    return a.courier.localeCompare(b.courier);
  });
  return ranked;
}

export function defaultQuote(quotes: AdminQuote[]): RankedQuote | null {
  return rankQuotes(quotes, "price")[0] || null;
}

export function sortAdminOrders<T extends { placed_at: string; total_paise: number; updated_at?: string | null; action_required?: boolean }>(
  rows: T[],
  sort: AdminSort,
): T[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    if (sort === "action") {
      const ar = Number(!!b.action_required) - Number(!!a.action_required);
      if (ar) return ar;
    }
    if (sort === "oldest") return a.placed_at.localeCompare(b.placed_at);
    if (sort === "value_desc") return b.total_paise - a.total_paise;
    if (sort === "value_asc") return a.total_paise - b.total_paise;
    if (sort === "updated") return String(b.updated_at || b.placed_at).localeCompare(String(a.updated_at || a.placed_at));
    return b.placed_at.localeCompare(a.placed_at);
  });
  return copy;
}

export function volumetricGrams(lengthCm: number, widthCm: number, heightCm: number): number | null {
  if (![lengthCm, widthCm, heightCm].every((n) => Number.isFinite(n) && n > 0)) return null;
  return Math.round(((lengthCm * widthCm * heightCm) / 5000) * 1000);
}
