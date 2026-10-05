import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ALL_ORDER_STATUSES,
  COLLECTION_STATUSES,
  DELIVERY_ONLY_STATUSES,
  FULFILLMENT_METHODS,
  canMarkCollected,
  methodFromFilterKey,
  nextActionFor,
  orderMethod,
  parseFulfillmentMethod,
  readyAge,
  staffAdvanceLabelFor,
  staffNextStatusFor,
  statusAllowedFor,
} from "../../lib/store/fulfillment";
import { STAFF_NEXT } from "../../lib/store/stages";
import {
  activePickupLocation,
  pickupLocationFingerprint,
  pickupLocationProblems,
  PICKUP_LOCATIONS,
  readPickupSnapshot,
  readyForCollectionMessage,
  snapshotPickupLocation,
} from "../../lib/store/pickupLocation";

const MIGRATION = readFileSync(new URL("../../supabase/migrations/2026-10-05-notes-store-academy-pickup.sql", import.meta.url), "utf8");

function quotedIn(block: string): string[] {
  return [...block.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
}

test("database and application agree on every method and status value", () => {
  const statusBlock = MIGRATION.match(/add constraint store_orders_status_check check \(status in \(([\s\S]*?)\)\);/)?.[1] || "";
  assert.deepEqual(new Set(quotedIn(statusBlock)), new Set(ALL_ORDER_STATUSES));
  const methodBlock = MIGRATION.match(/store_orders_fulfillment_method_check\s+check \(fulfillment_method in \(([^)]*)\)\)/)?.[1] || "";
  assert.deepEqual(new Set(quotedIn(methodBlock)), new Set(FULFILLMENT_METHODS));
  const pickupForbidden = MIGRATION.match(/fulfillment_method = 'ACADEMY_PICKUP' and status not in \(([\s\S]*?)\)\s*\)/)?.[1] || "";
  assert.deepEqual(new Set(quotedIn(pickupForbidden)), new Set(DELIVERY_ONLY_STATUSES));
  const deliveryForbidden = MIGRATION.match(/fulfillment_method = 'DELIVERY' and status not in \(([^)]*)\)/)?.[1] || "";
  assert.deepEqual(new Set(quotedIn(deliveryForbidden)), new Set(COLLECTION_STATUSES));
});

test("table-driven: every status is allowed for exactly the right methods", () => {
  for (const status of ALL_ORDER_STATUSES) {
    const collection = (COLLECTION_STATUSES as readonly string[]).includes(status);
    const deliveryOnly = (DELIVERY_ONLY_STATUSES as readonly string[]).includes(status);
    assert.equal(statusAllowedFor("DELIVERY", status), !collection, `DELIVERY ${status}`);
    assert.equal(statusAllowedFor("ACADEMY_PICKUP", status), !deliveryOnly, `PICKUP ${status}`);
  }
  // Shared statuses stay valid for pickup (payment, preparation, cancel, refund, return request).
  for (const shared of ["PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_EXPIRED", "ORDER_CONFIRMED", "PROCESSING", "PRINTING", "CANCELLED", "REFUND_PENDING", "REFUNDED", "PARTIALLY_REFUNDED", "RETURN_REQUESTED"]) {
    assert.equal(statusAllowedFor("ACADEMY_PICKUP", shared), true, shared);
  }
  assert.equal(statusAllowedFor("DELIVERY", "NOT_A_STATUS"), false);
});

test("method parsing defaults historical rows to DELIVERY", () => {
  assert.equal(orderMethod({}), "DELIVERY");
  assert.equal(orderMethod({ fulfillment_method: null }), "DELIVERY");
  assert.equal(orderMethod({ fulfillment_method: "ACADEMY_PICKUP" }), "ACADEMY_PICKUP");
  assert.equal(parseFulfillmentMethod("academy_pickup"), "ACADEMY_PICKUP");
  assert.equal(parseFulfillmentMethod("PICKUP"), null);
  assert.equal(parseFulfillmentMethod("COURIER"), null);
  assert.equal(methodFromFilterKey("academy_pickup"), "ACADEMY_PICKUP");
  assert.equal(methodFromFilterKey("delivery"), "DELIVERY");
  assert.equal(methodFromFilterKey("pickup"), null, "the existing courier 'pickup' bucket key is not a method");
});

test("transition matrix: delivery unchanged, pickup ends at collection", () => {
  for (const [from, to] of Object.entries(STAFF_NEXT)) assert.equal(staffNextStatusFor(from, "DELIVERY"), to);
  assert.equal(staffNextStatusFor("ORDER_CONFIRMED", "ACADEMY_PICKUP"), "PROCESSING");
  assert.equal(staffNextStatusFor("PROCESSING", "ACADEMY_PICKUP"), "PRINTING");
  assert.equal(staffNextStatusFor("PRINTING", "ACADEMY_PICKUP"), "READY_FOR_COLLECTION");
  assert.equal(staffNextStatusFor("READY_TO_PACK", "ACADEMY_PICKUP"), "READY_FOR_COLLECTION");
  // Invalid moves that must not exist.
  assert.notEqual(staffNextStatusFor("PRINTING", "ACADEMY_PICKUP"), "PACKED");
  assert.equal(staffNextStatusFor("READY_FOR_COLLECTION", "ACADEMY_PICKUP"), null, "handover uses the confirmed collect action");
  assert.equal(staffNextStatusFor("COLLECTED", "ACADEMY_PICKUP"), null);
  assert.notEqual(staffNextStatusFor("PRINTING", "DELIVERY"), "READY_FOR_COLLECTION");
  assert.equal(staffNextStatusFor("DELIVERED", "DELIVERY"), null);
  for (const unpaid of ["PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_EXPIRED"]) {
    assert.equal(staffNextStatusFor(unpaid, "ACADEMY_PICKUP"), null, unpaid);
    assert.equal(staffNextStatusFor(unpaid, "DELIVERY"), null, unpaid);
  }
  assert.equal(staffAdvanceLabelFor("PRINTING", "ACADEMY_PICKUP"), "Mark ready for collection");
  assert.equal(staffAdvanceLabelFor("PRINTING", "DELIVERY"), "Mark packed");
});

test("mark collected only from READY_FOR_COLLECTION on a pickup order", () => {
  assert.equal(canMarkCollected({ status: "READY_FOR_COLLECTION", fulfillment_method: "ACADEMY_PICKUP" }), true);
  for (const status of ["PRINTING", "PROCESSING", "COLLECTED", "CANCELLED", "REFUNDED", "PAYMENT_FAILED", "PAYMENT_PENDING"]) {
    assert.equal(canMarkCollected({ status, fulfillment_method: "ACADEMY_PICKUP" }), false, status);
  }
  assert.equal(canMarkCollected({ status: "READY_FOR_COLLECTION", fulfillment_method: "DELIVERY" }), false);
  assert.equal(canMarkCollected({ status: "DELIVERED" }), false);
});

test("shared next-action copy", () => {
  assert.equal(nextActionFor("PRINTING", "ACADEMY_PICKUP").label, "Mark ready for collection");
  assert.equal(nextActionFor("READY_FOR_COLLECTION", "ACADEMY_PICKUP").label, "Hand over and mark collected");
  assert.equal(nextActionFor("COLLECTED", "ACADEMY_PICKUP").complete, true);
  assert.equal(nextActionFor("PACKED", "DELIVERY").label, "Compare couriers");
  assert.equal(nextActionFor("PRINTING", "DELIVERY").label, "Mark packed");
});

test("ready age is descriptive, never overdue", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  assert.equal(readyAge(null, now), null);
  assert.deepEqual(readyAge("2026-10-08T11:30:00Z", now)?.tone, "neutral");
  assert.equal(readyAge("2026-10-07T10:00:00Z", now)?.label, "Waiting 1 day");
  assert.equal(readyAge("2026-10-07T10:00:00Z", now)?.tone, "amber");
  assert.equal(readyAge("2026-10-03T10:00:00Z", now)?.tone, "strong");
  assert.doesNotMatch(readyAge("2026-10-01T10:00:00Z", now)?.label || "", /overdue/i);
});

test("pickup location: trusted, valid, fingerprinted, snapshot-safe", () => {
  const active = activePickupLocation();
  assert.equal(active.ok, true);
  const loc = PICKUP_LOCATIONS.CHD_17C;
  assert.deepEqual(pickupLocationProblems(loc), []);
  assert.equal(loc.pincode, null, "physical PIN not shown until reconciled with invoice settings");
  assert.equal(loc.mapsUrl, "https://maps.app.goo.gl/BSA5hDQhBMKxKTbg6");
  assert.equal(loc.phoneTel, "+918437686541");
  assert.deepEqual(loc.addressLines, ["SCO 173–174, 2nd Floor", "Sector 17C, Chandigarh"]);
  const fp = pickupLocationFingerprint(loc);
  assert.equal(fp, pickupLocationFingerprint({ ...loc }));
  assert.notEqual(fp, pickupLocationFingerprint({ ...loc, addressLines: ["Somewhere else"] }));
  assert.deepEqual(pickupLocationProblems({ ...loc, mapsUrl: "javascript:alert(1)" }), ["maps_url"]);
  assert.deepEqual(pickupLocationProblems(undefined), ["missing"]);
  assert.equal(activePickupLocation("NOPE").ok, false);

  const snap = snapshotPickupLocation(loc, new Date("2026-10-05T00:00:00Z"));
  assert.equal(snap.fingerprint, fp);
  assert.equal(readPickupSnapshot(JSON.parse(JSON.stringify(snap)))?.name, "Naman Sharma IAS Academy");
  assert.equal(readPickupSnapshot(null), null);
  assert.equal(readPickupSnapshot({}), null);
  assert.equal(readPickupSnapshot({ name: "x", address_lines: [] }), null);
  // The ready message uses the order's own snapshot, not today's config.
  const moved = { ...snap, name: "Old Academy", address_lines: ["Old Street"] };
  assert.match(readyForCollectionMessage("NIAS-N-1", moved), /Old Academy, Old Street/);
  assert.doesNotMatch(readyForCollectionMessage("NIAS-N-1", snap), /\d{1,2}\s?(am|pm)/i, "no invented hours");
});
