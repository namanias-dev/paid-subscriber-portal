import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildNotesStoreReport,
  isQualifyingNotesOrder,
  notesSubjectLabel,
  type NotesOrderInput,
} from "../../lib/store/reporting";
import { withNotesCash } from "../../lib/telegram/reports/businessFormat";
import { computeCollections, istDayWindow } from "../../lib/analytics/businessMetrics";
import type { Payment } from "../../lib/types";

const TODAY = istDayWindow("2026-09-26");
const YDAY = istDayWindow("2026-09-25");
const MTD = { fromMs: istDayWindow("2026-09-01").fromMs, toMs: TODAY.toMs };
const NOW = new Date("2026-09-26T06:30:00+05:30").getTime();

function order(partial: Partial<NotesOrderInput> & Pick<NotesOrderInput, "id" | "status">): NotesOrderInput {
  return {
    orderNo: `NIAS-N-2026-${partial.id}`,
    customerId: partial.id,
    subtotalPaise: 299900,
    discountPaise: 59980,
    shippingPaise: 5900,
    totalPaise: 245820,
    amountPaidPaise: 245820,
    amountRefundedPaise: 0,
    paidAt: "2026-09-25T20:00:00.000Z",
    shippedAt: null,
    deliveredAt: null,
    items: [{ name: "Indian Polity Notes", sku: "NOTES-POLITY", qty: 1 }],
    shipments: [],
    openIssues: [],
    ...partial,
  };
}

function report(orders: NotesOrderInput[]) {
  return buildNotesStoreReport({ orders, today: TODAY, yesterday: YDAY, mtd: MTD, nowMs: NOW });
}

describe("notes store executive metrics", () => {
  test("a paid polity order counts once, at the amount received", () => {
    const row = order({ id: "1", status: "ORDER_CONFIRMED", paidAt: "2026-09-26T02:00:00.000Z" });
    const m = report([row]);
    assert.equal(m.today.orders, 1);
    assert.equal(m.today.units, 1);
    assert.equal(m.today.customers, 1);
    assert.equal(m.today.cashRupees, 2458.2);
    assert.equal(m.today.subjects[0]?.label, "Indian Polity");
    assert.equal(m.today.subjects[0]?.units, 1);
    assert.notEqual(m.today.cashRupees, 2999);
    assert.equal(notesSubjectLabel("Indian Economy Notes"), "Indian Economy");
  });

  test("one order with two subjects is one order and two units", () => {
    const m = report([
      order({
        id: "2",
        status: "PACKED",
        paidAt: "2026-09-26T03:00:00.000Z",
        items: [
          { name: "Indian Polity Notes", sku: "NOTES-POLITY", qty: 1 },
          { name: "Indian Economy Notes", sku: "NOTES-ECONOMY", qty: 1 },
        ],
      }),
    ]);
    assert.equal(m.today.orders, 1);
    assert.equal(m.today.units, 2);
    assert.equal(m.today.subjects.find((s) => s.label === "Indian Polity")?.units, 1);
    assert.equal(m.today.subjects.find((s) => s.label === "Indian Economy")?.units, 1);
    assert.equal(m.fulfillment.packed, 1);
    assert.equal(m.fulfillment.toPack, 0);
  });

  test("failed and pending checkouts collect nothing", () => {
    const failed = order({ id: "f", status: "PAYMENT_FAILED", paidAt: null, amountPaidPaise: 0 });
    const pending = order({ id: "p", status: "PAYMENT_PENDING", paidAt: null, amountPaidPaise: 0 });
    assert.equal(isQualifyingNotesOrder(failed), false);
    assert.equal(isQualifyingNotesOrder(pending), false);
    const m = report([failed, pending]);
    assert.equal(m.today.orders, 0);
    assert.equal(m.today.cashRupees, 0);
    assert.equal(m.allTimeOrders, 0);
  });

  test("a duplicate order id is one order and one receipt", () => {
    const row = order({ id: "dup", status: "ORDER_CONFIRMED", paidAt: "2026-09-26T04:00:00.000Z" });
    const m = report([row, { ...row }]);
    assert.equal(m.today.orders, 1);
    assert.equal(m.today.cashRupees, 2458.2);
  });

  test("a test sku is excluded", () => {
    const m = report([
      order({
        id: "t",
        status: "ORDER_CONFIRMED",
        orderNo: "NIAS-N-2026-900001",
        items: [{ name: "TEST ONLY — Polity Notes", sku: "TEST-NOTES-POLITY-001", qty: 1 }],
        amountPaidPaise: 100,
        totalPaise: 100,
      }),
    ]);
    assert.equal(m.allTimeOrders, 0);
  });

  test("fulfillment states and RTO stay out of delivered", () => {
    const m = report([
      order({ id: "a", status: "ORDER_CONFIRMED" }),
      order({ id: "b", status: "PACKED", shipments: [{ provider: "shiprocket", status: "created", hasAwb: true, lastError: null }] }),
      order({ id: "c", status: "PICKUP_SCHEDULED" }),
      order({ id: "d", status: "IN_TRANSIT", shippedAt: "2026-09-26T01:00:00.000Z" }),
      order({ id: "e", status: "OUT_FOR_DELIVERY" }),
      order({ id: "f", status: "DELIVERED", deliveredAt: "2026-09-20T04:00:00.000Z" }),
      order({ id: "g", status: "RTO_INITIATED" }),
      order({
        id: "h",
        status: "PACKED",
        shipments: [{ provider: "shiprocket", status: "failed", hasAwb: false, lastError: "no courier" }],
        openIssues: [{ category: "ADDRESS_ISSUE" }],
      }),
    ]);
    assert.equal(m.fulfillment.toPack, 1);
    assert.equal(m.fulfillment.packed, 2);
    assert.equal(m.fulfillment.shipmentCreated, 1);
    assert.equal(m.fulfillment.inTransit, 1);
    assert.equal(m.fulfillment.outForDelivery, 1);
    assert.equal(m.fulfillment.delivered, 1);
    assert.equal(m.allTimeDelivered, 1);
    assert.equal(m.fulfillment.rto, 1);
    assert.equal(m.today.shipped, 1);
    assert.equal(m.today.delivered, 0);
    assert.ok(m.attention.some((row) => row.reason === "Address issue"));
    assert.equal(m.openOrders.some((row) => row.status === "delivered"), false);
  });

  test("an order paid yesterday and shipped today is not a new order today", () => {
    const m = report([
      order({
        id: "old",
        status: "IN_TRANSIT",
        paidAt: "2026-09-25T08:00:00.000Z",
        shippedAt: "2026-09-26T02:30:00.000Z",
      }),
    ]);
    assert.equal(m.today.orders, 0);
    assert.equal(m.yesterday.orders, 1);
    assert.equal(m.today.shipped, 1);
    assert.equal(m.yesterday.cashRupees, 2458.2);
  });

  test("notes cash is added once to online collection and the receipt mix", () => {
    const academy = computeCollections(
      [
        {
          id: "course",
          phone: "9000000001",
          amount: 2000,
          status: "PAID",
          payment_kind: "full",
          item_type: "course",
          gateway: "ICICI_EAZYPAY",
          created_at: "2026-09-26T02:00:00.000Z",
        } as Payment,
      ],
      TODAY,
      new Set(),
    );
    const merged = withNotesCash(academy, 2458.2);
    assert.equal(merged.netCollection, 4458.2);
    assert.equal(merged.sources.find((s) => s.key === "online")?.amount, 4458.2);
    assert.equal(merged.sources.find((s) => s.key === "manual")?.amount, 0);
    const purpose = merged.categories.reduce((sum, row) => sum + row.amount, 0) + 2458.2;
    const sources = merged.sources.reduce((sum, row) => sum + row.amount, 0);
    assert.equal(purpose, merged.grossCollection);
    assert.equal(sources, merged.grossCollection);
    assert.equal(merged.successfulPayments, 1);
  });
});
