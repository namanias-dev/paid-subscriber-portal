/**
 * Server guard: courier work is for DELIVERY orders only.
 *
 * Every route that can quote, book, label, request a courier pickup, track, or change a
 * delivery address calls `deliveryOnlyGuard` before any provider or shipment write. The
 * database refuses courier rows for pickup orders as a backstop
 * (supabase/migrations/2026-10-05-notes-store-academy-pickup.sql).
 *
 * Fails closed: if the order's method cannot be read, courier work is refused.
 */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAcademyPickup } from "./fulfillment";

export const PICKUP_COURIER_REFUSAL = "This is an Academy Pickup order. Courier shipping is not used.";

/** PII-free structured log line for fulfilment failures. */
export function logFulfillment(event: string, detail: Record<string, string | number | boolean | null | undefined>): void {
  try {
    console.info(`[store/fulfillment] ${event} ${JSON.stringify(detail)}`);
  } catch {
    /* logging must never break a request */
  }
}

export async function deliveryOnlyGuard(db: SupabaseClient | null, orderId: string | null | undefined, route: string): Promise<NextResponse | null> {
  if (!db || !orderId) return null; // the route's own not-found / unavailable handling applies
  const { data, error } = await db.from("store_orders").select("id,fulfillment_method").eq("id", orderId).maybeSingle();
  if (error) {
    logFulfillment("guard_read_failed", { route, order_id: orderId });
    return NextResponse.json({ ok: false, error: "Order details are unavailable. Try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (data && isAcademyPickup(data)) {
    logFulfillment("courier_refused_for_pickup", { route, order_id: orderId, fulfillment_method: "ACADEMY_PICKUP" });
    return NextResponse.json({ ok: false, error: PICKUP_COURIER_REFUSAL, code: "ACADEMY_PICKUP" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  return null;
}
