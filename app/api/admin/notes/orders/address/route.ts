import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import { requirePermission } from "@/lib/adminGuard";
import { applyDeliveryAddressChange } from "@/lib/store/deliveryAddressApply";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const session = await getAdminSession();
  const body = await req.json().catch(() => ({}));
  const orderId = typeof body.order_id === "string" ? body.order_id : "";
  if (!orderId) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 400 });
  const result = await applyDeliveryAddressChange({
    orderId,
    name: typeof body.name === "string" ? body.name : "",
    line1: typeof body.line1 === "string" ? body.line1 : "",
    line2: typeof body.line2 === "string" ? body.line2 : "",
    landmark: typeof body.landmark === "string" ? body.landmark : "",
    city: typeof body.city === "string" ? body.city : "",
    state: typeof body.state === "string" ? body.state : "",
    pincode: typeof body.pincode === "string" ? body.pincode : "",
    reason: typeof body.reason === "string" ? body.reason : "",
    customerConfirmed: body.customer_confirmed === true,
    confirmRebook: body.confirm_rebook === true,
    recordRequest: body.record_request === true,
    expectedHash: typeof body.expected_hash === "string" ? body.expected_hash : null,
    actor: session?.username || "staff",
  });
  return NextResponse.json({ ok: result.ok, code: result.code, message: result.message }, {
    status: result.ok ? 200 : 400,
    headers: { "Cache-Control": "no-store" },
  });
}
