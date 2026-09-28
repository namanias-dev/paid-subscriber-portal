import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fulfillmentLabel } from "../../lib/store/adminConsole";
import { shipmentPickupLabel } from "../../lib/store/adminConsole";
import { projectCustomerStage } from "../../lib/store/projection";
import { staffNextStatus } from "../../lib/store/stages";
import {
  MARK_PACKED_BOOKS_COURIER,
  bookOneCourier,
  orderStatusAfterBooking,
  rejectionReason,
} from "../../lib/store/shipping/manualBook";

test("mark packed only advances to PACKED and does not book", () => {
  assert.equal(MARK_PACKED_BOOKS_COURIER, false);
  assert.equal(staffNextStatus("PRINTING"), "PACKED");
  assert.equal(staffNextStatus("QUALITY_CHECK"), "PACKED");
  assert.equal(staffNextStatus("READY_TO_PACK"), "PACKED");
  assert.equal(fulfillmentLabel("QUALITY_CHECK", false), "Printing");
  assert.equal(fulfillmentLabel("READY_TO_PACK", false), "Printing");
  assert.equal(projectCustomerStage("PACKED", false), "packed");
  const advance = readFileSync(new URL("../../app/api/admin/notes/orders/[id]/advance/route.ts", import.meta.url), "utf8");
  const pack = readFileSync(new URL("../../app/api/admin/notes/orders/[id]/pack/route.ts", import.meta.url), "utf8");
  const address = readFileSync(new URL("../../lib/store/deliveryAddressApply.ts", import.meta.url), "utf8");
  assert.equal(advance.includes("runAutoFulfillment"), false);
  assert.equal(pack.includes("runAutoFulfillment"), false);
  assert.equal(address.includes("runAutoFulfillment"), false);
  const dispatch = readFileSync(new URL("../../app/api/admin/notes/orders/[id]/dispatch/route.ts", import.meta.url), "utf8");
  assert.match(dispatch, /confirm !== true/);
  assert.match(dispatch, /fulfillment_lock_at/);
  assert.equal(dispatch.includes("fulfillCheapest"), false);
});

test("selecting a courier without confirmation creates nothing", async () => {
  let creates = 0;
  const result = await bookOneCourier({
    confirm: false,
    alreadyActive: false,
    create: async () => { creates += 1; return { awb: "1" }; },
    cancel: async () => true,
    pickup: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "CONFIRM");
  assert.equal(creates, 0);
});

test("a verified booking creates one shipment and one pickup", async () => {
  const calls = { create: 0, cancel: 0, pickup: 0 };
  const result = await bookOneCourier({
    confirm: true,
    alreadyActive: false,
    create: async () => { calls.create += 1; return { awb: "AWB1", phoneStored: true }; },
    cancel: async () => { calls.cancel += 1; return true; },
    pickup: async () => { calls.pickup += 1; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, "PICKUP_SCHEDULED");
  assert.deepEqual(calls, { create: 1, cancel: 0, pickup: 1 });
  assert.equal(orderStatusAfterBooking("PACKED", true), "PICKUP_SCHEDULED");
});

test("verification failure cancels that courier and does not try another", async () => {
  const calls = { create: 0, cancel: 0, pickup: 0 };
  const result = await bookOneCourier({
    confirm: true,
    alreadyActive: false,
    create: async () => { calls.create += 1; return { awb: "AWB1", phoneStored: false, addressMismatch: true }; },
    cancel: async () => { calls.cancel += 1; return true; },
    pickup: async () => { calls.pickup += 1; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "CANCELLED");
  assert.match(result.reason, /phone number/);
  assert.deepEqual(calls, { create: 1, cancel: 1, pickup: 0 });
  assert.equal(rejectionReason({ awb: "1", phoneStored: false }), "Provider shipment did not return a valid phone number.");
});

test("a failed pickup does not report pickup scheduled", async () => {
  const result = await bookOneCourier({
    confirm: true,
    alreadyActive: false,
    create: async () => ({ awb: "AWB1", phoneStored: true }),
    cancel: async () => true,
    pickup: async () => { throw new Error("Pickup was not scheduled."); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, "READY_FOR_PICKUP");
  assert.equal(result.creates, 1);
  assert.equal(orderStatusAfterBooking("PACKED", false), "READY_FOR_PICKUP");
});

test("a second booking is refused while one shipment is already active", async () => {
  let creates = 0;
  const result = await bookOneCourier({
    confirm: true,
    alreadyActive: true,
    create: async () => { creates += 1; return { awb: "AWB2" }; },
    cancel: async () => true,
    pickup: async () => {},
  });
  assert.equal(result.code, "ACTIVE");
  assert.equal(creates, 0);
});

test("a courier create failure leaves no shipment", async () => {
  const result = await bookOneCourier({
    confirm: true,
    alreadyActive: false,
    create: async () => { throw new Error("Rate lookup failed"); },
    cancel: async () => true,
    pickup: async () => {},
  });
  assert.equal(result.code, "CREATE_FAILED");
  assert.equal(result.creates, 0);
});

test("pickup requested is not shown as a confirmed clock time", () => {
  assert.equal(shipmentPickupLabel("created", "3", "2026-09-29"), "Pickup requested");
  assert.equal(shipmentPickupLabel("created", "requested", "2026-09-29"), "Pickup requested");
  assert.equal(shipmentPickupLabel("created", null, null), "Not scheduled");
});
