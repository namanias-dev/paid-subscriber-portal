/**
 * Academy Pickup checkout against the in-memory local fixture (no network, no gateway
 * call: the payment URL is built with a dummy key and never opened).
 */
process.env.NOTES_STORE_LOCAL_FIXTURE = "1";
process.env.NOTES_STORE_PICKUP_LOCAL = "1";
process.env.ICICI_EAZYPAY_AES_KEY = "0123456789abcdef";
delete process.env.VERCEL;

import test from "node:test";
import assert from "node:assert/strict";
import { localFixtureClient, resetLocalFixture } from "../../lib/store/localFixture";
import { getCartView } from "../../lib/store/cart";
import { buildFrozenQuote, buildPickupQuote } from "../../lib/store/quote";
import { matchZone } from "../../lib/store/serviceability";
import { placeCheckout, placePickupCheckout } from "../../lib/store/checkout";
import { PickupCheckoutError, validatePickupCheckout } from "../../lib/store/pickupCheckoutRules";
import { activePickupLocation } from "../../lib/store/pickupLocation";
import { localPickupOverride } from "../../lib/store/pickupAvailability";

const PRODUCT = "33333333-3333-4333-8333-333333333333";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => localFixtureClient() as any;
const active = activePickupLocation();
const fingerprint = active.ok ? active.fingerprint : "";

async function cartWith(qty = 1, cartId = crypto.randomUUID()) {
  await db().from("store_carts").insert({ id: cartId, status: "open" });
  await db().from("store_cart_items").insert({ cart_id: cartId, product_id: PRODUCT, qty, created_at: new Date().toISOString() });
  const cart = await getCartView(cartId);
  assert.ok(cart, "fixture cart");
  return cart!;
}

function pickupBody(extra: Record<string, unknown> = {}) {
  return {
    fulfillment_method: "ACADEMY_PICKUP",
    name: "TEST Pickup Buyer",
    phone: "9000000401",
    pincode: "744101",
    pickup_location_code: "CHD_17C",
    pickup_location_fingerprint: fingerprint,
    pickup_acknowledged: true,
    ...extra,
  };
}

async function counts() {
  const n = async (t: string) => ((await db().from(t).select("*")).data || []).length;
  return { orders: await n("store_orders"), payments: await n("store_order_payments"), holds: await n("store_offer_holds"), items: await n("store_order_items") };
}

async function setOffer(offer: { discount_type: "percentage" | "fixed_amount"; discount_value: number } | null) {
  for (const o of (await db().from("store_offers").select("*")).data || []) await db().from("store_offers").update({ enabled: false }).eq("id", o.id);
  if (!offer) return;
  await db().from("store_offers").insert({
    id: crypto.randomUUID(), name: "TEST offer", slug: "test-offer", enabled: true, scope: "all_products", product_ids: [], category_ids: [],
    max_redemptions: null, redemptions_used: 0, starts_at: new Date(Date.now() - 864e5).toISOString(), ends_at: new Date(Date.now() + 864e5).toISOString(),
    created_at: new Date().toISOString(), ...offer,
  });
}

test("golden: delivery quote numbers are unchanged by the shared line builder", async () => {
  resetLocalFixture();
  const cart = await cartWith(2);
  const zones = (await db().from("store_zones").select("*")).data;
  const pin = (code: string) => {
    const zone = matchZone(code, zones);
    return { pincode: code, serviceable: true, city: "C", state: "S", zone, promised_date: "2026-10-12", promised_label: "Mon", dispatch_days: 2, transit_days: zone.transit_days_max, buffer_days: 2 };
  };
  // Values recorded from the pre-refactor implementation (scratch golden run, 27 cases, 0 diffs).
  const expected = [
    { offer: null, discount: 0, total: 489740 },
    { offer: { discount_type: "percentage" as const, discount_value: 10 }, discount: 47984, total: 441756 },
    { offer: { discount_type: "fixed_amount" as const, discount_value: 15000 }, discount: 15000, total: 474740 },
  ];
  for (const row of expected) {
    await setOffer(row.offer);
    const q = await buildFrozenQuote(cart, pin("110001"));
    assert.equal(q.shipping_paise, 9900);
    assert.equal(q.discount_paise, row.discount, `${row.offer?.discount_type || "none"} discount`);
    assert.equal(q.total_paise, row.total, `${row.offer?.discount_type || "none"} total`);
    const p = await buildPickupQuote(cart, { pincode: "744101", city: "South Andaman", state: "Andaman & Nicobar Islands" }, "CHD_17C");
    assert.equal(p.shipping_paise, 0, "pickup never charges shipping");
    assert.equal(p.total_paise, row.total - 9900, "pickup = same lines, no shipping");
    assert.deepEqual(p.items, q.items, "identical priced lines");
    assert.equal(p.promised_delivery_date, null, "pickup makes no date promise");
  }
  await setOffer(null);
});

test("request rules: explicit acknowledgement, matching location fingerprint, delivery fields ignored", () => {
  assert.ok(active.ok);
  const contact = validatePickupCheckout({ ...pickupBody(), line1: "", address_hash: "junk", landmark: 42 } as never, active);
  assert.deepEqual(contact, { name: "TEST Pickup Buyer", phone: "9000000401", rawPhone: "9000000401", email: undefined, pincode: "744101" });
  const code = (body: Record<string, unknown>) => {
    try {
      validatePickupCheckout(body, active);
      return "OK";
    } catch (e) {
      return (e as PickupCheckoutError).code;
    }
  };
  assert.equal(code(pickupBody({ pickup_acknowledged: "true" })), "NOT_ACKNOWLEDGED", "only boolean true counts");
  assert.equal(code(pickupBody({ pickup_location_fingerprint: "CHD_17C:00000000" })), "LOCATION_CHANGED");
  assert.equal(code(pickupBody({ pickup_location_code: "ELSEWHERE" })), "LOCATION_CHANGED");
  assert.equal(code(pickupBody({ phone: "12345" })), "INVALID_PHONE");
  assert.equal(code(pickupBody({ pincode: "012345" })), "INVALID_PIN");
  assert.equal(code(pickupBody({ email: "not-an-email" })), "INVALID_EMAIL");
  assert.equal(code(pickupBody({ name: " " })), "INVALID_NAME");
  assert.equal(code(pickupBody()), "OK");
  assert.throws(() => validatePickupCheckout(pickupBody(), { ok: false, problems: ["phone"] }), (e: PickupCheckoutError) => e.code === "PICKUP_UNAVAILABLE");
});

test("local pickup override never applies on Vercel or production", () => {
  assert.equal(localPickupOverride({ NOTES_STORE_LOCAL_FIXTURE: "1", NOTES_STORE_PICKUP_LOCAL: "1" } as never), true);
  assert.equal(localPickupOverride({ NOTES_STORE_LOCAL_FIXTURE: "1", NOTES_STORE_PICKUP_LOCAL: "1", VERCEL: "1" } as never), false);
  assert.equal(localPickupOverride({ NOTES_STORE_LOCAL_FIXTURE: "1", NOTES_STORE_PICKUP_LOCAL: "1", VERCEL_ENV: "production" } as never), false);
  assert.equal(localPickupOverride({ NOTES_STORE_PICKUP_LOCAL: "1" } as never), false);
});

test("pickup order: zero shipping, frozen location, customer location, no address, valid non-serviceable PIN", async () => {
  resetLocalFixture();
  const cart = await cartWith(1);
  const result = await placePickupCheckout(cart, pickupBody());
  assert.match(result.payment_url, /^https:\/\/eazypay\.icicibank\.com\/EazyPG\?/);
  assert.equal(result.promised_delivery_date, null);
  const order = (await db().from("store_orders").select("*").eq("order_no", result.order_no).maybeSingle()).data;
  assert.equal(order.fulfillment_method, "ACADEMY_PICKUP");
  assert.equal(order.shipping_paise, 0);
  assert.equal(order.total_paise, order.subtotal_paise - order.discount_paise + order.tax_paise);
  assert.equal(order.shipping_address_id, null);
  assert.equal(order.pickup_location_code, "CHD_17C");
  assert.equal(order.pickup_location_snapshot.fingerprint, fingerprint);
  assert.equal(order.pickup_location_snapshot.pincode, null, "no academy PIN on the snapshot");
  assert.ok(order.pickup_acknowledged_at);
  assert.equal(order.customer_location_snapshot.pincode, "744101");
  assert.equal(order.customer_location_snapshot.city, "South Andaman");
  assert.equal(order.quote_json.zone, "ACADEMY_PICKUP");
  const event = ((await db().from("store_order_events").select("*").eq("order_id", order.id)).data || []).find((e: { event: string }) => e.event === "checkout_started");
  assert.equal(event.payload_json.fulfillment_method, "ACADEMY_PICKUP");
  assert.equal(((await db().from("store_addresses").select("*")).data || []).filter((a: { customer_id?: string }) => a.customer_id === order.customer_id).length, 0, "no address row");
  assert.equal((await db().from("store_carts").select("status").eq("id", cart.id).maybeSingle()).data.status, "converted");
});

test("double tap and two tabs: at most one order per cart", async () => {
  resetLocalFixture();
  const cart = await cartWith(1);
  const before = await counts();
  const settled = await Promise.allSettled([1, 2, 3].map(() => placePickupCheckout(cart, pickupBody())));
  const won = settled.filter((r) => r.status === "fulfilled");
  const refused = settled.filter((r) => r.status === "rejected").map((r) => ((r as PromiseRejectedResult).reason as PickupCheckoutError).code);
  assert.equal(won.length, 1, "exactly one checkout wins");
  assert.deepEqual(refused, ["ALREADY_PLACING", "ALREADY_PLACING"]);
  const after = await counts();
  assert.equal(after.orders - before.orders, 1);
  assert.equal(after.payments - before.payments, 1);
});

test("validation failures leave no order, payment, hold or claimed cart", async () => {
  resetLocalFixture();
  const cart = await cartWith(1);
  await setOffer({ discount_type: "percentage", discount_value: 10 });
  const before = await counts();
  for (const body of [
    pickupBody({ pickup_acknowledged: false }),
    pickupBody({ pickup_location_fingerprint: "CHD_17C:ffffffff" }),
    pickupBody({ phone: "1" }),
    pickupBody({ pincode: "012345" }),
  ]) {
    await assert.rejects(placePickupCheckout(cart, body), PickupCheckoutError);
  }
  assert.deepEqual(await counts(), before);
  assert.equal((await db().from("store_carts").select("status").eq("id", cart.id).maybeSingle()).data.status, "open");
  await setOffer(null);
});

test("taxable pickup lines fail closed before any order or payment", async () => {
  resetLocalFixture();
  await db().from("store_products").update({ tax_treatment: "taxable", tax_rate_bps: 500 }).eq("id", PRODUCT);
  const cart = await cartWith(1);
  const before = await counts();
  await assert.rejects(placePickupCheckout(cart, pickupBody()), (e: PickupCheckoutError) => e.code === "TAX_UNSUPPORTED");
  assert.deepEqual(await counts(), before);
  assert.equal((await db().from("store_carts").select("status").eq("id", cart.id).maybeSingle()).data.status, "open");
});

test("flag off: pickup creation refused; delivery checkout still works", async () => {
  resetLocalFixture();
  const cart = await cartWith(1);
  process.env.NOTES_STORE_PICKUP_LOCAL = "0";
  try {
    const before = await counts();
    await assert.rejects(placePickupCheckout(cart, pickupBody()), (e: PickupCheckoutError) => e.code === "PICKUP_UNAVAILABLE");
    assert.deepEqual(await counts(), before);
  } finally {
    process.env.NOTES_STORE_PICKUP_LOCAL = "1";
  }
  // Delivery is unaffected by anything pickup-related in the body.
  const { addressFingerprint, canonicalDelivery } = await import("../../lib/store/deliveryAddress");
  const address = { line1: "TEST desk, Connaught Place", line2: "", city: "Central Delhi", state: "Delhi", pincode: "110001" };
  const result = await placeCheckout(cart, {
    name: "TEST Delivery",
    phone: "9000000402",
    ...address,
    address_hash: addressFingerprint(canonicalDelivery(address)),
    pickup_acknowledged: true,
    shipping_paise: 0,
  } as never);
  const order = (await db().from("store_orders").select("*").eq("order_no", result.order_no).maybeSingle()).data;
  assert.equal(order.fulfillment_method ?? "DELIVERY", "DELIVERY");
  assert.equal(order.shipping_paise, 9900, "forged free shipping is ignored");
  assert.ok(order.shipping_address_id);
  assert.equal(order.pickup_location_code ?? null, null);
});
