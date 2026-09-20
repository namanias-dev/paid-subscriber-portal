import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";

export const dynamic = "force-dynamic";

const EXCEPTION_TYPES = new Set([
  "damaged",
  "wrong_item",
  "missing_item",
  "lost_in_transit",
  "duplicate_order",
]);

/**
 * Append an internal note and/or record a fulfilment exception on an order.
 * No general returns exist, but operations must still be able to log legitimate
 * problems and their resolution without touching the database by hand (spec §24).
 * Purely additive: writes to internal_notes + store_order_events, no status jump.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const actor = await getActionActor();
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const note = String(body?.note || "").trim();
  const exceptionType = body?.exception_type ? String(body.exception_type) : null;
  const resolution = String(body?.resolution || "").trim() || null;
  if (!note && !exceptionType) {
    return NextResponse.json({ ok: false, error: "Enter a note or an exception" }, { status: 400 });
  }
  if (exceptionType && !EXCEPTION_TYPES.has(exceptionType)) {
    return NextResponse.json({ ok: false, error: "Unknown exception type" }, { status: 400 });
  }

  const { data: order } = await db.from("store_orders").select("id,status,internal_notes").eq("id", params.id).maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const now = new Date().toISOString();
  const stamp = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const author = actor?.name || "admin";
  const lines: string[] = [];
  if (exceptionType) lines.push(`[${exceptionType}${resolution ? ` → ${resolution}` : ""}]`);
  if (note) lines.push(note);
  const entry = `${stamp} · ${author}: ${lines.join(" ")}`;
  const nextNotes = [order.internal_notes, entry].filter(Boolean).join("\n");

  const { error } = await db
    .from("store_orders")
    .update({ internal_notes: nextNotes, updated_at: now })
    .eq("id", order.id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  await db.from("store_order_events").insert({
    order_id: order.id,
    event: exceptionType ? "exception_recorded" : "note_added",
    from_status: order.status,
    to_status: order.status,
    actor_type: "admin",
    actor_id: actor?.id,
    actor_name: actor?.name,
    payload_json: exceptionType ? { exception_type: exceptionType, resolution, note: note || null } : { note },
  });

  return NextResponse.json({ ok: true, internal_notes: nextNotes }, { headers: { "Cache-Control": "no-store" } });
}
