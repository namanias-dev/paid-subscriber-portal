import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deliverNotesOrderPaidAlert } from "../../lib/telegram/notesOrderAlert";
import {
  formatNotesOrderAlertHtml,
  notesOrdersNeedingAlert,
  notesOrdersNeedingBaselineSkip,
  notesPaidAlertCounts,
  shouldFireNotesPaidAlert,
  type NotesAlertOrder,
} from "../../lib/telegram/notesOrderAlertFormat";

const NOW = Date.parse("2026-09-27T05:02:00.000Z");
const PAID = "2026-09-27T05:02:00.000Z";

const HISTORICAL: NotesAlertOrder = {
  id: "ord-1001",
  orderNo: "NIAS-N-2026-001001",
  status: "IN_TRANSIT",
  paidAt: "2026-09-24T00:45:11.044Z",
  amountPaidPaise: 245820,
  items: [{ name: "Indian Polity Notes", sku: "NOTES-POLITY", qty: 1 }],
};

function order(partial: Partial<NotesAlertOrder> & Pick<NotesAlertOrder, "id" | "orderNo">): NotesAlertOrder {
  return {
    status: "ORDER_CONFIRMED",
    paidAt: PAID,
    amountPaidPaise: 245820,
    items: [{ name: "Indian Polity Notes", sku: "NOTES-POLITY", qty: 1 }],
    ...partial,
  };
}

function memory(orders: NotesAlertOrder[], opts?: { failTimes?: number; throwSend?: boolean }) {
  const box = new Map<string, { status: string; attempts: number; html: string | null; lastError: string | null; messageId: number | null; updatedAt: string }>();
  let cutoff: string | null = null;
  const sends: string[] = [];
  let failuresLeft = opts?.failTimes ?? 0;
  const deps = {
    now: () => NOW,
    sleep: async () => {},
    backoffs: [0],
    readCutoff: async () => cutoff,
    insertCutoff: async (iso: string) => {
      if (cutoff) return false;
      cutoff = iso;
      return true;
    },
    loadOrders: async () => orders,
    getOutbox: async (orderId: string) => box.get(orderId) || null,
    saveOutbox: async (row: {
      orderId: string;
      status: string;
      attempts: number;
      html: string | null;
      lastError: string | null;
      messageId: number | null;
      updatedAt: string;
    }) => {
      box.set(row.orderId, row);
    },
    send: async (html: string) => {
      if (opts?.throwSend) throw new Error("telegram_down");
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        return { ok: false, messageId: null, error: "telegram_down" };
      }
      sends.push(html);
      return { ok: true, messageId: 501, error: null };
    },
  };
  return { deps, sends, box };
}

describe("notes paid-order telegram alert", () => {
  test("polity order alerts once with the captured amount and running total", async () => {
    const polity = order({ id: "ord-1002", orderNo: "NIAS-N-2026-001002" });
    const harness = memory([HISTORICAL, polity]);
    const result = await deliverNotesOrderPaidAlert(
      { orderId: polity.id, orderNo: polity.orderNo, amountPaise: 245820, paidAt: PAID },
      harness.deps,
    );
    assert.equal(result, "sent");
    assert.equal(harness.sends.length, 1);
    const html = harness.sends[0]!;
    assert.match(html, /NEW NOTES ORDER/);
    assert.match(html, /#2 · NIAS-N-2026-001002/);
    assert.match(html, /Indian Polity/);
    assert.match(html, /₹2,458\.20/);
    assert.doesNotMatch(html, /2,999/);
    assert.match(html, /27 Sep · 10:32 AM IST/);
    assert.match(html, /Today: <b>1 order<\/b> · Total: <b>2<\/b>/);
    assert.equal(harness.box.get(HISTORICAL.id)?.status, "skipped");
    assert.equal(harness.box.get(HISTORICAL.id)?.lastError, "pre_existing");
  });

  test("economy order names the subject and the receipt", async () => {
    const economy = order({
      id: "ord-1003",
      orderNo: "NIAS-N-2026-001003",
      amountPaidPaise: 299900,
      items: [{ name: "Indian Economy Notes", sku: "NOTES-ECONOMY", qty: 1 }],
    });
    const harness = memory([HISTORICAL, economy]);
    const result = await deliverNotesOrderPaidAlert(
      { orderId: economy.id, orderNo: economy.orderNo, amountPaise: 299900, paidAt: PAID },
      harness.deps,
    );
    assert.equal(result, "sent");
    assert.equal(harness.sends.length, 1);
    assert.match(harness.sends[0]!, /Indian Economy/);
    assert.match(harness.sends[0]!, /Paid <b>₹2,999<\/b>/);
    assert.match(harness.sends[0]!, /NIAS-N-2026-001003/);
  });

  test("multi-item order lists both subjects and unit count in one alert", async () => {
    const multi = order({
      id: "ord-1004",
      orderNo: "NIAS-N-2026-001004",
      amountPaidPaise: 545800,
      items: [
        { name: "Indian Polity Notes", sku: "NOTES-POLITY", qty: 1 },
        { name: "Indian Economy Notes", sku: "NOTES-ECONOMY", qty: 1 },
      ],
    });
    const harness = memory([multi]);
    const result = await deliverNotesOrderPaidAlert(
      { orderId: multi.id, orderNo: multi.orderNo, amountPaise: 545800, paidAt: PAID },
      harness.deps,
    );
    assert.equal(result, "sent");
    assert.equal(harness.sends.length, 1);
    assert.match(harness.sends[0]!, /Indian Polity \+ Indian Economy/);
    assert.match(harness.sends[0]!, /2 units · Paid <b>₹5,458<\/b>/);
    const counts = notesPaidAlertCounts([multi], multi.id, PAID);
    assert.deepEqual(counts, { sequence: 1, total: 1, today: 1 });
  });

  test("quantity above one is visible", () => {
    const html = formatNotesOrderAlertHtml({
      orderNo: "NIAS-N-2026-001005",
      sequence: 3,
      items: [
        { name: "Indian Polity Notes", qty: 2 },
        { name: "Indian Economy Notes", qty: 1 },
      ],
      paidPaise: 545820,
      paidAt: PAID,
      todayCount: 2,
      totalCount: 3,
    });
    assert.match(html, /Indian Polity ×2 \+ Indian Economy/);
    assert.match(html, /3 units · Paid/);
  });

  test("pending and failed payments do not qualify and do not fire", () => {
    assert.equal(shouldFireNotesPaidAlert({ outcome: "unknown", transitioned: false }), false);
    assert.equal(shouldFireNotesPaidAlert({ outcome: "failed", transitioned: true }), false);
    assert.equal(shouldFireNotesPaidAlert({ outcome: "expired", transitioned: true }), false);
    assert.equal(shouldFireNotesPaidAlert({ outcome: "paid", transitioned: false }), false);
    assert.equal(shouldFireNotesPaidAlert({ outcome: "paid", transitioned: true }), true);
    const pending = order({ id: "p", orderNo: "NIAS-N-2026-001090", status: "PAYMENT_PENDING", paidAt: null });
    const failed = order({ id: "f", orderNo: "NIAS-N-2026-001091", status: "PAYMENT_FAILED", paidAt: null });
    const paid = order({ id: "ok", orderNo: "NIAS-N-2026-001002" });
    assert.deepEqual(notesPaidAlertCounts([pending, failed, paid], paid.id, PAID), { sequence: 1, total: 1, today: 1 });
  });

  test("duplicate delivery sends one telegram message", async () => {
    const polity = order({ id: "ord-1002", orderNo: "NIAS-N-2026-001002" });
    const harness = memory([polity]);
    const input = { orderId: polity.id, orderNo: polity.orderNo, amountPaise: 245820, paidAt: PAID };
    assert.equal(await deliverNotesOrderPaidAlert(input, harness.deps), "sent");
    assert.equal(await deliverNotesOrderPaidAlert(input, harness.deps), "duplicate");
    assert.equal(harness.sends.length, 1);
  });

  test("a fresh in-flight claim is not sent again", async () => {
    const polity = order({ id: "ord-1002", orderNo: "NIAS-N-2026-001002" });
    const harness = memory([polity]);
    harness.box.set(polity.id, {
      status: "pending",
      attempts: 1,
      html: "already",
      lastError: null,
      messageId: null,
      updatedAt: new Date(NOW).toISOString(),
    });
    const result = await deliverNotesOrderPaidAlert(
      { orderId: polity.id, orderNo: polity.orderNo, amountPaise: 245820, paidAt: PAID },
      harness.deps,
    );
    assert.equal(result, "busy");
    assert.equal(harness.sends.length, 0);
  });

  test("telegram failure does not throw and a later retry sends once", async () => {
    const polity = order({ id: "ord-1002", orderNo: "NIAS-N-2026-001002" });
    const harness = memory([polity], { failTimes: 1 });
    const input = { orderId: polity.id, orderNo: polity.orderNo, amountPaise: 245820, paidAt: PAID };
    assert.equal(await deliverNotesOrderPaidAlert(input, harness.deps), "failed");
    assert.equal(harness.box.get(polity.id)?.status, "failed");
    assert.equal(harness.sends.length, 0);
    assert.equal(await deliverNotesOrderPaidAlert(input, harness.deps), "sent");
    assert.equal(harness.sends.length, 1);
    assert.match(harness.sends[0]!, /₹2,458\.20/);
  });

  test("a throwing telegram client is contained", async () => {
    const polity = order({ id: "ord-1002", orderNo: "NIAS-N-2026-001002" });
    const harness = memory([polity], { throwSend: true });
    const result = await deliverNotesOrderPaidAlert(
      { orderId: polity.id, orderNo: polity.orderNo, amountPaise: 245820, paidAt: PAID },
      harness.deps,
    );
    assert.equal(result, "failed");
    assert.equal(harness.sends.length, 0);
  });

  test("historical order NIAS-N-2026-001001 is not alerted", async () => {
    const harness = memory([HISTORICAL]);
    const result = await deliverNotesOrderPaidAlert(
      {
        orderId: HISTORICAL.id,
        orderNo: HISTORICAL.orderNo,
        amountPaise: 245820,
        paidAt: HISTORICAL.paidAt!,
      },
      harness.deps,
    );
    assert.equal(result, "skipped");
    assert.equal(harness.sends.length, 0);
    assert.equal(harness.box.get(HISTORICAL.id)?.lastError, "pre_existing");
    const cutoff = Date.parse("2026-09-27T05:02:00.000Z");
    assert.deepEqual(notesOrdersNeedingBaselineSkip([HISTORICAL], cutoff), [HISTORICAL.id]);
    assert.deepEqual(notesOrdersNeedingAlert([HISTORICAL], new Map(), cutoff), []);
  });

  test("receipt uses captured paise, not catalogue subtotal", () => {
    const html = formatNotesOrderAlertHtml({
      orderNo: "NIAS-N-2026-001002",
      sequence: 2,
      items: [{ name: "Indian Polity Notes", qty: 1 }],
      paidPaise: 245820,
      paidAt: PAID,
      todayCount: 1,
      totalCount: 2,
    });
    assert.match(html, /Paid <b>₹2,458\.20<\/b>/);
    assert.doesNotMatch(html, /2,999/);
    assert.doesNotMatch(html, /599/);
  });

  test("subject text cannot break HTML", () => {
    const html = formatNotesOrderAlertHtml({
      orderNo: "NIAS-N-2026-001002",
      sequence: 1,
      items: [{ name: "Polity <script> Notes", qty: 1 }],
      paidPaise: 100,
      paidAt: PAID,
      todayCount: 1,
      totalCount: 1,
    });
    assert.match(html, /Polity &lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
  });

  test("test SKU orders are not sent", async () => {
    const testOrder = order({
      id: "qa",
      orderNo: "NIAS-N-2026-900001",
      items: [{ name: "TEST ONLY — Polity Notes", sku: "TEST-NOTES-POLITY-001", qty: 1 }],
    });
    const harness = memory([testOrder]);
    const result = await deliverNotesOrderPaidAlert(
      { orderId: testOrder.id, orderNo: testOrder.orderNo, amountPaise: 100, paidAt: PAID },
      harness.deps,
    );
    assert.equal(result, "skipped");
    assert.equal(harness.sends.length, 0);
    assert.equal(harness.box.get(testOrder.id)?.lastError, "test_order");
  });
});
