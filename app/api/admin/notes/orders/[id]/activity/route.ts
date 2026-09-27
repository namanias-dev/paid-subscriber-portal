import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { storeDb } from "@/lib/store/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const { data } = await db
    .from("store_order_events")
    .select("id,event,from_status,to_status,actor_type,actor_name,reason,created_at")
    .eq("order_id", params.id)
    .order("created_at", { ascending: false })
    .limit(20);
  return NextResponse.json({ ok: true, events: data || [] }, { headers: { "Cache-Control": "no-store" } });
}
