import { NextResponse } from "next/server";
import { getActionActor, requireFreshPermission } from "@/lib/adminGuard";
import { compareCourierRates } from "@/lib/store/shipping/compare";
import { storeDb } from "@/lib/store/db";
import { resolveBookingPackage } from "@/lib/store/shipping/manualBook";
import type { PackageLine } from "@/lib/store/shipping/autoFulfill";
import {
  QUOTE_SAVE_FAILED,
  bookingFingerprint,
  findSessionByRequestKey,
  loadOptions,
  persistQuoteSession,
  presentedOptions,
  sessionInsert,
  type QuoteOptionRow,
  type QuoteSessionRow,
} from "@/lib/store/shipping/quoteHistory";

export const dynamic = "force-dynamic";

/** Rows as the picker renders them. `key` is the stored option id, so booking can only reference a saved option. */
function sessionPayload(session: QuoteSessionRow, options: QuoteOptionRow[]) {
  return {
    id: session.id,
    created_at: session.created_at,
    expires_at: session.expires_at,
    cheapest_eligible_paise: session.cheapest_eligible_paise,
    options: options.map((o) => ({
      key: o.id,
      option_id: o.id,
      provider: o.provider,
      courier: o.courier_name,
      service: o.service_name || "",
      ratePaise: o.quoted_rate_paise,
      etaDays: o.eta_days,
      etaText: o.eta_text,
      courierId: o.courier_id,
      eligible: o.eligible,
      unavailableReason: o.eligibility_reason,
      lowest: o.is_cheapest_eligible,
      fastest: false,
      bestValue: false,
    })),
  };
}

/**
 * Live courier quotes for one paid order. No label, AWB, or pickup.
 * The exact list shown to staff is saved as a quote session before it is returned.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!(await requireFreshPermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const db = storeDb();
  if (!db) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { request_key?: unknown } | null;
  const requestKey = typeof body?.request_key === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(body.request_key) ? `${params.id}:${body.request_key}` : null;
  const actor = await getActionActor();

  const { data: order } = await db
    .from("store_orders")
    .select("id,total_paise,shipping_address_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (!order.shipping_address_id) {
    return NextResponse.json({ ok: false, error: "This order has no delivery address." }, { status: 400 });
  }
  const { data: address } = await db.from("store_addresses").select("line1,line2,city,state,pincode").eq("id", order.shipping_address_id).maybeSingle();
  const pin = String(address?.pincode || "");
  if (!/^[1-9][0-9]{5}$/.test(pin)) {
    return NextResponse.json({ ok: false, error: "Delivery PIN is missing." }, { status: 400 });
  }

  const { data: shipmentRows } = await db
    .from("store_shipments")
    .select("weight_grams,length_mm,width_mm,height_mm,status,awb,courier_name,provider_payload")
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

  const packagePayload = {
    weight_grams: pack.weightGrams,
    length_cm: pack.lengthCm,
    width_cm: pack.widthCm,
    height_cm: pack.heightCm,
    source: pack.source,
  };
  // Same Compare action replayed (double click / retry): return the saved session, no provider calls.
  const replay = await findSessionByRequestKey(db, order.id, requestKey);
  if (replay) {
    const options = await loadOptions(db, replay.id);
    if (options) {
      return NextResponse.json(
        { ok: options.some((o) => o.eligible), error: options.length ? null : "No courier quote is available for this PIN.", destination_postcode: pin, providers: [], city_confirmation: null, lowest: null, package: packagePayload, quote_session: sessionPayload(replay, options), replayed: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const result = await compareCourierRates({
    deliveryPostcode: pin,
    weightGrams: pack.weightGrams,
    lengthCm: pack.lengthCm,
    widthCm: pack.widthCm,
    heightCm: pack.heightCm,
    declaredValuePaise: Number(order.total_paise) || 0,
  });

  const pending = (shipmentRows || []).find((row) => {
    const payload = row.provider_payload && typeof row.provider_payload === "object" ? row.provider_payload as Record<string, unknown> : null;
    return row.status === "created" && row.awb && payload?.city_confirm_required === true && payload.destination_accepted !== true;
  });
  const pendingPayload = pending?.provider_payload && typeof pending.provider_payload === "object"
    ? pending.provider_payload as Record<string, unknown>
    : null;
  const cityConfirmation = pending && pendingPayload?.provider_city && pendingPayload.requested_city
    ? {
        customer_destination: `${pendingPayload.requested_city}, ${pendingPayload.requested_state || ""} — ${pendingPayload.requested_pin || pin}`,
        courier_destination: `${pendingPayload.provider_city}, ${pendingPayload.provider_state || ""} — ${pendingPayload.provider_pin || pendingPayload.requested_pin || pin}`,
        pin: "MATCH",
        state: "MATCH",
        courier: pending.courier_name || "",
        awb: pending.awb,
        rate_paise: Number(pendingPayload.booked_rate_paise) || Number(pendingPayload.rate_paise) || null,
      }
    : null;

  let quoteSession: ReturnType<typeof sessionPayload> | null = null;
  if (result.pickupPostcode && result.providers.length) {
    const presented = presentedOptions(result.providers);
    const saved = await persistQuoteSession(
      db,
      sessionInsert({
        orderId: order.id,
        requestKey,
        actor,
        pack: { ...pack, source: pack.source },
        destination: { city: address?.city || null, state: address?.state || null, pincode: pin },
        fingerprint: bookingFingerprint(pack, address || {}),
        presented,
        providers: result.providers,
        now: new Date(),
      }),
      presented,
    );
    if (!saved) {
      // Fail closed: rates that were not recorded cannot be booked.
      return NextResponse.json(
        { ok: false, error: QUOTE_SAVE_FAILED, destination_postcode: pin, providers: [], city_confirmation: cityConfirmation, lowest: null, package: packagePayload, quote_session: null },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    quoteSession = sessionPayload(saved.session, saved.options);
  }

  return NextResponse.json(
    {
      ok: result.ok,
      error: result.error,
      destination_postcode: pin,
      pickup_postcode: result.pickupPostcode,
      writes_authorized: result.writesAuthorized,
      providers: result.providers,
      city_confirmation: cityConfirmation,
      lowest: null,
      package: packagePayload,
      quote_session: quoteSession,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
