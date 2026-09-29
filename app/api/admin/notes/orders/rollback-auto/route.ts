import { NextResponse } from "next/server";
import { storeDb } from "@/lib/store/db";
import { shippingWritesAuthorized } from "@/lib/store/shipping/config";
import { cancelProviderShipment } from "@/lib/store/shipping/book";
import { shiprocketToken } from "@/lib/store/shipping/shiprocketApi";
import { shiprocketBaseUrl } from "@/lib/store/shipping/config";
import { trackShiprocketAwb } from "@/lib/store/shipping/shiprocketApi";
import { cancellationConfirmed, rollbackDecision, ROLLBACK_AWB, ROLLBACK_ORDER_NO } from "@/lib/store/shipping/rollbackAuto";

export const dynamic = "force-dynamic";

/**
 * Temporary production rollback for one auto-booked, pre-possession shipment.
 * Removed after that order is verified. It does not book a replacement.
 */
export async function POST(req: Request) {
  const confirm = process.env.NOTES_STORE_SHIPPING_WRITE_CONFIRM || "";
  const header = req.headers.get("x-notes-rollback") || "";
  if (!shippingWritesAuthorized() || !confirm || header !== confirm) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const probe = new URL(req.url).searchParams.get("probe") === "1";
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  const { data: order } = await db
    .from("store_orders")
    .select("id,order_no,status,fulfillment_state")
    .eq("order_no", ROLLBACK_ORDER_NO)
    .maybeSingle();
  if (!order) return NextResponse.json({ ok: false, result: "NOT_FOUND" }, { status: 404 });

  const { data: shipments } = await db
    .from("store_shipments")
    .select("id,status,awb,provider,picked_up_at,provider_shipment_id,provider_payload,weight_grams,length_mm,width_mm,height_mm")
    .eq("order_id", order.id)
    .eq("awb", ROLLBACK_AWB);
  const shipment = (shipments || []).find((row) => row.status !== "cancelled" && row.status !== "failed") || null;
  const payload = (shipment?.provider_payload && typeof shipment.provider_payload === "object" ? shipment.provider_payload : {}) as {
    provider_order_id?: string;
  };
  const providerOrderId = String(payload.provider_order_id || "");

  const tracked = await trackShiprocketAwb(ROLLBACK_AWB);
  const decision = rollbackDecision({
    orderNo: order.order_no,
    orderStatus: order.status,
    awb: shipment?.awb || null,
    shipStatus: shipment?.status || null,
    pickedUpAt: shipment?.picked_up_at || null,
    trackingStatus: tracked.rawStatus,
    trackingError: tracked.error,
    activities: tracked.activities.map((row) => row.activity),
  });

  if (probe || decision.action !== "cancel") {
    return NextResponse.json({
      ok: decision.action === "cancel",
      probe,
      result: decision.action === "cancel" ? "SAFE_TO_CANCEL" : decision.reason,
      tracking_status: tracked.rawStatus,
      tracking_activity: tracked.activity,
      local_status: order.status,
      ship_status: shipment?.status || null,
      possessed: Boolean(shipment?.picked_up_at),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  if (!providerOrderId) {
    return NextResponse.json({ ok: false, result: "PROVIDER_ID_MISSING" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  try {
    await cancelProviderShipment({ provider: "shiprocket", providerOrderId, awb: ROLLBACK_AWB });
  } catch {
    return NextResponse.json({ ok: false, result: "CANCEL_FAILED" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }

  const confirmed = await providerCancelled(providerOrderId);
  if (!confirmed.ok) {
    return NextResponse.json({
      ok: false,
      result: "CANCEL_UNCONFIRMED",
      provider_status: confirmed.status,
    }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  const now = new Date().toISOString();
  const nextPayload = {
    ...(payload as Record<string, unknown>),
    do_not_use: true,
    cancellation_reason: "CANCELLED / DO NOT USE",
  };
  const { error: shipError } = await db
    .from("store_shipments")
    .update({ status: "cancelled", provider_payload: nextPayload, updated_at: now })
    .eq("id", shipment!.id)
    .eq("awb", ROLLBACK_AWB)
    .is("picked_up_at", null);
  if (shipError) {
    return NextResponse.json({ ok: false, result: "LOCAL_SHIPMENT_UPDATE_FAILED", provider_status: confirmed.status }, { status: 500 });
  }

  const { data: updated } = await db
    .from("store_orders")
    .update({
      status: "PACKED",
      fulfillment_state: null,
      fulfillment_lock_at: null,
      fulfillment_note: null,
      updated_at: now,
    })
    .eq("id", order.id)
    .eq("status", "PICKUP_SCHEDULED")
    .select("id,status");
  await db.from("store_order_events").insert({
    order_id: order.id,
    event: "AUTO_SHIPMENT_CANCELLED",
    from_status: "PICKUP_SCHEDULED",
    to_status: updated?.length ? "PACKED" : order.status,
    actor_type: "system",
    payload_json: { awb: ROLLBACK_AWB, provider: "shiprocket", result: "confirmed", label: "CANCELLED / DO NOT USE" },
  });

  return NextResponse.json({
    ok: Boolean(updated?.length),
    result: updated?.length ? "PACKED" : "PROVIDER_CANCELLED_ORDER_NOT_MOVED",
    provider_status: confirmed.status,
    order_status: updated?.[0]?.status || order.status,
  }, { headers: { "Cache-Control": "no-store" } });
}

async function providerCancelled(orderId: string): Promise<{ ok: boolean; status: string | null }> {
  const token = await shiprocketToken();
  for (const waitMs of [2000, 4000, 8000]) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    const res = await fetch(`${shiprocketBaseUrl()}/orders/show/${encodeURIComponent(orderId)}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json().catch(() => null);
    const data = body && typeof body === "object" && "data" in body && body.data && typeof body.data === "object" ? body.data as Record<string, unknown> : (body as Record<string, unknown> | null);
    const shipments = Array.isArray(data?.shipments) ? data.shipments : [];
    const ship = shipments[0] && typeof shipments[0] === "object" ? shipments[0] as Record<string, unknown> : null;
    const status = String(data?.status || ship?.status || "");
    const statusCode = String(data?.status_code ?? ship?.status_code ?? "");
    if (res.ok && (cancellationConfirmed(status) || statusCode === "5")) return { ok: true, status: status || `code ${statusCode}` };
    if (waitMs === 8000) return { ok: false, status: status || null };
  }
  return { ok: false, status: null };
}
