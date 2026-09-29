import { NextResponse } from "next/server";
import { requireFreshPermission } from "@/lib/adminGuard";
import { compareCourierRates } from "@/lib/store/shipping/compare";
import { storeDb } from "@/lib/store/db";
import { resolveBookingPackage } from "@/lib/store/shipping/manualBook";
import type { PackageLine } from "@/lib/store/shipping/autoFulfill";

export const dynamic = "force-dynamic";

/**
 * Live courier quotes for one paid order. Read-only: no label, AWB, or pickup.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requireFreshPermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });

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

  const { data: shipmentRows } = await db
    .from("store_shipments")
    .select("weight_grams,length_mm,width_mm,height_mm")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false });
  const saved = (shipmentRows || []).find((row) => row.weight_grams && row.length_mm && row.width_mm && row.height_mm) || null;
  const { data: itemRows } = await db.from("store_order_items").select("qty,weight_grams_snapshot,product_id").eq("order_id", order.id);
  const lines: PackageLine[] = [];
  for (const item of itemRows || []) {
    const { data: product } = item.product_id
      ? await db.from("store_products").select("weight_grams,length_mm,width_mm,height_mm").eq("id", item.product_id).maybeSingle()
      : { data: null };
    lines.push({
      qty: Number(item.qty) || 1,
      weightGrams: product?.weight_grams || item.weight_grams_snapshot || null,
      lengthMm: product?.length_mm || null,
      widthMm: product?.width_mm || null,
      heightMm: product?.height_mm || null,
    });
  }
  const pack = resolveBookingPackage({
    override: saved
      ? { weightGrams: saved.weight_grams, lengthMm: saved.length_mm, widthMm: saved.width_mm, heightMm: saved.height_mm }
      : null,
    lines,
  });
  if (!pack.ok) {
    return NextResponse.json({ ok: false, error: "Save the packed weight and dimensions first." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const result = await compareCourierRates({
    deliveryPostcode: pin,
    weightGrams: pack.weightGrams,
    lengthCm: pack.lengthCm,
    widthCm: pack.widthCm,
    heightCm: pack.heightCm,
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
      lowest: null,
      package: {
        weight_grams: pack.weightGrams,
        length_cm: pack.lengthCm,
        width_cm: pack.widthCm,
        height_cm: pack.heightCm,
        source: pack.source,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
