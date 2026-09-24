import { storeDb } from "../db";
import { storeFeatureEnabled } from "../flags";
import { shipmentAlreadyActive } from "./dispatch";
import { compareCourierRates } from "./compare";
import { createProviderShipment, findShiprocketOrder, requestProviderPickup, cancelProviderShipment } from "./book";
import { shippingWritesAuthorized } from "./config";
import { canAdvanceOrder } from "./status";
import { fulfillCheapest, resolveAutoPackage, type CreatedCandidate, type FulfillCandidate } from "./autoFulfill";
import { getFulfillmentSettings } from "../fulfillmentSettings";

const LOCK_MS = 15 * 60 * 1000;

/** Run cheapest-courier fulfillment for one packed order. No-ops when a live AWB already exists. */
export async function runAutoFulfillment(orderId: string): Promise<{ ok: boolean; blocked: string | null; awb: string | null }> {
  const db = storeDb();
  if (!db) return { ok: false, blocked: "unavailable", awb: null };
  if (!(await storeFeatureEnabled("notes_store_auto_fulfillment"))) {
    return { ok: false, blocked: "AUTO_FULFILLMENT_OFF", awb: null };
  }
  if (!shippingWritesAuthorized()) return { ok: false, blocked: "SHIPPING_WRITES_OFF", awb: null };

  const now = new Date().toISOString();
  const stale = new Date(Date.now() - LOCK_MS).toISOString();
  const { data: locked } = await db
    .from("store_orders")
    .update({ fulfillment_lock_at: now, fulfillment_state: "running", updated_at: now })
    .eq("id", orderId)
    .or(`fulfillment_lock_at.is.null,fulfillment_lock_at.lt.${stale}`)
    .select("id,order_no,status,total_paise,phone,customer_name,shipping_address_id")
    .maybeSingle();
  if (!locked) return { ok: false, blocked: "LOCKED", awb: null };

  const release = async (state: string, note: string | null) => {
    await db.from("store_orders").update({
      fulfillment_lock_at: null,
      fulfillment_state: state,
      fulfillment_note: note,
      updated_at: new Date().toISOString(),
    }).eq("id", orderId);
  };

  try {
    if (locked.status !== "PACKED" && locked.status !== "READY_FOR_PICKUP") {
      await release("waiting", null);
      return { ok: false, blocked: "NOT_PACKED", awb: null };
    }
    const { data: ships } = await db.from("store_shipments").select("id,status,awb,weight_grams,length_mm,width_mm,height_mm").eq("order_id", orderId);
    if ((ships || []).some((row) => shipmentAlreadyActive(row.status, row.awb))) {
      await release("ready", null);
      return { ok: true, blocked: null, awb: (ships || []).find((row) => row.awb)?.awb || null };
    }
    const packed = (ships || []).find((row) => row.weight_grams && row.length_mm && row.width_mm && row.height_mm);
    let pack = packed
      ? { weightGrams: Number(packed.weight_grams), lengthCm: Number(packed.length_mm) / 10, widthCm: Number(packed.width_mm) / 10, heightCm: Number(packed.height_mm) / 10 }
      : null;
    if (!pack) {
      const { data: items } = await db.from("store_order_items").select("qty,weight_grams_snapshot,product_id").eq("order_id", orderId);
      const lines = [];
      for (const item of items || []) {
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
      const resolved = resolveAutoPackage(lines);
      if (!resolved.ok) {
        await db.from("store_order_events").insert({ order_id: orderId, event: "AUTO_FULFILLMENT_BLOCKED", actor_type: "system", payload_json: { reason: resolved.reason } });
        await release("blocked", resolved.reason);
        return { ok: false, blocked: resolved.reason, awb: null };
      }
      pack = resolved;
    }
    const { data: address } = await db.from("store_addresses").select("name,phone,line1,line2,city,state,pincode").eq("id", locked.shipping_address_id).maybeSingle();
    if (!address?.pincode || !address.line1 || !address.city || !address.state) {
      await release("blocked", "ADDRESS_INCOMPLETE");
      return { ok: false, blocked: "ADDRESS_INCOMPLETE", awb: null };
    }
    const rates = await compareCourierRates({
      deliveryPostcode: address.pincode,
      weightGrams: pack.weightGrams,
      lengthCm: pack.lengthCm,
      widthCm: pack.widthCm,
      heightCm: pack.heightCm,
      declaredValuePaise: Number(locked.total_paise) || 0,
    });
    await db.from("store_order_events").insert({
      order_id: orderId,
      event: "RATES_FETCHED",
      actor_type: "system",
      payload_json: { count: rates.providers.reduce((n, p) => n + p.quotes.length, 0) },
    });
    const settings = await getFulfillmentSettings();
    const quotes = rates.providers
      .filter((provider) => (provider.provider === "shiprocket" ? settings.shiprocket : settings.delhivery))
      .flatMap((p) => p.quotes);
    const { data: items } = await db.from("store_order_items").select("name_snapshot").eq("order_id", orderId).limit(4);
    const product = (items || []).map((it) => it.name_snapshot).filter(Boolean).join(", ").slice(0, 120) || "Printed notes";
    const attemptNo = { n: (ships || []).length };
    const result = await fulfillCheapest({
      quotes,
      excluded: settings.excluded,
      maxAttempts: settings.maxAttempts,
      canonical: { city: address.city, state: address.state, pincode: address.pincode },
      create: (candidate) => createMapped(locked, address, pack!, product, candidate, ++attemptNo.n),
      reconcile: async (candidate) => {
        if (candidate.provider !== "shiprocket") return null;
        const found = await findShiprocketOrder(`${locked.order_no}-S${attemptNo.n}`);
        if (!found?.shipmentId && !found?.awb) return null;
        return {
          provider: "shiprocket" as const,
          providerOrderId: found.orderId,
          providerShipmentId: found.shipmentId,
          awb: found.awb,
          courierName: candidate.courier,
          labelUrl: null,
          pin: found.pin,
          city: found.city,
          state: found.state,
          phoneStored: found.phoneStored,
          possessed: false,
          unverified: !found.pin,
        };
      },
      cancel: async (created) => {
        try {
          await cancelProviderShipment({ provider: created.provider, providerOrderId: created.providerOrderId, awb: created.awb });
          await db.from("store_shipments").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("awb", created.awb || "");
          await db.from("store_order_events").insert({ order_id: orderId, event: "CANDIDATE_CANCELLED", actor_type: "system", payload_json: { provider: created.provider } });
          return true;
        } catch {
          return false;
        }
      },
    });
    if (!result.accepted) {
      await db.from("store_order_events").insert({ order_id: orderId, event: "AUTO_FULFILLMENT_BLOCKED", actor_type: "system", payload_json: { reason: result.blocked } });
      await release("blocked", result.blocked);
      return { ok: false, blocked: result.blocked, awb: null };
    }
    let pickupError: string | null = null;
    try {
      const date = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const pickup = await requestProviderPickup({
        provider: result.accepted.provider,
        providerShipmentId: result.accepted.providerShipmentId,
        date,
      });
      const { data: active } = await db.from("store_shipments").select("id,provider_payload").eq("awb", result.accepted.awb).maybeSingle();
      const payload = active?.provider_payload && typeof active.provider_payload === "object" ? active.provider_payload : {};
      if (active?.id) {
        await db.from("store_shipments").update({
          pickup_scheduled_at: `${date}T00:00:00.000Z`,
          provider_payload: {
            ...payload,
            pickup_reference: pickup.reference,
            pickup_date: date,
            pickup_status: pickup.status || "requested",
            label_url: result.accepted.labelUrl,
          },
          updated_at: new Date().toISOString(),
        }).eq("id", active.id);
      }
      await db.from("store_order_events").insert({ order_id: orderId, event: "PICKUP_REQUESTED", actor_type: "system", payload_json: { reference: pickup.reference ? "yes" : "no" } });
    } catch (error) {
      pickupError = error instanceof Error ? error.message.slice(0, 160) : "Pickup was not scheduled.";
    }
    const nextStatus = canAdvanceOrder(locked.status, "PICKUP_SCHEDULED") && !pickupError ? "PICKUP_SCHEDULED" : locked.status;
    await db.from("store_orders").update({
      status: nextStatus,
      fulfillment_lock_at: null,
      fulfillment_state: pickupError ? "pickup_pending" : "ready",
      fulfillment_note: pickupError,
      updated_at: new Date().toISOString(),
    }).eq("id", orderId);
    return { ok: true, blocked: pickupError, awb: result.accepted.awb };
  } catch (error) {
    await release("blocked", error instanceof Error ? error.message.slice(0, 160) : "AUTO_FULFILLMENT_BLOCKED");
    return { ok: false, blocked: "AUTO_FULFILLMENT_BLOCKED", awb: null };
  }
}

async function createMapped(
  order: { id: string; order_no: string; total_paise: number },
  address: { name?: string | null; phone?: string | null; line1: string; line2?: string | null; city: string; state: string; pincode: string },
  pack: { weightGrams: number; lengthCm: number; widthCm: number; heightCm: number },
  product: string,
  candidate: FulfillCandidate,
  attempt: number,
): Promise<CreatedCandidate> {
  const db = storeDb();
  const created = await createProviderShipment({
    provider: candidate.provider,
    courierId: candidate.courierId,
    orderNumber: `${order.order_no}-S${attempt}`,
    name: address.name || "Customer",
    address: [address.line1, address.line2].filter(Boolean).join(", "),
    pin: address.pincode,
    city: address.city,
    state: address.state,
    phone: address.phone || "",
    product,
    amountRupees: Math.round(Number(order.total_paise) || 0) / 100,
    weightGrams: pack.weightGrams,
    lengthCm: pack.lengthCm,
    widthCm: pack.widthCm,
    heightCm: pack.heightCm,
    shippingMode: /express/i.test(candidate.service) ? "Express" : "Surface",
  });
  if (db) {
    await db.from("store_shipments").insert({
      order_id: order.id,
      provider: created.provider,
      provider_shipment_id: created.providerShipmentId,
      courier_name: created.courierName || candidate.courier,
      awb: created.awb,
      status: created.addressMismatch ? "failed" : created.awb ? "created" : "pending",
      weight_grams: pack.weightGrams,
      length_mm: Math.round(pack.lengthCm * 10),
      width_mm: Math.round(pack.widthCm * 10),
      height_mm: Math.round(pack.heightCm * 10),
      provider_payload: {
        attempt,
        rate_paise: candidate.ratePaise,
        label_url: created.labelUrl,
        provider_order_id: created.providerOrderId,
        requested_pin: address.pincode,
        requested_city: address.city,
        requested_state: address.state,
        provider_pin: created.storedPin || null,
        provider_city: created.storedCity || null,
        provider_state: created.storedState || null,
        phone_stored: created.phoneStored === true,
        address_mismatch: created.addressMismatch === true,
        address_unverified: created.addressUnverified === true,
        do_not_handoff: created.addressMismatch === true || created.addressUnverified === true || created.phoneStored === false,
      },
    });
    await db.from("store_order_events").insert({
      order_id: order.id,
      event: created.addressMismatch ? "ADDRESS_CHECK_FAILED" : "SHIPMENT_CREATED",
      actor_type: "system",
      payload_json: { provider: created.provider, attempt, awb_assigned: Boolean(created.awb) },
    });
  }
  return {
    provider: created.provider,
    providerOrderId: created.providerOrderId,
    providerShipmentId: created.providerShipmentId,
    awb: created.awb,
    courierName: created.courierName,
    labelUrl: created.labelUrl,
    pin: created.storedPin || null,
    city: created.storedCity || null,
    state: created.storedState || null,
    phoneStored: created.phoneStored ?? null,
    possessed: false,
    unverified: created.addressUnverified === true || created.phoneStored == null,
  };
}
