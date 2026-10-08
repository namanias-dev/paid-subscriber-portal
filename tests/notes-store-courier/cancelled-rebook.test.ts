import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getCurrentShipmentLabel,
  nextLabelAction,
  selectActiveShipment,
  shipmentEventMayMoveOrder,
} from "../../lib/store/shipping/activeShipment";
import { shipmentAlreadyActive } from "../../lib/store/shipping/dispatch";
import { bookSelectedCourier, printableShipment, type SelectedCreated } from "../../lib/store/shipping/manualBook";
import { normalizeCourierPickupStatus, reconcileCourierShipment } from "../../lib/store/shipping/pickup";
import {
  planRetiredShipmentOrder,
  reconcilePickupFromProvider,
  type PickupRefreshIO,
  type RefreshShipment,
  type ShipmentPickupPatch,
} from "../../lib/store/shipping/refreshPickup";
import { actionRequiredReasons, hasActiveShipment, primaryAction } from "../../lib/store/adminConsole";

function io(lookup?: () => Promise<string | null>) {
  const calls = { advance: [] as string[], patch: [] as ShipmentPickupPatch[] };
  const pickup: PickupRefreshIO = {
    async advanceOrder(from, to) {
      calls.advance.push(`${from}->${to}`);
      return true;
    },
    async patchShipment(_id, patch) {
      calls.patch.push(patch);
    },
    async recordEvent() {},
    lookupActiveId: lookup,
  };
  return { pickup, calls };
}

const active = (over: Partial<RefreshShipment> = {}): RefreshShipment => ({
  id: "ship-a",
  provider: "delhivery",
  awb: "A",
  shipmentStatus: "manifested",
  pickupState: "SCHEDULED",
  active: true,
  ...over,
});

const created = (awb: string, provider: "delhivery" | "shiprocket"): SelectedCreated => ({
  awb,
  labelUrl: `https://labels.example/${awb}.pdf`,
  providerOrderId: `order-${awb}`,
  providerShipmentId: `ship-${awb}`,
  courierName: provider === "delhivery" ? "Delhivery Surface" : "Shiprocket Surface",
  addressMismatch: false,
  unverified: false,
  possessed: false,
});

test("bare Cancelled is a full shipment cancellation, pickup-only is not", () => {
  for (const raw of ["Cancelled", "CANCELED", "Cancellation Requested"]) {
    const fact = normalizeCourierPickupStatus({ provider: "shiprocket", rawStatus: raw });
    assert.equal(fact.shipmentCancelled, true, raw);
  }
  const pickup = normalizeCourierPickupStatus({ provider: "delhivery", rawStatus: "Pickup Cancelled" });
  assert.equal(pickup.shipmentCancelled, false);
  assert.equal(pickup.pickupState, "CANCELLED");
});

test("full cancellation retires A, returns PACKED, and leaves the label non-current", async () => {
  const { pickup, calls } = io(async () => "ship-a");
  const out = await reconcilePickupFromProvider(
    { id: "order", status: "PICKUP_SCHEDULED" },
    active(),
    "Cancelled",
    null,
    { name: "delhivery" },
    pickup,
    "WEBHOOK",
  );
  assert.equal(out.orderStatus, "PACKED");
  assert.equal(calls.patch[0].status, "cancelled");
  assert.equal(calls.advance[0], "PICKUP_SCHEDULED->PACKED");
  const label = getCurrentShipmentLabel({
    shipments: [
      { id: "ship-a", status: "cancelled", awb: "A", label_url: "https://labels.example/A.pdf" },
    ],
  });
  assert.equal(label, null);
  assert.equal(selectActiveShipment([{ status: "cancelled", awb: "A" }]), null);
  assert.equal(primaryAction({ status: "PACKED", awb: null, shipmentRetired: true }), "compare");
  assert.ok(actionRequiredReasons({ status: "PACKED", awb: null, shipmentRetired: true }).includes("COURIER SELECTION REQUIRED"));
});

test("pickup-only cancellation stays READY_FOR_PICKUP with the same label current", async () => {
  const { pickup, calls } = io(async () => "ship-a");
  const out = await reconcilePickupFromProvider(
    { id: "order", status: "PICKUP_SCHEDULED" },
    active(),
    "Pickup Cancelled",
    null,
    { name: "delhivery" },
    pickup,
    "WEBHOOK",
  );
  assert.equal(out.orderStatus, "READY_FOR_PICKUP");
  assert.equal(calls.patch[0].status, undefined);
  assert.equal(calls.patch[0].pickup_state, "CANCELLED");
  const label = getCurrentShipmentLabel({
    shipments: [{ id: "ship-a", status: "manifested", awb: "A", label_url: "https://labels.example/A.pdf" }],
  });
  assert.equal(label?.labelUrl, "https://labels.example/A.pdf");
  assert.equal(primaryAction({ status: "READY_FOR_PICKUP", awb: "A", pickupState: "CANCELLED" }), "schedule_pickup");
  assert.ok(actionRequiredReasons({ status: "READY_FOR_PICKUP", awb: "A", pickupState: "CANCELLED" }).includes("PICKUP CANCELLED · ACTION REQUIRED"));
});

test("rebook after cancellation allows the same or a different provider and one active AWB", async () => {
  assert.equal(shipmentAlreadyActive("cancelled", "A"), false);
  assert.equal(hasActiveShipment("cancelled", "A"), false);
  let creates = 0;
  const book = (provider: "delhivery" | "shiprocket", awb: string) => bookSelectedCourier({
    selected: { provider, courier: provider, service: "Surface", courierId: null, ratePaise: 1000 },
    activeAwb: null,
    create: async () => {
      creates += 1;
      return created(awb, provider);
    },
    cancel: async () => true,
    requestPickup: async () => {},
  });
  const same = await book("delhivery", "B");
  const other = await book("shiprocket", "C");
  assert.equal(same.ok, true);
  assert.equal(same.awb, "B");
  assert.equal(other.awb, "C");
  assert.equal(creates, 2);
  const rows = [
    { status: "cancelled", awb: "A", label_url: "https://labels.example/A.pdf" },
    { status: "created", awb: "B", label_url: "https://labels.example/B.pdf" },
  ];
  assert.equal(selectActiveShipment([...rows].reverse())?.awb, "B");
  assert.equal(getCurrentShipmentLabel({ shipments: [...rows].reverse() })?.labelUrl, "https://labels.example/B.pdf");
  assert.equal(printableShipment(rows)?.awb, "B");
  const blocked = await bookSelectedCourier({
    selected: { provider: "delhivery", courier: "Delhivery", service: "Surface", courierId: null, ratePaise: 1000 },
    activeAwb: "B",
    create: async () => {
      creates += 1;
      return created("D", "delhivery");
    },
    cancel: async () => true,
    requestPickup: async () => {},
  });
  assert.equal(blocked.blocked, "EXISTING_AWB");
  assert.equal(creates, 2);
});

test("a repeated old-AWB cancellation does not move the replacement order", async () => {
  const { pickup, calls } = io(async () => "ship-b");
  const out = await reconcilePickupFromProvider(
    { id: "order", status: "READY_FOR_PICKUP" },
    active({ id: "ship-a", awb: "A" }),
    "Cancelled",
    null,
    { name: "delhivery" },
    pickup,
    "WEBHOOK",
  );
  assert.equal(out.orderStatus, "READY_FOR_PICKUP");
  assert.equal(calls.advance.length, 0);
  assert.equal(calls.patch[0].status, "cancelled");
  assert.equal(shipmentEventMayMoveOrder("ship-a", [
    { id: "ship-b", status: "created", awb: "B" },
    { id: "ship-a", status: "cancelled", awb: "A" },
  ]), false);
});

test("label failure keeps the new AWB and retry does not create another shipment", () => {
  const decision = nextLabelAction({ activeAwb: "B", hasStoredLabel: false, lastAttemptFailed: true });
  assert.deepEqual(decision, { action: "retry", createsShipment: false, createsAwb: false });
  const again = nextLabelAction({ activeAwb: "B", hasStoredLabel: false, lastAttemptFailed: false });
  assert.equal(again.action, "generate");
  assert.equal(again.createsAwb, false);
  const current = getCurrentShipmentLabel({
    shipments: [
      { status: "cancelled", awb: "A", label_url: "https://labels.example/A.pdf" },
      { status: "created", awb: "B", label_url: null },
    ],
  });
  assert.equal(current?.shipment.awb, "B");
  assert.equal(current?.labelUrl, null);
});

test("an order with only a retired AWB is repaired to PACKED and a live AWB is not", () => {
  assert.equal(planRetiredShipmentOrder({
    orderStatus: "PICKUP_SCHEDULED",
    rows: [{ status: "cancelled", awb: "A" }],
  }), "PACKED");
  assert.equal(planRetiredShipmentOrder({
    orderStatus: "READY_FOR_PICKUP",
    rows: [{ status: "cancelled", awb: "A" }, { status: "created", awb: "B" }],
  }), null);
  assert.equal(planRetiredShipmentOrder({
    orderStatus: "PACKED",
    rows: [{ status: "cancelled", awb: "A" }],
  }), null);
});

test("reconcile still ignores a fact applied to a non-active shipment", () => {
  const plan = reconcileCourierShipment(
    { status: "READY_FOR_PICKUP" },
    { awb: "B", active: true, pickupState: "REQUESTED" },
    { awb: "A", pickupState: "CANCELLED", shipmentCancelled: true },
  );
  assert.equal(plan.ignored, "awb_mismatch");
  assert.equal(plan.orderStatus, null);
});
