import test from "node:test";
import assert from "node:assert/strict";
import { buildOrderOps, opsIssue, rateShipmentFor, shippingRateStats } from "../../lib/store/orderOps";
import { opsLines } from "../../lib/store/orderOpsDisplay";
import { actionRequiredReasons, fulfillmentLabel, primaryAction } from "../../lib/store/adminConsole";
import { groupNotesCustomers, isCapturedNotesOrder } from "../../lib/store/customerGroups";
import { stageProgress, timelineFor } from "../../lib/store/opsBoard";
import { notesExecutiveStatus } from "../../lib/store/reporting";
import { PREPARATION_STATUSES, OPEN_PAID_STATUSES } from "../../lib/store/availability";
import { canAdvanceOrder } from "../../lib/store/shipping/status";
import { canRequestSupport } from "../../lib/store/shipping/dispatch";

const PICKUP_STATUSES = ["ORDER_CONFIRMED", "PROCESSING", "PRINTING", "READY_FOR_COLLECTION", "COLLECTED"];
const FORBIDDEN = /courier not selected|package required|awb|no active shipment|pickup overdue|address|tracking|compare couriers|shipment/i;

test("pickup rows never carry courier, package, rate or false issues", () => {
  for (const status of PICKUP_STATUSES) {
    const reasons = actionRequiredReasons({ status, method: "ACADEMY_PICKUP", awb: null, pickupFailed: false, addressMismatch: false, openIssue: false, cityConfirm: false, invoiceStatus: "READY" });
    assert.deepEqual(reasons, [], `${status} reasons`);
    const ops = buildOrderOps({
      status,
      method: "ACADEMY_PICKUP",
      readyAt: status === "READY_FOR_COLLECTION" || status === "COLLECTED" ? "2026-10-04T08:45:00Z" : null,
      collectedAt: status === "COLLECTED" ? "2026-10-06T06:10:00Z" : null,
      collectedBy: status === "COLLECTED" ? "Abhishek" : null,
      address: { city: "Mohali", state: "Punjab" },
      ship: null,
      cityConfirm: false,
      reasons,
      package: null,
    });
    assert.equal(ops.method, "ACADEMY_PICKUP");
    assert.equal(ops.courier, null);
    assert.equal(ops.rate_paise, null);
    assert.equal(ops.package, null);
    assert.equal(ops.courier_not_selected, false);
    assert.equal(ops.issue, null, `${status} issue`);
    assert.equal(ops.quote_history, null);
    assert.equal(ops.city, "Mohali");
    const lines = opsLines({ status, ops });
    assert.equal(lines.alert, null);
    assert.equal(lines.rate, null);
    assert.doesNotMatch(`${lines.headline} ${lines.detail || ""}`, FORBIDDEN, `${status} copy`);
    assert.ok(ops.stage, `${status} has a pickup stage`);
  }
});

test("pickup row copy: ready since, age, collected by", () => {
  const ready = buildOrderOps({ status: "READY_FOR_COLLECTION", method: "ACADEMY_PICKUP", readyAt: "2026-10-04T08:45:00Z", address: null, ship: null, cityConfirm: false, reasons: [], package: null });
  const lines = opsLines({ status: "READY_FOR_COLLECTION", ops: ready });
  assert.equal(lines.headline, "Ready for collection");
  assert.match(lines.detail || "", /^Ready since 4 Oct · 2:15 pm/);
  assert.equal(ready.next, "Hand over and mark collected");
  const done = buildOrderOps({ status: "COLLECTED", method: "ACADEMY_PICKUP", readyAt: "2026-10-04T08:45:00Z", collectedAt: "2026-10-06T06:10:00Z", collectedBy: "Abhishek", address: null, ship: null, cityConfirm: false, reasons: [], package: null });
  const doneLines = opsLines({ status: "COLLECTED", ops: done });
  assert.match(doneLines.headline, /^Collected 6 Oct · 11:40 am/);
  assert.equal(doneLines.detail, "by Abhishek");
  const printing = opsLines({ status: "PRINTING", ops: buildOrderOps({ status: "PRINTING", method: "ACADEMY_PICKUP", address: null, ship: null, cityConfirm: false, reasons: [], package: null }) });
  assert.equal(printing.detail, "Preparing for academy collection");
});

test("delivery rows are unchanged", () => {
  const packed = buildOrderOps({ status: "PACKED", address: { city: "Pune", state: "Maharashtra" }, ship: null, cityConfirm: false, reasons: ["No active shipment"], package: null });
  assert.equal(packed.method, "DELIVERY");
  assert.equal(packed.courier_not_selected, true);
  assert.equal(packed.issue, "Package required");
  assert.deepEqual(actionRequiredReasons({ status: "PACKED", awb: null }), ["No active shipment"]);
  assert.equal(primaryAction({ status: "PACKED", awb: null }), "compare");
  assert.equal(opsIssue({ reasons: [], packed: true, awb: null, package: null }), "Package required");
});

test("primary actions for pickup", () => {
  assert.equal(primaryAction({ status: "PRINTING", method: "ACADEMY_PICKUP" }), "ready");
  assert.equal(primaryAction({ status: "READY_FOR_COLLECTION", method: "ACADEMY_PICKUP" }), "collect");
  assert.equal(primaryAction({ status: "COLLECTED", method: "ACADEMY_PICKUP" }), "none");
  assert.equal(primaryAction({ status: "PAYMENT_PENDING", method: "ACADEMY_PICKUP" }), "reconcile");
});

test("labels: courier pickup vs customer collection", () => {
  assert.equal(fulfillmentLabel("PICKUP_SCHEDULED", false), "Courier pickup");
  assert.equal(fulfillmentLabel("READY_FOR_COLLECTION", false), "Ready for collection");
  assert.equal(fulfillmentLabel("COLLECTED", false), "Collected");
  assert.equal(fulfillmentLabel("PICKUP_SCHEDULED", true), "Courier pickup issue");
  assert.equal(stageProgress("PICKUP_SCHEDULED")?.label, "Courier pickup");
  assert.equal(stageProgress("READY_FOR_COLLECTION"), null, "collection is not on the delivery ladder");
  assert.equal(stageProgress("READY_FOR_COLLECTION", "ACADEMY_PICKUP")?.label, "Ready for collection");
  assert.equal(stageProgress("COLLECTED", "ACADEMY_PICKUP")?.final, true);
  assert.equal(timelineFor("ACADEMY_PICKUP").length, 5);
  assert.equal(timelineFor("DELIVERY").length, 9);
});

test("mixed-method customer: one group, both orders kept separately", () => {
  const orders = [
    { id: "a", order_no: "NIAS-N-1", status: "IN_TRANSIT", phone: "9876543210", paid_at: "2026-10-01T00:00:00Z", placed_at: "2026-10-01T00:00:00Z", fulfillment_method: "DELIVERY" },
    { id: "b", order_no: "NIAS-N-2", status: "READY_FOR_COLLECTION", phone: "+91 98765 43210", paid_at: "2026-10-03T00:00:00Z", placed_at: "2026-10-03T00:00:00Z", fulfillment_method: "ACADEMY_PICKUP" },
  ];
  const groups = groupNotesCustomers(orders);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].paid_count, 2);
  const byNo = new Map(groups[0].orders.map((o) => [o.order_no, o as (typeof orders)[number]]));
  assert.equal(byNo.get("NIAS-N-1")?.fulfillment_method, "DELIVERY");
  assert.equal(byNo.get("NIAS-N-2")?.fulfillment_method, "ACADEMY_PICKUP");
  assert.equal(isCapturedNotesOrder({ status: "COLLECTED", paid_at: "2026-10-03T00:00:00Z" }), true);
});

test("pickup orders never enter courier rate stats", () => {
  for (const status of PICKUP_STATUSES) {
    assert.equal(rateShipmentFor({ status, paid_at: "2026-10-01T00:00:00Z" }, []), null, status);
  }
  const stats = shippingRateStats([{ id: "p", status: "COLLECTED", paid_at: "2026-10-01T00:00:00Z" }], new Map());
  assert.equal(stats.count, 0);
  assert.equal(stats.unknown, 0, "pickup is not a missing courier rate");
});

test("reporting, ranks, preparation and support sets", () => {
  assert.equal(notesExecutiveStatus("READY_FOR_COLLECTION"), "ready_for_collection");
  assert.equal(notesExecutiveStatus("COLLECTED"), "collected");
  assert.equal((PREPARATION_STATUSES as readonly string[]).includes("READY_FOR_COLLECTION"), false, "ready pickup needs no more printing");
  assert.equal((OPEN_PAID_STATUSES as readonly string[]).includes("READY_FOR_COLLECTION"), true, "still open demand");
  assert.equal(canAdvanceOrder("COLLECTED", "IN_TRANSIT"), false, "terminal");
  assert.equal(canRequestSupport("COLLECTED"), true);
  assert.equal(canRequestSupport("READY_FOR_COLLECTION"), false);
});
