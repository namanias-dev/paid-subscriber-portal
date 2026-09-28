import { NextResponse } from "next/server";
import { verifyRawTokenAgainstHash } from "@/lib/store/accessToken";
import { storeDb } from "@/lib/store/db";
import { canRequestSupport, supportReasonAllowed } from "@/lib/store/shipping/dispatch";

export const dynamic = "force-dynamic";

/**
 * Customer report for a delivered or failed order.
 * Requires the order access token. Does not book a return shipment.
 */
export async function POST(req: Request, { params }: { params: { orderNumber: string } }) {
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { t?: string; reason?: string; description?: string } | null;
  const token = String(body?.t || "").trim();
  const reason = String(body?.reason || "").trim();
  const description = String(body?.description || "").trim();
  if (!supportReasonAllowed(reason)) return NextResponse.json({ ok: false, error: "Choose a reason." }, { status: 400 });
  if (description.length < 8) return NextResponse.json({ ok: false, error: "Describe the issue in a sentence." }, { status: 400 });

  const orderNo = decodeURIComponent(params.orderNumber || "").trim().toUpperCase();
  const { data: order } = await db
    .from("store_orders")
    .select("id,status,tracking_token_hash,internal_notes")
    .eq("order_no", orderNo)
    .maybeSingle();
  if (!order || !verifyRawTokenAgainstHash(token, order.tracking_token_hash)) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  if (!canRequestSupport(order.status)) {
    return NextResponse.json({ ok: false, error: "This order is not open for a report." }, { status: 409 });
  }
  if (order.status === "RETURN_REQUESTED") {
    return NextResponse.json({ ok: false, error: "A report is already open." }, { status: 409 });
  }

  const now = new Date().toISOString();
  const stamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const entry = `${stamp} · customer: [${reason}] ${description}`;
  const nextNotes = [order.internal_notes, entry].filter(Boolean).join("\n");
  await db.from("store_orders").update({ status: "RETURN_REQUESTED", internal_notes: nextNotes, updated_at: now }).eq("id", order.id);
  await db.from("store_order_events").insert({
    order_id: order.id,
    event: "support_requested",
    from_status: order.status,
    to_status: "RETURN_REQUESTED",
    actor_type: "customer",
    payload_json: { reason },
  });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
