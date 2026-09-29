import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { explicitCourierSelection, presentCourierQuotes } from "../../lib/store/adminConsole";
import { bookSelectedCourier, packageSurvivesCancellation, printableShipment, resolveBookingPackage } from "../../lib/store/shipping/manualBook";

const quotes = [
  { provider: "shiprocket" as const, courier: "Ekart Surface", service: "Surface", ratePaise: 5510, etaText: "4–6 days", etaDays: 5, prepaid: true, codSupported: false, courierId: "2" },
  { provider: "delhivery" as const, courier: "Delhivery Surface", service: "Surface", ratePaise: 5800, etaText: "3–5 days", etaDays: 4, prepaid: true, codSupported: true, courierId: null },
  { provider: "shiprocket" as const, courier: "Xpressbees Surface", service: "Surface", ratePaise: 5240, etaText: "3–5 days", etaDays: 4, prepaid: true, codSupported: false, courierId: "51" },
  { provider: "shiprocket" as const, courier: "COD Only", service: "Surface", ratePaise: 4000, etaText: null, etaDays: null, prepaid: false, codSupported: true, courierId: "9" },
];

test("packed rates are cheapest first and nothing is selected", () => {
  const presented = presentCourierQuotes(quotes);
  assert.equal(presented[0].courier, "Xpressbees Surface");
  assert.equal(presented[0].lowest, true);
  assert.equal(presented[0].eligible, true);
  assert.equal(presented.at(-1)?.eligible, false);
  assert.equal(explicitCourierSelection(null), null);
  assert.equal(explicitCourierSelection("  "), null);
  assert.equal(explicitCourierSelection(presented[1].key), presented[1].key);
});

test("one selected courier creates one shipment, label, and pickup", async () => {
  let creates = 0;
  const result = await bookSelectedCourier({
    selected: { provider: "shiprocket", courier: "Xpressbees Surface", service: "Surface", courierId: "51", ratePaise: 5240 },
    activeAwb: null,
    create: async () => {
      creates += 1;
      return {
        awb: "AWB1",
        labelUrl: "https://labels.example/1",
        providerOrderId: "o1",
        providerShipmentId: "s1",
        courierName: "Xpressbees Surface",
        addressMismatch: false,
        unverified: false,
        possessed: false,
      };
    },
    cancel: async () => true,
    requestPickup: async () => undefined,
  });
  assert.equal(creates, 1);
  assert.equal(result.ok, true);
  assert.equal(result.awb, "AWB1");
  assert.equal(result.labelUrl, "https://labels.example/1");
  assert.equal(result.pickupRequested, true);
  assert.equal(result.blocked, null);
});

test("a booking failure does not fall back to another courier", async () => {
  let creates = 0;
  const result = await bookSelectedCourier({
    selected: { provider: "shiprocket", courier: "Xpressbees Surface", service: "Surface", courierId: "51", ratePaise: 5240 },
    activeAwb: null,
    create: async () => {
      creates += 1;
      throw new Error("provider down");
    },
    cancel: async () => true,
    requestPickup: async () => undefined,
  });
  assert.equal(creates, 1);
  assert.equal(result.ok, false);
  assert.equal(result.blocked, "BOOKING_FAILED");
  assert.match(result.message, /Xpressbees Surface could not be booked/);
  assert.equal(result.pickupRequested, false);
});

test("address failure cancels that shipment and does not book the next courier", async () => {
  const cancelled: string[] = [];
  const result = await bookSelectedCourier({
    selected: { provider: "delhivery", courier: "Delhivery Surface", service: "Surface", courierId: null, ratePaise: 5800 },
    activeAwb: null,
    create: async () => ({
      awb: "DL1",
      labelUrl: null,
      providerOrderId: "d1",
      providerShipmentId: "d1",
      courierName: "Delhivery Surface",
      addressMismatch: true,
      unverified: false,
      possessed: false,
    }),
    cancel: async (created) => {
      cancelled.push(created.awb || "");
      return true;
    },
    requestPickup: async () => {
      throw new Error("pickup must not run");
    },
  });
  assert.deepEqual(cancelled, ["DL1"]);
  assert.equal(result.creates, 1);
  assert.equal(result.pickupRequested, false);
  assert.equal(result.blocked, "BOOKING_FAILED");
});

test("an existing AWB blocks a second shipment", async () => {
  let creates = 0;
  const result = await bookSelectedCourier({
    selected: { provider: "shiprocket", courier: "Ekart Surface", service: "Surface", courierId: "2", ratePaise: 5510 },
    activeAwb: "LIVE",
    create: async () => {
      creates += 1;
      return {
        awb: "NEW",
        labelUrl: null,
        providerOrderId: null,
        providerShipmentId: null,
        courierName: "Ekart Surface",
        addressMismatch: false,
        unverified: false,
        possessed: false,
      };
    },
    cancel: async () => true,
    requestPickup: async () => undefined,
  });
  assert.equal(creates, 0);
  assert.equal(result.blocked, "EXISTING_AWB");
});

test("pickup scheduled is separate from a failed pickup request", async () => {
  const result = await bookSelectedCourier({
    selected: { provider: "shiprocket", courier: "Ekart Surface", service: "Surface", courierId: "2", ratePaise: 5510 },
    activeAwb: null,
    create: async () => ({
      awb: "AWB2",
      labelUrl: "https://labels.example/2",
      providerOrderId: "o2",
      providerShipmentId: "s2",
      courierName: "Ekart Surface",
      addressMismatch: false,
      unverified: false,
      possessed: false,
    }),
    cancel: async () => true,
    requestPickup: async () => {
      throw new Error("pickup queue full");
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.awb, "AWB2");
  assert.equal(result.pickupRequested, false);
  assert.equal(result.blocked, "PICKUP_PENDING");
});

test("a cancelled label is not the printable shipment and package data stays", () => {
  const live = printableShipment([
    { status: "cancelled", awb: "OLD" },
    { status: "created", awb: "NEW" },
  ]);
  assert.equal(live?.awb, "NEW");
  assert.equal(printableShipment([{ status: "cancelled", awb: "OLD" }]), null);
  const kept = packageSurvivesCancellation({ weight_grams: 1000, length_mm: 320, width_mm: 230, height_mm: 40 });
  assert.deepEqual(kept, { weight_grams: 1000, length_mm: 320, width_mm: 230, height_mm: 40 });
});

test("a mixed parcel keeps the entered package and a single book uses the product profile", () => {
  const mixed = resolveBookingPackage({
    override: null,
    lines: [
      { qty: 1, weightGrams: 500, lengthMm: 300, widthMm: 250, heightMm: 30 },
      { qty: 1, weightGrams: 500, lengthMm: 300, widthMm: 250, heightMm: 30 },
    ],
  });
  assert.equal(mixed.ok, false);
  const single = resolveBookingPackage({
    override: null,
    lines: [{ qty: 1, weightGrams: 500, lengthMm: 300, widthMm: 250, heightMm: 30 }],
  });
  assert.equal(single.ok, true);
  if (single.ok) {
    assert.equal(single.source, "PRODUCT_PROFILE");
    assert.equal(single.weightGrams, 500);
    assert.equal(single.lengthCm, 30);
  }
  const saved = resolveBookingPackage({
    override: { weightGrams: 1000, lengthMm: 320, widthMm: 230, heightMm: 40 },
    lines: [
      { qty: 1, weightGrams: 500, lengthMm: 300, widthMm: 250, heightMm: 30 },
      { qty: 1, weightGrams: 500, lengthMm: 300, widthMm: 250, heightMm: 30 },
    ],
  });
  assert.equal(saved.ok, true);
  if (saved.ok) assert.equal(saved.weightGrams, 1000);
});

test("mark packed and package save do not book a courier", () => {
  const advance = fs.readFileSync(new URL("../../app/api/admin/notes/orders/[id]/advance/route.ts", import.meta.url), "utf8");
  const pack = fs.readFileSync(new URL("../../app/api/admin/notes/orders/[id]/pack/route.ts", import.meta.url), "utf8");
  const address = fs.readFileSync(new URL("../../lib/store/deliveryAddressApply.ts", import.meta.url), "utf8");
  const picker = fs.readFileSync(new URL("../../components/notes/admin/orders/CourierPicker.tsx", import.meta.url), "utf8");
  assert.equal(advance.includes("runAutoFulfillment"), false);
  assert.equal(pack.includes("runAutoFulfillment"), false);
  assert.equal(address.includes("runAutoFulfillment"), false);
  assert.equal(picker.includes("defaultQuote"), false);
  assert.match(picker, /Confirm booking/);
  assert.match(picker, /Book this courier/);
  assert.match(picker, /explicitCourierSelection\(null\)/);
});
