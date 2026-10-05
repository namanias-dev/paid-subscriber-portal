/**
 * Staff delivery-address change. Courier calls happen only after a confirmed
 * rebook, and only after the previous shipment is cancelled.
 */
import { storeDb } from "./db";
import { pinPlaceConflict } from "./address";
import { checkPincode } from "./serviceability";
import {
  addressFingerprint,
  canonicalDelivery,
  decideAddressChange,
  materialAddressChange,
  type DeliveryFields,
} from "./deliveryAddress";
import { executeAddressCorrection, type CancelOutcome } from "./deliveryAddressChange";
import { isAcademyPickup } from "./fulfillment";

const REASONS = new Set(["customer_requested", "typing_error", "courier_correction", "internal", "other"]);
const LOCK_MS = 15 * 60 * 1000;

export interface AddressChangeInput {
  orderId: string;
  name: string;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  state: string;
  pincode: string;
  reason: string;
  customerConfirmed: boolean;
  confirmRebook: boolean;
  recordRequest: boolean;
  expectedHash: string | null;
  actor: string;
}

export async function applyDeliveryAddressChange(input: AddressChangeInput): Promise<{ ok: boolean; code: string; message: string }> {
  if (!REASONS.has(input.reason)) return { ok: false, code: "REASON", message: "Choose a reason for the address change." };
  const next = canonicalDelivery({
    line1: input.line1,
    line2: input.line2,
    landmark: input.landmark,
    city: input.city,
    state: input.state,
    pincode: input.pincode,
  });
  if (next.line1.length < 3 || !/^[1-9][0-9]{5}$/.test(next.pincode) || !next.city || !next.state) {
    return { ok: false, code: "INVALID", message: "Enter the street, a 6-digit PIN, city, and state." };
  }
  const db = storeDb();
  if (!db) return { ok: false, code: "UNAVAILABLE", message: "The store database is unavailable." };
  const pin = await checkPincode(next.pincode, 2);
  if ("error" in pin) return { ok: false, code: "PIN", message: pin.error };
  if (!pin.serviceable) return { ok: false, code: "PIN", message: "We don't currently deliver to this PIN code." };
  const conflict = pinPlaceConflict(next.city, next.state, pin.city, pin.state);
  if (conflict) return { ok: false, code: "PIN_CONFLICT", message: conflict };

  const { data: order } = await db
    .from("store_orders")
    .select("id,status,phone,customer_name,shipping_address_id,fulfillment_lock_at,fulfillment_method")
    .eq("id", input.orderId)
    .maybeSingle();
  if (!order) return { ok: false, code: "NOT_FOUND", message: "Order not found." };
  if (isAcademyPickup(order)) return { ok: false, code: "ACADEMY_PICKUP", message: "This is an Academy Pickup order. It has no delivery address." };
  const { data: current } = order.shipping_address_id
    ? await db.from("store_addresses").select("id,name,line1,line2,landmark,city,state,pincode,address_hash").eq("id", order.shipping_address_id).maybeSingle()
    : { data: null };
  const currentFields: DeliveryFields = {
    line1: current?.line1 || "",
    line2: current?.line2,
    landmark: current?.landmark,
    city: current?.city || "",
    state: current?.state || "",
    pincode: current?.pincode || "",
  };
  const currentHash = current?.address_hash || addressFingerprint(currentFields);
  if (input.expectedHash && input.expectedHash !== currentHash) {
    return { ok: false, code: "STALE", message: "This address was updated in another tab. Reload the order and try again." };
  }

  const { data: ships } = await db
    .from("store_shipments")
    .select("id,provider,status,awb,provider_shipment_id,provider_payload,picked_up_at")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false });
  const active = (ships || []).find((row) => row.status !== "cancelled" && row.status !== "failed" && row.awb) || null;
  const lockAt = order.fulfillment_lock_at ? Date.parse(order.fulfillment_lock_at) : NaN;
  const decision = decideAddressChange({
    orderStatus: order.status,
    lockFresh: Number.isFinite(lockAt) && Date.now() - lockAt < LOCK_MS,
    shipmentStatus: active?.status || null,
    awb: active?.awb || null,
    possessed: Boolean(active?.picked_up_at),
  });
  const material = materialAddressChange(currentFields, next);
  const status = input.customerConfirmed ? "ADMIN_UPDATED_CUSTOMER_CONFIRMED" : "ADMIN_CONFIRMED";

  const updateAddress = async () => {
    const now = new Date().toISOString();
    const { data: created, error } = await db.from("store_addresses").insert({
      kind: "shipping",
      name: input.name.trim() || order.customer_name,
      phone: order.phone,
      line1: next.line1,
      line2: next.line2,
      landmark: next.landmark,
      city: next.city,
      state: next.state,
      pincode: next.pincode,
      raw_line1: input.line1,
      raw_line2: input.line2 || null,
      raw_city: input.city,
      raw_state: input.state,
      confirmation_status: status,
      confirmed_at: now,
      confirmed_by: input.actor,
      verification_method: "pin_and_staff",
      address_hash: addressFingerprint(next),
    }).select("id").single();
    if (error || !created) throw new Error(error?.message || "could not save address");
    await db.from("store_orders").update({
      shipping_address_id: created.id,
      customer_name: input.name.trim() || order.customer_name,
      updated_at: now,
    }).eq("id", order.id);
    if (active) {
      await db.from("store_shipments").update({ status: "cancelled", updated_at: now }).eq("id", active.id);
    }
    await db.from("store_order_address_versions").insert({
      order_id: order.id,
      previous_address: currentFields,
      next_address: next,
      reason: input.reason,
      customer_confirmed: input.customerConfirmed,
      confirmation_status: status,
      shipment_status: active?.status || null,
      previous_awb: active?.awb || null,
      changed_by: input.actor,
    });
    await db.from("store_order_events").insert({
      order_id: order.id,
      event: active ? "address_rebooked" : "address_updated",
      actor_type: "staff",
      payload_json: { reason: input.reason, customer_confirmed: input.customerConfirmed, material },
    });
  };

  const result = await executeAddressCorrection({
    decision,
    confirmRebook: input.confirmRebook,
    recordRequest: input.recordRequest,
  }, {
    updateAddress,
    recordRequest: async () => {
      await db.from("store_order_events").insert({
        order_id: order.id,
        event: "address_change_requested",
        actor_type: "staff",
        payload_json: { reason: input.reason, requested_pin: next.pincode, requested_city: next.city },
      });
    },
    cancelActive: async (): Promise<CancelOutcome> => {
      if (!active) return "cancelled";
      if (active.provider !== "shiprocket" && active.provider !== "delhivery") return "ambiguous";
      try {
        const { cancelProviderShipment } = await import("./shipping/book");
        const payload = (active.provider_payload || {}) as { provider_order_id?: string };
        await cancelProviderShipment({
          provider: active.provider,
          providerOrderId: payload.provider_order_id || active.provider_shipment_id,
          awb: active.awb,
        });
        return "cancelled";
      } catch {
        return "ambiguous";
      }
    },
    refulfill: async () => ({ ok: false, awb: null }),
  });
  return result;
}
