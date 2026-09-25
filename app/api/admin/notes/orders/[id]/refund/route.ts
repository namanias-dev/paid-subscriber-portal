import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";
import { refundRequestPaise } from "@/lib/store/shipping/dispatch";

export const dynamic = "force-dynamic";

/**
 * Record a refund request. The store Eazypay client can initiate and verify a
 * payment. It has no refund call, so this route does not contact ICICI.
 * A second request for an order already waiting on a refund is a no-op.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as {
    amount_paise?: number;
    reason?: string;
    confirm?: string;
    reference?: string;
  } | null;
  if (body?.confirm !== "REQUEST_REFUND" && body?.confirm !== "RECORD_MANUAL_REFUND") {
    return NextResponse.json({ ok: false, error: "Refund was not confirmed." }, { status: 400 });
  }

  const { data: order } = await db
    .from("store_orders")
    .select("id,status,total_paise,amount_refunded_paise")
    .eq("id", params.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  if (body.confirm === "RECORD_MANUAL_REFUND") {
    if (order.status === "REFUNDED" || order.status === "PARTIALLY_REFUNDED") {
      return NextResponse.json(
        { ok: true, status: order.status, gateway: "manual", duplicate: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (order.status !== "REFUND_PENDING") {
      return NextResponse.json({ ok: false, error: "Record a refund request before the gateway reference." }, { status: 409 });
    }
    const reference = String(body.reference || "").trim();
    if (reference.length < 4) return NextResponse.json({ ok: false, error: "Enter the gateway reference." }, { status: 400 });
    const decision = refundRequestPaise(
      Number(order.total_paise) || 0,
      Number(order.amount_refunded_paise) || 0,
      Number(body.amount_paise),
    );
    if ("error" in decision) return NextResponse.json({ ok: false, error: decision.error }, { status: 400 });
    const nextStatus = decision.amount >= Number(order.total_paise) ? "REFUNDED" : "PARTIALLY_REFUNDED";
    const now = new Date().toISOString();
    await db
      .from("store_orders")
      .update({
        status: nextStatus,
        amount_refunded_paise: Number(order.amount_refunded_paise || 0) + decision.amount,
        updated_at: now,
      })
      .eq("id", order.id);
    await db.from("store_invoices").update({ credit_note_status: "PENDING_REVIEW", updated_at: now }).eq("order_id", order.id);
    await db.from("store_order_events").insert({
      order_id: order.id,
      event: "refund_recorded",
      from_status: order.status,
      to_status: nextStatus,
      actor_type: "admin",
      actor_id: actor?.id,
      actor_name: actor?.name,
      payload_json: { amount_paise: decision.amount, reference: reference.slice(0, 80), gateway: "manual" },
    });
    return NextResponse.json(
      { ok: true, status: nextStatus, gateway: "manual" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const reason = String(body.reason || "").trim();
  if (reason.length < 3) return NextResponse.json({ ok: false, error: "Enter a reason." }, { status: 400 });
  if (order.status === "REFUND_PENDING") {
    return NextResponse.json(
      { ok: true, status: "REFUND_PENDING", gateway: "not_called", duplicate: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const decision = refundRequestPaise(Number(order.total_paise) || 0, Number(order.amount_refunded_paise) || 0, Number(body.amount_paise));
  if ("error" in decision) return NextResponse.json({ ok: false, error: decision.error }, { status: 400 });
  const refundable = new Set(["DELIVERED", "DELIVERY_FAILED", "RETURN_APPROVED", "RETURN_RECEIVED", "RTO_DELIVERED"]);
  if (!refundable.has(order.status)) {
    return NextResponse.json({ ok: false, error: `Cannot request a refund from ${order.status}.` }, { status: 409 });
  }

  const now = new Date().toISOString();
  await db.from("store_orders").update({ status: "REFUND_PENDING", updated_at: now }).eq("id", order.id);
  await db.from("store_invoices").update({ credit_note_status: "PENDING_REVIEW", updated_at: now }).eq("order_id", order.id);
  await db.from("store_order_events").insert({
    order_id: order.id,
    event: "refund_requested",
    from_status: order.status,
    to_status: "REFUND_PENDING",
    actor_type: "admin",
    actor_id: actor?.id,
    actor_name: actor?.name,
    payload_json: { amount_paise: decision.amount, reason, gateway: "not_called" },
  });
  return NextResponse.json(
    { ok: true, status: "REFUND_PENDING", gateway: "not_called" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
