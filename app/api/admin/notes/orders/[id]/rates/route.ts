import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { compareCourierRates } from "@/lib/store/shipping/compare";
import { storeDb } from "@/lib/store/db";

export const dynamic = "force-dynamic";

/**
 * Live courier quotes for one paid order. Read-only: no label, AWB, or pickup.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as {
    weight_grams?: number;
    length_cm?: number;
    width_cm?: number;
    height_cm?: number;
  } | null;
  const weight = Number(body?.weight_grams);
  const length = Number(body?.length_cm);
  const width = Number(body?.width_cm);
  const height = Number(body?.height_cm);

  const { data: order } = await db
    .from("store_orders")
    .select("id,total_paise,shipping_address_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (!order.shipping_address_id) {
    return NextResponse.json({ ok: false, error: "This order has no delivery address." }, { status: 400 });
  }
  const { data: address } = await db.from("store_addresses").select("pincode").eq("id", order.shipping_address_id).maybeSingle();
  const pin = String(address?.pincode || "");
  if (!/^[1-9][0-9]{5}$/.test(pin)) {
    return NextResponse.json({ ok: false, error: "Delivery PIN is missing." }, { status: 400 });
  }

  const result = await compareCourierRates({
    deliveryPostcode: pin,
    weightGrams: weight,
    lengthCm: length,
    widthCm: width,
    heightCm: height,
    declaredValuePaise: Number(order.total_paise) || 0,
  });

  return NextResponse.json(
    {
      ok: result.ok,
      error: result.error,
      destination_postcode: pin,
      pickup_postcode: result.pickupPostcode,
      writes_authorized: result.writesAuthorized,
      providers: result.providers,
      lowest: result.lowest,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
