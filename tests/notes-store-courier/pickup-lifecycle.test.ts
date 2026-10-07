import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeCourierPickupStatus,
  reconcileCourierShipment,
  deriveProviderFactFromLocal,
  planLocalRepair,
  validatePickupDate,
  type LocalShipmentFacts,
  type LocalShipmentRow,
} from "../../lib/store/shipping/pickup";
import { PROGRESS, progressIndex } from "../../lib/store/stages";
import { fulfillmentLabel } from "../../lib/store/adminConsole";

const active = (over: Partial<LocalShipmentFacts> = {}): LocalShipmentFacts => ({
  awb: "AWB1",
  active: true,
  pickupState: "SCHEDULED",
  ...over,
});

// ------------------------------------------------------------------ normalization (§8, §9, §10, §15, §30)

test("scheduled pickup normalizes to SCHEDULED for both providers", () => {
  assert.deepEqual(normalizeCourierPickupStatus({ provider: "delhivery", rawStatus: "Pickup Scheduled" }), {
    pickupState: "SCHEDULED",
    shipmentCancelled: false,
    reason: "Pickup Scheduled",
  });
  assert.equal(normalizeCourierPickupStatus({ provider: "shiprocket", rawStatus: "PICKUP ASSIGNED" }).pickupState, "SCHEDULED");
});

test("a pickup cancellation keeps the shipment valid (Case A)", () => {
  const n = normalizeCourierPickupStatus({ provider: "delhivery", rawStatus: "Pickup Cancelled", rawRemark: "Cancelled in Delhivery One" });
  assert.equal(n.pickupState, "CANCELLED");
  assert.equal(n.shipmentCancelled, false);
  assert.equal(n.reason, "Cancelled in Delhivery One");
});

test("a shipment/AWB cancellation is Case B", () => {
  const n = normalizeCourierPickupStatus({ provider: "shiprocket", rawStatus: "Shipment Cancelled" });
  assert.equal(n.pickupState, "CANCELLED");
  assert.equal(n.shipmentCancelled, true);
});

test("picked up wins over any cancellation wording and pickup exceptions are FAILED", () => {
  assert.equal(normalizeCourierPickupStatus({ provider: "delhivery", rawStatus: "Shipment Picked Up" }).pickupState, "PICKED_UP");
  assert.equal(normalizeCourierPickupStatus({ provider: "delhivery", rawStatus: "Pickup Not Done" }).pickupState, "FAILED");
  assert.equal(normalizeCourierPickupStatus({ provider: "shiprocket", rawStatus: "Pickup Exception" }).pickupState, "FAILED");
});

test("a soft request is REQUESTED, not SCHEDULED (§30)", () => {
  assert.equal(normalizeCourierPickupStatus({ provider: "shiprocket", rawStatus: "Pickup Requested" }).pickupState, "REQUESTED");
  assert.equal(normalizeCourierPickupStatus({ provider: "delhivery", rawStatus: "Awaiting Pickup" }).pickupState, "REQUESTED");
  assert.equal(normalizeCourierPickupStatus({ provider: "delhivery", rawStatus: "Pickup Open" }).pickupState, "REQUESTED");
});

test('Shiprocket "Pickup Generated" means the pickup is scheduled (real prod wording)', () => {
  // `/courier/generate/pickup` is the scheduling call; its live shipments read "Pickup Generated".
  assert.equal(normalizeCourierPickupStatus({ provider: "shiprocket", rawStatus: "Pickup Generated" }).pickupState, "SCHEDULED");
});

test("unknown or empty pickup text yields no signal", () => {
  assert.equal(normalizeCourierPickupStatus({ provider: "manual", rawStatus: "" }).pickupState, null);
  assert.equal(normalizeCourierPickupStatus({ provider: "delhivery", rawStatus: "In Transit" }).pickupState, null);
});

// ------------------------------------------------------------------ reconciliation (§13, §14, §32, §98–§105)

test("PACKED self-heals to PICKUP_SCHEDULED when the provider shows a scheduled pickup (§105)", () => {
  const r = reconcileCourierShipment(
    { status: "PACKED" },
    active({ pickupState: "NOT_REQUESTED" }),
    { awb: "AWB1", pickupState: "SCHEDULED", shipmentCancelled: false },
  );
  assert.equal(r.changed, true);
  assert.equal(r.orderStatus, "PICKUP_SCHEDULED");
  assert.equal(r.pickupState, "SCHEDULED");
  assert.equal(r.cancelShipment, false);
});

test("a booked-but-only-requested pickup stays READY_FOR_PICKUP, never PICKUP_SCHEDULED (§97)", () => {
  const r = reconcileCourierShipment(
    { status: "READY_FOR_PICKUP" },
    active({ pickupState: "NOT_REQUESTED" }),
    { awb: "AWB1", pickupState: "REQUESTED", shipmentCancelled: false },
  );
  assert.equal(r.orderStatus, "READY_FOR_PICKUP");
  assert.equal(r.pickupState, "REQUESTED");
});

test("external pickup cancellation drops PICKUP_SCHEDULED back to READY_FOR_PICKUP, AWB kept (§98)", () => {
  const r = reconcileCourierShipment(
    { status: "PICKUP_SCHEDULED" },
    active({ pickupState: "SCHEDULED" }),
    { awb: "AWB1", pickupState: "CANCELLED", shipmentCancelled: false, reason: "Pickup cancelled" },
  );
  assert.equal(r.changed, true);
  assert.equal(r.orderStatus, "READY_FOR_PICKUP");
  assert.equal(r.pickupState, "CANCELLED");
  assert.equal(r.cancelShipment, false);
});

test("full shipment cancellation returns the order to PACKED and flags the shipment (§99)", () => {
  const r = reconcileCourierShipment(
    { status: "PICKUP_SCHEDULED" },
    active({ pickupState: "SCHEDULED" }),
    { awb: "AWB1", pickupState: "CANCELLED", shipmentCancelled: true },
  );
  assert.equal(r.orderStatus, "PACKED");
  assert.equal(r.cancelShipment, true);
});

test("a pickup-cancelled event after carrier possession never regresses the order (§13, §103)", () => {
  const r = reconcileCourierShipment(
    { status: "PICKED_UP" },
    active({ pickupState: "PICKED_UP" }),
    { awb: "AWB1", pickupState: "CANCELLED", shipmentCancelled: false },
  );
  assert.equal(r.changed, false);
  assert.equal(r.ignored, "post_possession");
  assert.equal(r.orderStatus, null);
});

test("a duplicate cancellation is idempotent (§21, §104)", () => {
  const r = reconcileCourierShipment(
    { status: "READY_FOR_PICKUP" },
    active({ pickupState: "CANCELLED" }),
    { awb: "AWB1", pickupState: "CANCELLED", shipmentCancelled: false },
  );
  assert.equal(r.changed, false);
  assert.equal(r.ignored, "noop");
});

test("an old shipment's event never touches the active (rebooked) shipment (§14, §88, §102)", () => {
  const r = reconcileCourierShipment(
    { status: "PICKUP_SCHEDULED" },
    active({ awb: "AWB_NEW", pickupState: "SCHEDULED" }),
    { awb: "AWB_OLD", pickupState: "CANCELLED", shipmentCancelled: true },
  );
  assert.equal(r.changed, false);
  assert.equal(r.ignored, "awb_mismatch");
});

test("a fact for a superseded (non-active) shipment is recorded, not applied (§14)", () => {
  const r = reconcileCourierShipment(
    { status: "PACKED" },
    active({ active: false, pickupState: "CANCELLED" }),
    { awb: "AWB1", pickupState: "CANCELLED", shipmentCancelled: true },
  );
  assert.equal(r.changed, false);
  assert.equal(r.ignored, "not_active");
});

// ------------------------------------------------------------------ local self-heal from stored truth (§4, §20, §37)
// Fixtures mirror the three real production orders that triggered this work, by shape only
// (no order numbers, names or phones). All three were PACKED with an active manifested AWB.

const row = (over: Partial<LocalShipmentRow> = {}): LocalShipmentRow => ({
  provider: "shiprocket",
  awb: "AWB1",
  shipmentStatus: "manifested",
  trackingStatus: null,
  pickupStatusRaw: null,
  active: true,
  ...over,
});

test("Delhivery AWB booked but pickup never scheduled: PACKED is floored to READY_FOR_PICKUP", () => {
  // tracking_status "Not Picked" carries no pickup signal, but an AWB exists → order fell behind.
  const plan = planLocalRepair({ status: "PACKED" }, row({ provider: "delhivery", trackingStatus: "Not Picked" }));
  assert.equal(plan.changed, true);
  assert.equal(plan.basis, "booking_floor");
  assert.equal(plan.orderStatus, "READY_FOR_PICKUP");
  assert.equal(plan.pickupState, "REQUESTED");
  assert.equal(plan.cancelShipment, false);
});

test('Shiprocket "Pickup Generated" while order is PACKED repairs to PICKUP_SCHEDULED (§20 — not hidden by a bucket)', () => {
  const plan = planLocalRepair({ status: "PACKED" }, row({ provider: "shiprocket", trackingStatus: "Pickup Generated" }));
  assert.equal(plan.changed, true);
  assert.equal(plan.basis, "provider_signal");
  assert.equal(plan.orderStatus, "PICKUP_SCHEDULED");
  assert.equal(plan.pickupState, "SCHEDULED");
});

test("a cancelled shipment is Case B: order returns to PACKED and the shipment is flagged", () => {
  const fact = deriveProviderFactFromLocal(row({ shipmentStatus: "cancelled" }));
  assert.equal(fact.shipmentCancelled, true);
  const plan = planLocalRepair({ status: "PICKUP_SCHEDULED" }, row({ shipmentStatus: "cancelled", pickupState: "SCHEDULED" }));
  assert.equal(plan.basis, "shipment_cancelled");
  assert.equal(plan.orderStatus, "PACKED");
  assert.equal(plan.cancelShipment, true);
});

test("local repair is idempotent — an already-scheduled order is a no-op", () => {
  const plan = planLocalRepair(
    { status: "PICKUP_SCHEDULED" },
    row({ trackingStatus: "Pickup Generated", pickupState: "SCHEDULED" }),
  );
  assert.equal(plan.changed, false);
  assert.equal(plan.basis, "none");
});

test("booking floor never fires after carrier possession or for a superseded shipment", () => {
  assert.equal(planLocalRepair({ status: "IN_TRANSIT" }, row({ trackingStatus: "Not Picked" })).changed, false);
  assert.equal(planLocalRepair({ status: "PACKED" }, row({ active: false, trackingStatus: "Not Picked" })).changed, false);
  // No AWB yet → nothing to floor to; the order is genuinely still packed.
  assert.equal(planLocalRepair({ status: "PACKED" }, row({ awb: null, shipmentStatus: "pending" })).changed, false);
});

// ------------------------------------------------------------------ pickup date validation (§40, §41, §42, §107, §111)

const NOW = "2026-10-07T09:00:00Z"; // 14:30 IST

test("yesterday is rejected as past", () => {
  assert.deepEqual(validatePickupDate("2026-10-06", { nowIso: NOW }), { ok: false, reason: "past" });
});

test("today before cutoff is allowed, after cutoff is refused (§42)", () => {
  // 14:30 IST now. Cutoff 17 → same-day still allowed.
  assert.deepEqual(validatePickupDate("2026-10-07", { nowIso: NOW, cutoffHourIST: 17 }), { ok: true, sameDay: true });
  // Cutoff 14 → same-day refused.
  assert.deepEqual(validatePickupDate("2026-10-07", { nowIso: NOW, cutoffHourIST: 14 }), { ok: false, reason: "cutoff" });
});

test("a future date within the window is allowed; beyond it is too far", () => {
  assert.deepEqual(validatePickupDate("2026-10-10", { nowIso: NOW, maxAheadDays: 10 }), { ok: true, sameDay: false });
  assert.deepEqual(validatePickupDate("2026-10-30", { nowIso: NOW, maxAheadDays: 10 }), { ok: false, reason: "too_far" });
});

test("malformed and impossible dates are invalid", () => {
  assert.deepEqual(validatePickupDate("07-10-2026", { nowIso: NOW }), { ok: false, reason: "invalid" });
  assert.deepEqual(validatePickupDate("2026-02-31", { nowIso: NOW }), { ok: false, reason: "invalid" });
});

test("the IST business day is used, not UTC, near midnight", () => {
  // 2026-10-07T19:30:00Z == 2026-10-08 01:00 IST. Same-day IST pickup is the 8th.
  const lateUtc = "2026-10-07T19:30:00Z";
  assert.deepEqual(validatePickupDate("2026-10-07", { nowIso: lateUtc }), { ok: false, reason: "past" });
  assert.deepEqual(validatePickupDate("2026-10-08", { nowIso: lateUtc }), { ok: true, sameDay: true });
});

// ------------------------------------------------------------------ admin buckets (§27, §28, §63)

test("Packed and Courier pickup are distinct ladder rungs with no shared status", () => {
  const packed = PROGRESS.find((s) => s.key === "packed")!;
  const pickup = PROGRESS.find((s) => s.key === "pickup")!;
  assert.deepEqual([...packed.statuses], ["PACKED"]);
  assert.deepEqual([...pickup.statuses], ["READY_FOR_PICKUP", "PICKUP_SCHEDULED"]);

  const seen = new Set<string>();
  for (const step of PROGRESS) {
    for (const status of step.statuses) {
      assert.equal(seen.has(status), false, `${status} appears in two ladder rungs`);
      seen.add(status);
    }
  }
});

test("a booked order (READY_FOR_PICKUP) reads as Courier pickup, not Packed (§27)", () => {
  assert.equal(fulfillmentLabel("READY_FOR_PICKUP", false), "Courier pickup");
  assert.equal(fulfillmentLabel("PICKUP_SCHEDULED", false), "Courier pickup");
  assert.equal(fulfillmentLabel("PACKED", false), "Packed");
  // READY_FOR_PICKUP now sits on the pickup rung, one step past packed.
  assert.equal(progressIndex("READY_FOR_PICKUP"), progressIndex("PICKUP_SCHEDULED"));
  assert.equal((progressIndex("READY_FOR_PICKUP") ?? 0) > (progressIndex("PACKED") ?? 0), true);
});
