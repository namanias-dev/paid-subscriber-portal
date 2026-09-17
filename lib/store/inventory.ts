import { storeDb } from "./db";

export interface ReserveItem {
  product_id: string;
  qty: number;
}

export async function reserveStock(items: ReserveItem[], opts: { cartId?: string; orderId?: string; ttlSeconds?: number }) {
  const db = storeDb();
  if (!db) throw new Error("store unavailable");
  const { data, error } = await db.rpc("store_reserve_stock", {
    p_items: items,
    p_cart_id: opts.cartId ?? null,
    p_order_id: opts.orderId ?? null,
    p_ttl_seconds: opts.ttlSeconds ?? 900,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; reservation_ids?: string[]; shortfalls?: Array<{ name: string; available: number; reason: string }> };
}

export async function releaseReservations(opts: { orderId?: string; cartId?: string }) {
  const db = storeDb();
  if (!db) return 0;
  const { data } = await db.rpc("store_release_reservations", {
    p_order_id: opts.orderId ?? null,
    p_cart_id: opts.cartId ?? null,
  });
  return Number(data || 0);
}

export async function commitReservations(orderId: string) {
  const db = storeDb();
  if (!db) return 0;
  const { data } = await db.rpc("store_commit_reservations", { p_order_id: orderId });
  return Number(data || 0);
}
