import assert from "node:assert/strict";
import test from "node:test";
import { delhiveryCancelAccepted, delhiveryStatusShowsPossession, parseDelhiveryTracking } from "../../lib/store/shipping/delhiveryApi";
import { missedDelhiveryPickup } from "../../lib/store/shipping/missedPickup";
import { retireMissedDelhiveryPickups, type MissedPickupCandidate } from "../../lib/store/shipping/cancelMissedPickups";

const NOW = "2026-10-10T12:00:00.000Z";

function row(over: Partial<MissedPickupCandidate> = {}): MissedPickupCandidate {
  return {
    orderId: "order-1",
    shipmentId: "ship-1",
    awb: "67350910000001",
    provider: "delhivery",
    shipmentStatus: "manifested",
    trackingStatus: "Not Picked",
    pickupScheduledAt: "2026-10-04T00:00:00.000Z",
    createdAt: "2026-10-03T07:00:00.000Z",
    orderStatus: "PICKUP_SCHEDULED",
    pickupState: "NOT_REQUESTED",
    ...over,
  };
}

test("a past Delhivery pickup that is still Not Picked is missed", () => {
  assert.equal(missedDelhiveryPickup(row(), NOW), true);
  assert.equal(missedDelhiveryPickup(row({ trackingStatus: "Manifested" }), NOW), true);
});

test("same-day Not Picked is still waiting and is not cancelled", () => {
  assert.equal(missedDelhiveryPickup(row({ pickupScheduledAt: "2026-10-10T00:00:00.000Z" }), NOW), false);
});

test("Not Picked with no date is missed only after a week", () => {
  assert.equal(
    missedDelhiveryPickup(row({ pickupScheduledAt: null, createdAt: "2026-09-30T06:00:00.000Z", orderStatus: "READY_FOR_PICKUP" }), NOW),
    true,
  );
  assert.equal(
    missedDelhiveryPickup(row({ pickupScheduledAt: null, createdAt: "2026-10-08T06:00:00.000Z", orderStatus: "READY_FOR_PICKUP" }), NOW),
    false,
  );
});

test("possession, Shiprocket, Packed, and a pickup-only cancellation are not missed", () => {
  assert.equal(missedDelhiveryPickup(row({ trackingStatus: "In Transit" }), NOW), false);
  assert.equal(missedDelhiveryPickup(row({ trackingStatus: "Picked Up" }), NOW), false);
  assert.equal(missedDelhiveryPickup(row({ provider: "shiprocket" }), NOW), false);
  assert.equal(missedDelhiveryPickup(row({ orderStatus: "PACKED" }), NOW), false);
  assert.equal(missedDelhiveryPickup(row({ orderStatus: "IN_TRANSIT" }), NOW), false);
  assert.equal(missedDelhiveryPickup(row({ trackingStatus: "Pickup Cancelled" }), NOW), false);
  assert.equal(delhiveryStatusShowsPossession("Not Picked"), false);
  assert.equal(delhiveryStatusShowsPossession("In Transit"), true);
});

test("a live Not Picked read cancels the waybill and retires the order", async () => {
  const cancelled: string[] = [];
  const retired: string[] = [];
  const result = await retireMissedDelhiveryPickups({
    candidates: [row()],
    nowIso: NOW,
    readLive: async () => ({ rawStatus: "Not Picked", possessed: false }),
    cancelAwb: async (awb) => {
      cancelled.push(awb);
    },
    retireLocal: async (candidate) => {
      retired.push(candidate.shipmentId);
      return true;
    },
  });
  assert.deepEqual(cancelled, ["67350910000001"]);
  assert.deepEqual(retired, ["ship-1"]);
  assert.equal(result.cancelled, 1);
  assert.equal(result.errors, 0);
});

test("a live in-transit or failed read does not cancel", async () => {
  let cancels = 0;
  const inTransit = await retireMissedDelhiveryPickups({
    candidates: [row()],
    nowIso: NOW,
    readLive: async () => ({ rawStatus: "In Transit", possessed: true }),
    cancelAwb: async () => {
      cancels += 1;
    },
    retireLocal: async () => true,
  });
  const unread = await retireMissedDelhiveryPickups({
    candidates: [row()],
    nowIso: NOW,
    readLive: async () => ({ rawStatus: null, possessed: false }),
    cancelAwb: async () => {
      cancels += 1;
    },
    retireLocal: async () => true,
  });
  assert.equal(inTransit.cancelled, 0);
  assert.equal(inTransit.skipped, 1);
  assert.equal(unread.skipped, 1);
  assert.equal(cancels, 0);
});

test("a scan that already shows pickup blocks cancellation even if the headline is Not Picked", async () => {
  const parsed = parseDelhiveryTracking({
    ShipmentData: [
      {
        Shipment: {
          Status: { Status: "Not Picked" },
          Scans: [{ ScanDetail: { Scan: "Picked Up" } }],
        },
      },
    ],
  });
  assert.equal(parsed.possessed, true);
  let cancels = 0;
  const result = await retireMissedDelhiveryPickups({
    candidates: [row()],
    nowIso: NOW,
    readLive: async () => parsed,
    cancelAwb: async () => {
      cancels += 1;
    },
    retireLocal: async () => true,
  });
  assert.equal(result.cancelled, 0);
  assert.equal(cancels, 0);
});

test("an already-cancelled waybill is retired locally without a second cancel", async () => {
  let cancels = 0;
  const result = await retireMissedDelhiveryPickups({
    candidates: [row()],
    nowIso: NOW,
    readLive: async () => ({ rawStatus: "Cancelled", possessed: false }),
    cancelAwb: async () => {
      cancels += 1;
    },
    retireLocal: async () => true,
  });
  assert.equal(cancels, 0);
  assert.equal(result.alreadyCancelled, 1);
});

test("a rejected Delhivery cancel does not retire the local shipment", async () => {
  let retired = 0;
  const result = await retireMissedDelhiveryPickups({
    candidates: [row()],
    nowIso: NOW,
    readLive: async () => ({ rawStatus: "Not Picked", possessed: false }),
    cancelAwb: async () => {
      throw new Error("rejected");
    },
    retireLocal: async () => {
      retired += 1;
      return true;
    },
  });
  assert.equal(retired, 0);
  assert.equal(result.errors, 1);
  assert.equal(result.cancelled, 0);
});

test("Delhivery cancel acceptance requires more than HTTP 200", () => {
  assert.equal(delhiveryCancelAccepted(200, { status: true, remark: "Shipment has been cancelled" }), true);
  assert.equal(delhiveryCancelAccepted(200, { status: false, remark: "Shipment status cannot be changed" }), false);
  assert.equal(delhiveryCancelAccepted(200, { status: "Failure", error: "in transit" }), false);
  assert.equal(delhiveryCancelAccepted(400, { status: true }), false);
});
