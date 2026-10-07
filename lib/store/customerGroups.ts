import { maskPhone, normalizeIndianMobile } from "@/lib/store/checkoutLeadLogic";

const NOT_CAPTURED = new Set([
  "PAYMENT_PENDING",
  "PAYMENT_FAILED",
  "PAYMENT_EXPIRED",
  "CANCELLED",
  "CANCEL_REQUESTED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
]);

const ACTIVE_EXCLUDE = new Set(["DELIVERED", "COLLECTED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED", "PAYMENT_FAILED", "PAYMENT_EXPIRED", "PAYMENT_PENDING"]);

const BUCKETS: Record<string, string[]> = {
  confirming: ["PAYMENT_PENDING"],
  new: ["PAYMENT_CONFIRMED", "ORDER_CONFIRMED"],
  preparing: ["PROCESSING"],
  printing: ["PRINTING", "QUALITY_CHECK", "READY_TO_PACK"],
  packed: ["PACKED"],
  pickup: ["READY_FOR_PICKUP", "PICKUP_SCHEDULED"],
  shipped: ["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY"],
  delivered: ["DELIVERED"],
  ready_for_collection: ["READY_FOR_COLLECTION"],
  collected: ["COLLECTED"],
  unpaid: ["PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_EXPIRED", "CANCELLED", "CANCEL_REQUESTED"],
};

export interface GroupOrder {
  id: string;
  order_no: string;
  status: string;
  customer_name?: string | null;
  phone?: string | null;
  phone_key?: string | null;
  email?: string | null;
  customer_id?: string | null;
  total_paise?: number | null;
  paid_at?: string | null;
  placed_at?: string | null;
  updated_at?: string | null;
  action_required?: boolean;
}

export function isCapturedNotesOrder(order: { status: string; paid_at?: string | null }): boolean {
  return Boolean(order.paid_at) && !NOT_CAPTURED.has(order.status);
}

/** Phone is the guest identity. A missing phone falls back to the store customer, then the order itself. */
export function notesCustomerKey(order: GroupOrder): string {
  const phone = normalizeIndianMobile(order.phone_key || order.phone);
  if (phone) return `phone:${phone}`;
  if (order.customer_id) return `customer:${order.customer_id}`;
  return `order:${order.id}`;
}

function time(value: string | null | undefined): number {
  const n = value ? new Date(value).getTime() : 0;
  return Number.isFinite(n) ? n : 0;
}

function rank(order: GroupOrder): number {
  if (isCapturedNotesOrder(order) && !ACTIVE_EXCLUDE.has(order.status)) return 0;
  if (isCapturedNotesOrder(order)) return 1;
  if (order.status === "PAYMENT_PENDING") return 2;
  if (order.status === "PAYMENT_FAILED" || order.status === "CANCEL_REQUESTED") return 3;
  return 4;
}

export interface CustomerGroup<T extends GroupOrder> {
  key: string;
  name: string;
  masked_phone: string;
  /** Normalized 10-digit mobile. Admin read model only. */
  phone: string | null;
  email: string | null;
  customer_id: string | null;
  attempts: number;
  paid_count: number;
  paid_total_paise: number;
  primary: T;
  active: T[];
  orders: T[];
  matched_order_no: string | null;
}

export function groupNotesCustomers<T extends GroupOrder>(
  orders: T[],
  match?: (order: T) => boolean,
): CustomerGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const order of orders) {
    const key = notesCustomerKey(order);
    const list = buckets.get(key) || [];
    list.push(order);
    buckets.set(key, list);
  }
  const groups: CustomerGroup<T>[] = [];
  for (const [key, list] of buckets) {
    const sorted = [...list].sort((a, b) => rank(a) - rank(b) || time(b.placed_at) - time(a.placed_at));
    const primary = sorted[0];
    const captured = sorted.filter((order) => isCapturedNotesOrder(order));
    const nameSource = [...captured].sort((a, b) => time(b.paid_at || b.placed_at) - time(a.paid_at || a.placed_at))[0] || primary;
    const active = captured.filter((order) => !ACTIVE_EXCLUDE.has(order.status));
    const matched = match ? sorted.find((order) => match(order) && order.id !== primary.id) : undefined;
    groups.push({
      key,
      name: (nameSource.customer_name || primary.customer_name || "Customer").trim(),
      masked_phone: maskPhone(primary.phone_key || primary.phone),
      phone: normalizeIndianMobile(primary.phone_key || primary.phone),
      email: nameSource.email || primary.email || null,
      customer_id: primary.customer_id || null,
      attempts: sorted.length,
      paid_count: captured.length,
      paid_total_paise: captured.reduce((sum, order) => sum + (Number(order.total_paise) || 0), 0),
      primary,
      active,
      orders: [...sorted].sort((a, b) => time(b.placed_at) - time(a.placed_at)),
      matched_order_no: matched?.order_no || null,
    });
  }
  return groups.sort((a, b) => groupPriority(a) - groupPriority(b) || time(b.primary.updated_at || b.primary.placed_at) - time(a.primary.updated_at || a.primary.placed_at));
}

function groupPriority<T extends GroupOrder>(group: CustomerGroup<T>): number {
  if (group.orders.some((order) => order.action_required && isCapturedNotesOrder(order))) return 0;
  if (group.active.length) return 1;
  if (group.paid_count) return 2;
  if (group.orders.some((order) => order.status === "PAYMENT_PENDING")) return 3;
  return 4;
}

export function groupMatchesBucket<T extends GroupOrder>(group: CustomerGroup<T>, bucket: string): boolean {
  if (!bucket) return true;
  if (bucket === "paid") return group.paid_count > 0;
  if (bucket === "issues") return group.orders.some((order) => Boolean(order.action_required) && (group.paid_count === 0 || isCapturedNotesOrder(order)));
  if (bucket === "unpaid") return group.paid_count === 0;
  const statuses = BUCKETS[bucket];
  if (!statuses) return true;
  return group.orders.some((order) => statuses.includes(order.status));
}
