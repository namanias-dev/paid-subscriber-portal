import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { dispatchBlocked } from "@/lib/store/shipping/dispatch";

export const dynamic = "force-dynamic";

/**
 * Book a courier shipment. Refuses unless billable writes are authorized.
 * Does not mark the order shipped.
 */
export async function POST() {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const blocked = dispatchBlocked();
  if (blocked) {
    return NextResponse.json({ ok: false, error: blocked, writes_authorized: false }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(
    {
      ok: false,
      error: "Billable shipment creation is not connected. The write gate is on, but no courier create call is enabled in this deploy.",
      writes_authorized: true,
    },
    { status: 409, headers: { "Cache-Control": "no-store" } },
  );
}
