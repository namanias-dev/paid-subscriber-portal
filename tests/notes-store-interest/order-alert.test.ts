import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deliverNotesOrderPaidAlert, replayNotesOrderUpdatedAlert } from "../../lib/telegram/notesOrderAlert";
import {
  formatNotesAlertPhone,
  formatNotesOrderAlertHtml,
  formatNotesSubjectLine,
  notesOrderPaidLegacySlot,
  notesOrderPaidSlot,
  notesOrderReplaySlot,
  notesOrdersNeedingAlert,
  notesOrdersNeedingBaselineSkip,
  notesPaidAlertCounts,
  resolveNotesAlertCustomer,
  salesAdmissionsTitleMatches,
  shouldFireNotesPaidAlert,
  type NotesAlertCustomer,
  type NotesAlertDestination,
  type NotesAlertOrder,
} from "../../lib/telegram/notesOrderAlertFormat";

const NOW = Date.parse("2026-09-27T05:02:00.000Z");
const PAID = "2026-09-27T05:02:00.000Z";
const CUSTOMER: NotesAlertCustomer = { name: "Rahul Sharma", phone: "+91 98765 43210", city: "Delhi" };

const HISTORICAL: NotesAlertOrder = {
  id: "ord-1001",
  orderNo: "NIAS-N-2026-001001",
  status: "DELIVERED",
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

function memory(
  orders: NotesAlertOrder[],
  opts?: {
    fail?: Partial<Record<NotesAlertDestination, number>>;
    throwSend?: boolean;
    customer?: NotesAlertCustomer;
  },
) {
  const box = new Map<string, { slotKey: string; status: string; attempts: number; html: string | null; lastError: string | null; messageId: number | null; updatedAt: string; orderId: string }>();
  let cutoff: string | null = null;
  const sends: { destination: NotesAlertDestination; html: string }[] = [];
  const fails = { executive: opts?.fail?.executive ?? 0, sales_admissions: opts?.fail?.sales_admissions ?? 0 };
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
    loadCustomer: async () => opts?.customer || CUSTOMER,
    getOutbox: async (slotKey: string) => box.get(slotKey) || null,
    saveOutbox: async (row: {
      slotKey: string;
      orderId: string;
      status: string;
      attempts: number;
      html: string | null;
      lastError: string | null;
      messageId: number | null;
      updatedAt: string;
    }) => {
      box.set(row.slotKey, row);
    },
    send: async (destination: NotesAlertDestination, html: string) => {
      if (opts?.throwSend) throw new Error("telegram_down");
      if (fails[destination] > 0) {
        fails[destination] -= 1;
        return { ok: false, messageId: null, error: "telegram_down" };
      }
      sends.push({ destination, html });
      return { ok: true, messageId: destination === "executive" ? 1101 : 2202, error: null };
    },
    listFailed: async () => [],
    readReplayRequest: async () => null,
    saveReplayRequest: async () => {},
  };
  return { deps, sends, box };
}

function htmlFor(sends: { destination: NotesAlertDestination; html: string }[], destination: NotesAlertDestination) {
  return sends.filter((send) => send.destination === destination).map((send) => send.html);
}

describe("notes paid-order telegram alert", () => {
  test("a paid polity order alerts both channels once", async () => {
    const polity = order({ id: "ord-1002", orderNo: "NIAS-N-2026-001002" });
    const harness = memory([HISTORICAL, polity]);
    const result = await deliverNotesOrderPaidAlert(
      { orderId: polity.id, orderNo: polity.orderNo, amountPaise: 245820, paidAt: PAID },
      harness.deps,
    );
    assert.equal(result.executive, "sent");
    assert.equal(result.sales_admissions, "sent");
    assert.equal(htmlFor(harness.sends, "executive").length, 1);
    assert.equal(htmlFor(harness.sends, "sales_admissions").length, 1);
    for (const html of harness.sends.map((send) => send.html)) {
      assert.match(html, /NEW NOTES ORDER/);
      assert.match(html, /#2 · NIAS-N-2026-001002/);
      assert.match(html, /📚 <b>Indian Polity<\/b>/);
      assert.match(html, /₹2,458\.20/);
      assert.match(html, /Rahul Sharma/);
      assert.match(html, /\+91 98765 43210/);
      assert.match(html, /Delhi/);
      assert.doesNotMatch(html, /2,999/);
      assert.match(html, /<b>Today:<\/b> 1 order · <b>Total:<\/b> 2/);
    }
    assert.equal(harness.box.get(notesOrderPaidSlot(HISTORICAL.id, "sales_admissions"))?.status, "skipped");
    assert.equal(harness.box.get(notesOrderPaidSlot(HISTORICAL.id, "executive"))?.lastError, "pre_existing");
  });

  test("customer name, phone and city render on both channels", async () => {
    const economy = order({
      id: "ord-1003",
      orderNo: "NIAS-N-2026-001003",
      amountPaidPaise: 299900,
      items: [{ name: "Indian Economy Notes", sku: "NOTES-ECONOMY", qty: 1 }],
    });
    const harness = memory([economy], { customer: { name: "Rahul Sharma", phone: "+91 98765 43210", city: "Delhi" } });
    const result = await deliverNotesOrderPaidAlert(
      { orderId: economy.id, orderNo: economy.orderNo, amountPaise: 299900, paidAt: PAID },
      harness.deps,
    );
    assert.equal(result.executive, "sent");
    assert.equal(result.sales_admissions, "sent");
    assert.equal(harness.sends.length, 2);
    for (const send of harness.sends) {
      assert.match(send.html, /Indian Economy/);
      assert.match(send.html, /Paid <b>₹2,999<\/b>/);
      assert.match(send.html, /Rahul Sharma/);
      assert.match(send.html, /Delhi/);
    }
  });

  test("a missing city still sends as Not available", () => {
    const resolved = resolveNotesAlertCustomer({
      shippingName: "Rahul Sharma",
      shippingPhone: "9876543210",
      country: "IN",
      city: "  ",
    });
    assert.equal(resolved.city, "Not available");
    assert.equal(resolved.phone, "+91 98765 43210");
    const html = formatNotesOrderAlertHtml({
      orderNo: "NIAS-N-2026-001002",
      sequence: 2,
      items: [{ name: "Indian Polity Notes", qty: 1 }],
      paidPaise: 245820,
      paidAt: PAID,
      todayCount: 1,
      totalCount: 2,
      customer: resolved,
    });
    assert.match(html, /City:<\/b> Not available/);
    assert.doesNotMatch(html, /undefined/);
    assert.doesNotMatch(html, /null/);
  });

  test("customer text is escaped for Telegram HTML", () => {
    const html = formatNotesOrderAlertHtml({
      orderNo: "NIAS-N-2026-001002",
      sequence: 1,
      items: [{ name: "Polity <script> Notes", qty: 1 }],
      paidPaise: 100,
      paidAt: PAID,
      todayCount: 1,
      totalCount: 1,
      customer: { name: "Aman & Sons", phone: "9876543210", city: "Delhi <North>" },
    });
    assert.match(html, /Aman &amp; Sons/);
    assert.match(html, /Delhi &lt;North&gt;/);
    assert.match(html, /Polity &lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.equal(salesAdmissionsTitleMatches("Naman IAS — Sales & Admissions"), true);
    assert.equal(salesAdmissionsTitleMatches("Naman IAS - Sales & Admissions"), true);
    assert.equal(salesAdmissionsTitleMatches("Some other chat"), false);
  });

  test("a multi-subject order is one alert per channel", async () => {
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
    assert.equal(result.executive, "sent");
    assert.equal(result.sales_admissions, "sent");
    assert.equal(harness.sends.length, 2);
    assert.equal(formatNotesSubjectLine(multi.items).units, 2);
    assert.deepEqual(notesPaidAlertCounts([multi], multi.id, PAID), { sequence: 1, total: 1, today: 1 });
    for (const send of harness.sends) assert.match(send.html, /Indian Polity \+ Indian Economy/);
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
      customer: CUSTOMER,
    });
    assert.match(html, /Indian Polity ×2 \+ Indian Economy/);
  });

  test("captured paise is shown, not the catalogue price", () => {
    const html = formatNotesOrderAlertHtml({
      orderNo: "NIAS-N-2026-001002",
      sequence: 2,
      items: [{ name: "Indian Polity Notes", qty: 1 }],
      paidPaise: 245820,
      paidAt: PAID,
      todayCount: 1,
      totalCount: 2,
      customer: CUSTOMER,
    });
    assert.match(html, /Paid <b>₹2,458\.20<\/b>/);
    assert.doesNotMatch(html, /2,999/);
  });

  test("pending and failed payments do not fire", () => {
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

  test("duplicate verification sends one message per channel", async () => {
    const polity = order({ id: "ord-1002", orderNo: "NIAS-N-2026-001002" });
    const harness = memory([polity]);
    const input = { orderId: polity.id, orderNo: polity.orderNo, amountPaise: 245820, paidAt: PAID };
    assert.equal((await deliverNotesOrderPaidAlert(input, harness.deps)).executive, "sent");
    const second = await deliverNotesOrderPaidAlert(input, harness.deps);
    assert.equal(second.executive, "duplicate");
    assert.equal(second.sales_admissions, "duplicate");
    assert.equal(htmlFor(harness.sends, "executive").length, 1);
    assert.equal(htmlFor(harness.sends, "sales_admissions").length, 1);
  });

  test("an in-flight claim is not sent again", async () => {
    const polity = order({ id: "ord-1002", orderNo: "NIAS-N-2026-001002" });
    const harness = memory([polity]);
    for (const destination of ["executive", "sales_admissions"] as const) {
      harness.box.set(notesOrderPaidSlot(polity.id, destination), {
        slotKey: notesOrderPaidSlot(polity.id, destination),
        orderId: polity.id,
        status: "pending",
        attempts: 1,
        html: "already",
        lastError: null,
        messageId: null,
        updatedAt: new Date(NOW).toISOString(),
      });
    }
    const result = await deliverNotesOrderPaidAlert(
      { orderId: polity.id, orderNo: polity.orderNo, amountPaise: 245820, paidAt: PAID },
      harness.deps,
    );
    assert.equal(result.executive, "busy");
    assert.equal(result.sales_admissions, "busy");
    assert.equal(harness.sends.length, 0);
  });

  test("executive success does not resend when sales is retried", async () => {
    const polity = order({ id: "ord-1002", orderNo: "NIAS-N-2026-001002" });
    const harness = memory([polity], { fail: { sales_admissions: 1 } });
    const input = { orderId: polity.id, orderNo: polity.orderNo, amountPaise: 245820, paidAt: PAID };
    const first = await deliverNotesOrderPaidAlert(input, harness.deps);
    assert.equal(first.executive, "sent");
    assert.equal(first.sales_admissions, "failed");
    assert.equal(htmlFor(harness.sends, "executive").length, 1);
    const second = await deliverNotesOrderPaidAlert(input, harness.deps);
    assert.equal(second.executive, "duplicate");
    assert.equal(second.sales_admissions, "sent");
    assert.equal(htmlFor(harness.sends, "executive").length, 1);
    assert.equal(htmlFor(harness.sends, "sales_admissions").length, 1);
  });

  test("sales success does not resend when executive is retried", async () => {
    const polity = order({ id: "ord-1002", orderNo: "NIAS-N-2026-001002" });
    const harness = memory([polity], { fail: { executive: 1 } });
    const input = { orderId: polity.id, orderNo: polity.orderNo, amountPaise: 245820, paidAt: PAID };
    const first = await deliverNotesOrderPaidAlert(input, harness.deps);
    assert.equal(first.executive, "failed");
    assert.equal(first.sales_admissions, "sent");
    const second = await deliverNotesOrderPaidAlert(input, harness.deps);
    assert.equal(second.executive, "sent");
    assert.equal(second.sales_admissions, "duplicate");
    assert.equal(htmlFor(harness.sends, "executive").length, 1);
    assert.equal(htmlFor(harness.sends, "sales_admissions").length, 1);
  });

  test("both destinations failing leaves the paid order untouched", async () => {
    const polity = order({ id: "ord-1002", orderNo: "NIAS-N-2026-001002" });
    const harness = memory([polity], { throwSend: true });
    const orderState = { status: "ORDER_CONFIRMED", amountPaidPaise: 245820 };
    const result = await deliverNotesOrderPaidAlert(
      { orderId: polity.id, orderNo: polity.orderNo, amountPaise: orderState.amountPaidPaise, paidAt: PAID },
      harness.deps,
    );
    assert.equal(result.executive, "failed");
    assert.equal(result.sales_admissions, "failed");
    assert.equal(orderState.status, "ORDER_CONFIRMED");
    assert.equal(orderState.amountPaidPaise, 245820);
    assert.equal(harness.sends.length, 0);
  });

  test("a historical order is not alerted", async () => {
    const harness = memory([HISTORICAL]);
    const result = await deliverNotesOrderPaidAlert(
      { orderId: HISTORICAL.id, orderNo: HISTORICAL.orderNo, amountPaise: 245820, paidAt: HISTORICAL.paidAt! },
      harness.deps,
    );
    assert.equal(result.executive, "skipped");
    assert.equal(result.sales_admissions, "skipped");
    assert.equal(harness.sends.length, 0);
    const cutoff = Date.parse("2026-09-27T05:02:00.000Z");
    assert.deepEqual(notesOrdersNeedingBaselineSkip([HISTORICAL], cutoff), [HISTORICAL.id]);
    assert.deepEqual(notesOrdersNeedingAlert([HISTORICAL], new Map(), cutoff), []);
  });

  test("an already-sent legacy alert is not sent again, including to sales", async () => {
    const paid = order({ id: "ord-1002", orderNo: "NIAS-N-2026-001002" });
    const harness = memory([paid]);
    harness.box.set(notesOrderPaidLegacySlot(paid.id), {
      slotKey: notesOrderPaidLegacySlot(paid.id),
      orderId: paid.id,
      status: "sent",
      attempts: 1,
      html: "original",
      lastError: null,
      messageId: 1836,
      updatedAt: new Date(NOW).toISOString(),
    });
    const result = await deliverNotesOrderPaidAlert(
      { orderId: paid.id, orderNo: paid.orderNo, amountPaise: 245820, paidAt: PAID },
      harness.deps,
    );
    assert.equal(result.executive, "duplicate");
    assert.equal(result.sales_admissions, "skipped");
    assert.equal(harness.sends.length, 0);
    assert.equal(harness.box.get(notesOrderPaidLegacySlot(paid.id))?.status, "sent");
    assert.equal(harness.box.get(notesOrderPaidLegacySlot(paid.id))?.messageId, 1836);
  });

  test("manual replay of order 001002 sends one updated alert per channel and keeps the legacy row", async () => {
    const paid = order({ id: "ord-1002", orderNo: "NIAS-N-2026-001002", paidAt: "2026-09-27T05:40:43.013Z" });
    const harness = memory([HISTORICAL, paid], { customer: { name: "Rahul Sharma", phone: "+91 98765 43210", city: "Chandigarh" } });
    harness.box.set(notesOrderPaidLegacySlot(paid.id), {
      slotKey: notesOrderPaidLegacySlot(paid.id),
      orderId: paid.id,
      status: "sent",
      attempts: 1,
      html: "original",
      lastError: null,
      messageId: 1836,
      updatedAt: "2026-09-27T05:41:00.000Z",
    });
    const result = await replayNotesOrderUpdatedAlert(paid.orderNo, harness.deps);
    assert.equal(result.executive, "sent");
    assert.equal(result.sales_admissions, "sent");
    assert.equal(harness.sends.length, 2);
    for (const send of harness.sends) {
      assert.match(send.html, /NOTES ORDER — UPDATED ALERT/);
      assert.match(send.html, /#2 · NIAS-N-2026-001002/);
      assert.match(send.html, /<b>Total Notes Orders:<\/b> 2/);
      assert.doesNotMatch(send.html, /Today:/);
      assert.match(send.html, /Chandigarh/);
    }
    assert.equal(harness.box.get(notesOrderPaidLegacySlot(paid.id))?.status, "sent");
    assert.equal(harness.box.get(notesOrderPaidLegacySlot(paid.id))?.messageId, 1836);
    assert.equal(harness.box.get(notesOrderPaidLegacySlot(paid.id))?.html, "original");
    assert.equal(harness.box.get(notesOrderReplaySlot(paid.id, "executive"))?.status, "sent");
    const again = await replayNotesOrderUpdatedAlert(paid.orderNo, harness.deps);
    assert.equal(again.executive, "duplicate");
    assert.equal(again.sales_admissions, "duplicate");
    assert.equal(harness.sends.length, 2);
  });

  test("order 001001 is not replayed", async () => {
    const harness = memory([HISTORICAL]);
    const result = await replayNotesOrderUpdatedAlert(HISTORICAL.orderNo, harness.deps);
    assert.equal(result.executive, "skipped");
    assert.equal(result.sales_admissions, "skipped");
    assert.equal(harness.sends.length, 0);
  });

  test("india country formats a 10-digit phone and an unknown country does not invent +91", () => {
    assert.equal(formatNotesAlertPhone("9876543210", "IN"), "+91 98765 43210");
    assert.equal(formatNotesAlertPhone("9876543210", null), "9876543210");
  });
});
