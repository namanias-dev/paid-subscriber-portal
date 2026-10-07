/**
 * The DELIVERY fulfillment ladder for admin, customer tracking, and staff buttons.
 * Courier stages after pickup stay provider-owned. PACKED is still the only
 * status that starts automatic shipment booking. "pickup" here is the courier
 * collecting the parcel; Academy Pickup orders use PICKUP_PROGRESS in ./fulfillment.
 */

export const PROGRESS = [
  { key: "confirmed", admin: "New", customer: "Order confirmed", statuses: ["ORDER_CONFIRMED", "PAYMENT_CONFIRMED"] },
  { key: "preparing", admin: "Preparing", customer: "Preparing your notes", statuses: ["PROCESSING"] },
  { key: "printing", admin: "Printing", customer: "Printing your notes", statuses: ["PRINTING", "QUALITY_CHECK", "READY_TO_PACK"] },
  { key: "packed", admin: "Packed", customer: "Packed", statuses: ["PACKED"] },
  { key: "pickup", admin: "Courier pickup", customer: "Courier pickup", statuses: ["READY_FOR_PICKUP", "PICKUP_SCHEDULED"] },
  { key: "shipped", admin: "Shipped", customer: "Shipped", statuses: ["PICKED_UP"] },
  { key: "transit", admin: "In transit", customer: "In transit", statuses: ["IN_TRANSIT"] },
  { key: "delivery", admin: "Out for delivery", customer: "Out for delivery", statuses: ["OUT_FOR_DELIVERY"] },
  { key: "delivered", admin: "Delivered", customer: "Delivered", statuses: ["DELIVERED"] },
] as const;

const INDEX = new Map<string, number>();
for (const [index, step] of PROGRESS.entries()) {
  for (const status of step.statuses) INDEX.set(status, index);
}

/** Staff may only move these pre-shipment statuses. Shipping statuses are absent on purpose. */
export const STAFF_NEXT: Record<string, string> = {
  ORDER_CONFIRMED: "PROCESSING",
  PAYMENT_CONFIRMED: "PROCESSING",
  PROCESSING: "PRINTING",
  PRINTING: "PACKED",
  QUALITY_CHECK: "PACKED",
  READY_TO_PACK: "PACKED",
};

export function progressIndex(status: string): number | null {
  const index = INDEX.get(status);
  return index == null ? null : index;
}

export function adminStageLabel(status: string): string | null {
  const index = progressIndex(status);
  return index == null ? null : PROGRESS[index].admin;
}

export function customerProgressLabel(status: string): string | null {
  const index = progressIndex(status);
  return index == null ? null : PROGRESS[index].customer;
}

export function staffNextStatus(status: string): string | null {
  return STAFF_NEXT[status] || null;
}

export function staffAdvanceLabel(status: string): string | null {
  const next = staffNextStatus(status);
  if (next === "PROCESSING") return "Start preparing";
  if (next === "PRINTING") return "Start printing";
  if (next === "PACKED") return "Mark packed";
  return null;
}

function shortProductName(name: string): string {
  return name.replace(/\s+notes$/i, "").replace(/^indian\s+/i, "").trim() || name;
}

/** "Polity ×1 + Economy ×1": every subject in one order, never a second payment attempt. */
export function productList(items: Array<{ name: string; qty: number }>): string {
  if (!items.length) return "—";
  return items.map((item) => `${shortProductName(item.name)} ×${item.qty}`).join(" + ");
}

export function productSummary(items: Array<{ name: string; qty: number }>): string {
  if (!items.length) return "—";
  const first = `${items[0].name} ×${items[0].qty}`;
  if (items.length === 1) return first;
  return `${first} · +${items.length - 1} more`;
}
