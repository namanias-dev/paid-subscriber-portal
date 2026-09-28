/**
 * Read-only Notes Store load for the executive brief.
 * Selects no phone, address, payment payload, or courier secret.
 */
import { buildNotesStoreReport, type NotesOrderInput, type NotesStoreReport, type NotesWindow } from "./reporting";
import { storeDb } from "./db";

const OPEN_ISSUE = ["OPEN", "IN_REVIEW", "WAITING_ON_TEAM"];

export async function loadNotesStoreReport(input: {
  today: NotesWindow;
  yesterday: NotesWindow;
  mtd: NotesWindow;
  nowMs: number;
}): Promise<NotesStoreReport | null> {
  const db = storeDb();
  if (!db) return null;
  const { data: orderRows, error } = await db
    .from("store_orders")
    .select(
      "id,order_no,status,customer_id,subtotal_paise,discount_paise,shipping_paise,total_paise,amount_paid_paise,amount_refunded_paise,paid_at,shipped_at,delivered_at",
    )
    .order("paid_at", { ascending: false })
    .limit(2000);
  if (error || !orderRows) return null;
  const orders = orderRows as {
    id: string;
    order_no: string;
    status: string;
    customer_id: string | null;
    subtotal_paise: number;
    discount_paise: number;
    shipping_paise: number;
    total_paise: number;
    amount_paid_paise: number;
    amount_refunded_paise: number;
    paid_at: string | null;
    shipped_at: string | null;
    delivered_at: string | null;
  }[];
  const ids = orders.map((order) => order.id);
  if (!ids.length) {
    return buildNotesStoreReport({ orders: [], ...input });
  }

  const [itemsRes, shipsRes, issuesRes] = await Promise.all([
    db.from("store_order_items").select("order_id,name_snapshot,sku_snapshot,qty").in("order_id", ids),
    db.from("store_shipments").select("order_id,provider,status,awb,last_error").in("order_id", ids),
    db.from("store_order_issues").select("order_id,category,status").in("order_id", ids).in("status", OPEN_ISSUE),
  ]);
  if (itemsRes.error || shipsRes.error || issuesRes.error) return null;

  const items = new Map<string, NotesOrderInput["items"]>();
  for (const row of (itemsRes.data || []) as { order_id: string; name_snapshot: string; sku_snapshot: string; qty: number }[]) {
    const list = items.get(row.order_id) || [];
    list.push({ name: row.name_snapshot, sku: row.sku_snapshot, qty: row.qty });
    items.set(row.order_id, list);
  }
  const shipments = new Map<string, NotesOrderInput["shipments"]>();
  for (const row of (shipsRes.data || []) as {
    order_id: string;
    provider: string;
    status: string;
    awb: string | null;
    last_error: string | null;
  }[]) {
    const list = shipments.get(row.order_id) || [];
    list.push({
      provider: row.provider,
      status: row.status,
      hasAwb: !!row.awb,
      lastError: row.last_error,
    });
    shipments.set(row.order_id, list);
  }
  const issues = new Map<string, NotesOrderInput["openIssues"]>();
  for (const row of (issuesRes.data || []) as { order_id: string; category: string }[]) {
    const list = issues.get(row.order_id) || [];
    list.push({ category: row.category });
    issues.set(row.order_id, list);
  }

  const shaped: NotesOrderInput[] = orders.map((order) => ({
    id: order.id,
    orderNo: order.order_no,
    status: order.status,
    customerId: order.customer_id,
    subtotalPaise: order.subtotal_paise,
    discountPaise: order.discount_paise,
    shippingPaise: order.shipping_paise,
    totalPaise: order.total_paise,
    amountPaidPaise: order.amount_paid_paise,
    amountRefundedPaise: order.amount_refunded_paise,
    paidAt: order.paid_at,
    shippedAt: order.shipped_at,
    deliveredAt: order.delivered_at,
    items: items.get(order.id) || [],
    shipments: shipments.get(order.id) || [],
    openIssues: issues.get(order.id) || [],
  }));

  return buildNotesStoreReport({ orders: shaped, ...input });
}
