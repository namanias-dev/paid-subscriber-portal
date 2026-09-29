import assert from "node:assert/strict";
import test from "node:test";
import { cancellationConfirmed, rollbackDecision } from "../../lib/store/shipping/rollbackAuto";

const safe = {
  orderNo: "NIAS-N-2026-001030",
  orderStatus: "PICKUP_SCHEDULED",
  awb: "90680216572",
  shipStatus: "manifested",
  pickedUpAt: null,
  trackingStatus: "Pickup Scheduled",
  trackingError: null,
  activities: ["Manifested"],
};

test("pre-possession pickup scheduled can be cancelled", () => {
  assert.deepEqual(rollbackDecision(safe), { action: "cancel" });
});

test("a possession scan blocks rollback", () => {
  assert.equal(rollbackDecision({ ...safe, pickedUpAt: "2026-09-29T06:26:00Z" }).action, "block");
  assert.equal(rollbackDecision({ ...safe, trackingStatus: "Picked Up", activities: ["Picked Up"] }).reason, "POSSESSION");
  assert.equal(rollbackDecision({ ...safe, activities: ["In Transit"] }).reason, "POSSESSION");
});

test("another order or a manual awb is out of scope", () => {
  assert.equal(rollbackDecision({ ...safe, orderNo: "NIAS-N-2026-001023" }).reason, "ORDER_NOT_IN_SCOPE");
  assert.equal(rollbackDecision({ ...safe, awb: "14112362721497" }).reason, "AWB_MISMATCH");
});

test("an unreadable tracking response does not cancel", () => {
  assert.equal(rollbackDecision({ ...safe, trackingStatus: null, trackingError: "Shiprocket tracking was not read." }).reason, "TRACKING_UNCONFIRMED");
  assert.equal(cancellationConfirmed("CANCELED"), true);
  assert.equal(cancellationConfirmed("PICKUP SCHEDULED"), false);
  assert.equal(cancellationConfirmed(null), false);
});
