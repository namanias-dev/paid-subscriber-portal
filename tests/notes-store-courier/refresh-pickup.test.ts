import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyPickupRefresh,
  type PickupRefreshIO,
  type RefreshShipment,
  type ShipmentPickupPatch,
  type PickupSyncEventInput,
  type PickupActor,
} from "../../lib/store/shipping/refreshPickup";

/** In-memory IO that records every write, so we can assert the audited order + values. */
function makeIO(opts: { orderMoves?: boolean } = {}) {
  const calls = {
    advance: [] as { from: string; to: string }[],
    patch: [] as { id: string; patch: ShipmentPickupPatch }[],
    events: [] as { orderId: string; input: PickupSyncEventInput; actor: PickupActor }[],
  };
  const io: PickupRefreshIO = {
    async advanceOrder(from, to) {
      calls.advance.push({ from, to });
      return opts.orderMoves ?? true;
    },
    async patchShipment(id, patch) {
      calls.patch.push({ id, patch });
    },
    async recordEvent(orderId, input, actor) {
      calls.events.push({ orderId, input, actor });
    },
  };
  return { io, calls };
}

const shipment = (over: Partial<RefreshShipment> = {}): RefreshShipment => ({
  id: "ship-1",
  provider: "shiprocket",
  awb: "AWB1",
  shipmentStatus: "manifested",
  trackingStatus: null,
  pickupStatusRaw: null,
  pickupState: "NOT_REQUESTED",
  active: true,
  ...over,
});

const actor: PickupActor = { id: "staff-1", name: "Ops" };
const fixedNow = () => "2026-10-07T12:00:00.000Z";

test("Delhivery booked-but-unscheduled order is advanced to READY_FOR_PICKUP with an audit event", async () => {
  const { io, calls } = makeIO();
  const out = await applyPickupRefresh(
    { id: "o1", status: "PACKED" },
    shipment({ provider: "delhivery", trackingStatus: "Not Picked" }),
    actor,
    io,
    fixedNow,
  );
  assert.equal(out.changed, true);
  assert.equal(out.orderStatus, "READY_FOR_PICKUP");
  assert.equal(out.basis, "booking_floor");
  assert.deepEqual(calls.advance, [{ from: "PACKED", to: "READY_FOR_PICKUP" }]);
  assert.equal(calls.patch.length, 1);
  assert.equal(calls.patch[0].patch.pickup_state, "REQUESTED");
  assert.equal(calls.patch[0].patch.pickup_status_source, "MANUAL_REFRESH");
  assert.equal(calls.patch[0].patch.pickup_last_synced_at, "2026-10-07T12:00:00.000Z");
  assert.equal(calls.events.length, 1);
  assert.equal(calls.events[0].input.toStatus, "READY_FOR_PICKUP");
  assert.equal(calls.events[0].actor.name, "Ops");
});

test('Shiprocket "Pickup Generated" order is advanced to PICKUP_SCHEDULED', async () => {
  const { io, calls } = makeIO();
  const out = await applyPickupRefresh(
    { id: "o2", status: "PACKED" },
    shipment({ trackingStatus: "Pickup Generated" }),
    actor,
    io,
    fixedNow,
  );
  assert.equal(out.orderStatus, "PICKUP_SCHEDULED");
  assert.equal(out.basis, "provider_signal");
  assert.deepEqual(calls.advance, [{ from: "PACKED", to: "PICKUP_SCHEDULED" }]);
  assert.equal(calls.patch[0].patch.pickup_state, "SCHEDULED");
});

test("a provider-cancelled shipment (Case B) returns to PACKED and supersedes the local shipment", async () => {
  const { io, calls } = makeIO();
  const out = await applyPickupRefresh(
    { id: "o3", status: "PICKUP_SCHEDULED" },
    shipment({ shipmentStatus: "cancelled", pickupState: "SCHEDULED" }),
    actor,
    io,
    fixedNow,
  );
  assert.equal(out.changed, true);
  assert.equal(out.orderStatus, "PACKED");
  assert.deepEqual(calls.advance, [{ from: "PICKUP_SCHEDULED", to: "PACKED" }]);
  assert.equal(calls.patch[0].patch.status, "cancelled");
  assert.equal(calls.patch[0].patch.pickup_cancelled_at, "2026-10-07T12:00:00.000Z");
});

test("a concurrent status change (stale) abandons the repair without writing the shipment", async () => {
  const { io, calls } = makeIO({ orderMoves: false });
  const out = await applyPickupRefresh(
    { id: "o4", status: "PACKED" },
    shipment({ trackingStatus: "Pickup Generated" }),
    actor,
    io,
    fixedNow,
  );
  assert.equal(out.changed, false);
  assert.equal(out.note, "stale");
  assert.equal(calls.advance.length, 1); // attempted
  assert.equal(calls.patch.length, 0); // but no shipment/event write
  assert.equal(calls.events.length, 0);
});

test("an already-correct order is a no-op: no order update, no shipment write, no event", async () => {
  const { io, calls } = makeIO();
  const out = await applyPickupRefresh(
    { id: "o5", status: "PICKUP_SCHEDULED" },
    shipment({ trackingStatus: "Pickup Generated", pickupState: "SCHEDULED" }),
    actor,
    io,
    fixedNow,
  );
  assert.equal(out.changed, false);
  assert.equal(calls.advance.length, 0);
  assert.equal(calls.patch.length, 0);
  assert.equal(calls.events.length, 0);
});

test("running the same refresh twice is idempotent (second run is a clean no-op)", async () => {
  const { io, calls } = makeIO();
  const order = { id: "o6", status: "PACKED" };
  const first = await applyPickupRefresh(order, shipment({ trackingStatus: "Pickup Generated" }), actor, io, fixedNow);
  assert.equal(first.changed, true);
  // After the first run the order is PICKUP_SCHEDULED and the shipment pickup_state SCHEDULED.
  const second = await applyPickupRefresh(
    { id: "o6", status: first.orderStatus },
    shipment({ trackingStatus: "Pickup Generated", pickupState: "SCHEDULED" }),
    actor,
    io,
    fixedNow,
  );
  assert.equal(second.changed, false);
  assert.equal(calls.advance.length, 1); // only the first run moved the order
});
