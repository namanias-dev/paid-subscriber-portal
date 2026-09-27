/**
 * Notes checkout-lead Telegram alerts. No database and no payment.
 * Run: node --import tsx --test tests/notes-store-leads/lead-alert.test.ts
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deliverAbandonedLead, deliverLeadConvertedAlert } from "../../lib/telegram/notesLeadAlert";
import {
  abandonedAlertDecision,
  formatNotesLeadAlertHtml,
  notesLeadAlertAnalytics,
  notesLeadAdminUrl,
  type NotesLeadAlertRecord,
} from "../../lib/telegram/notesLeadAlertFormat";
import { notesLeadAlertSlot } from "../../lib/telegram/notesLeadAlertFormat";
import type { CheckoutStage, SalesStatus } from "../../lib/store/checkoutLeadLogic";

const CUTOFF = "2026-09-27T06:00:00.000Z";
const DUE_ACTIVITY = "2026-09-27T04:30:00.000Z";

function lead(partial: Partial<NotesLeadAlertRecord> = {}): NotesLeadAlertRecord {
  return {
    id: "lead-1",
    name: "Rahul Sharma",
    phone: "9876543210",
    stage: "CHECKOUT_ABANDONED",
    salesStatus: "NEW",
    cart: [{ product_id: "polity", name: "Indian Polity Notes", qty: 1, line_total_paise: 250000 }],
    cartValuePaise: 250000,
    lastActivityAt: DUE_ACTIVITY,
    marketingConsent: true,
    touch: { source: "instagram", medium: "auto_dm", campaign: "notes_launch", content: "polity_reel_03" },
    orderId: null,
    orderNo: null,
    paid: false,
    paidPaise: null,
    isTest: false,
    priorCheckoutMessageId: null,
    ...partial,
  };
}

function harness(start: NotesLeadAlertRecord, sendImpl?: (html: string, replyTo: number | null) => { ok: boolean; messageId: number | null; error: string | null }) {
  const rows = new Map<string, { status: string; attempts: number; messageId: number | null; lastError: string | null; html: string | null }>();
  const sends: Array<{ html: string; replyTo: number | null }> = [];
  const edits: string[] = [];
  let current = { ...start };
  const deps = {
    now: () => Date.parse("2026-09-27T08:00:00.000Z"),
    backoffs: [0],
    sleep: async () => {},
    readCutoff: async () => CUTOFF,
    insertCutoff: async () => true,
    track: async () => {},
    getOutbox: async (slot: string) => {
      const row = rows.get(slot);
      if (!row) return null;
      return {
        slotKey: slot,
        leadId: current.id,
        kind: slot.includes("payment") ? "payment" as const : slot.includes("converted") ? "converted" as const : "checkout" as const,
        status: row.status as "pending" | "sent" | "failed" | "skipped",
        attempts: row.attempts,
        lastError: row.lastError,
        messageId: row.messageId,
        html: row.html,
        updatedAt: "2026-09-27T07:00:00.000Z",
        sentAt: row.status === "sent" ? "2026-09-27T07:00:00.000Z" : null,
        edited: false,
      };
    },
    saveOutbox: async (row: { slotKey: string; status: string; attempts: number; messageId: number | null; lastError: string | null; html: string | null }) => {
      rows.set(row.slotKey, { status: row.status, attempts: row.attempts, messageId: row.messageId, lastError: row.lastError, html: row.html });
    },
    reload: async () => ({ ...current }),
    send: async (html: string, replyTo: number | null) => {
      sends.push({ html, replyTo });
      return sendImpl ? sendImpl(html, replyTo) : { ok: true, messageId: 501, error: null };
    },
    edit: async (_id: number, html: string) => {
      edits.push(html);
      return { ok: true, error: null };
    },
  };
  return {
    deps,
    sends,
    edits,
    rows,
    setLead: (next: Partial<NotesLeadAlertRecord>) => {
      current = { ...current, ...next };
    },
  };
}

describe("notes checkout lead telegram alerts", () => {
  test("an active checkout is not alerted", () => {
    assert.equal(abandonedAlertDecision({
      requested: "checkout",
      stage: "CONTACT_CAPTURED",
      salesStatus: "NEW",
      lastActivityAt: new Date().toISOString(),
      cutoffMs: Date.parse(CUTOFF),
      paid: false,
    }), "active");
    assert.equal(abandonedAlertDecision({
      requested: "payment",
      stage: "PAYMENT_INITIATED",
      salesStatus: "NEW",
      lastActivityAt: new Date().toISOString(),
      cutoffMs: Date.parse(CUTOFF),
      paid: false,
    }), "active");
  });

  test("a checkout abandonment sends one sales alert", async () => {
    const box = harness(lead());
    const result = await deliverAbandonedLead(lead(), box.deps);
    assert.equal(result, "sent");
    assert.equal(box.sends.length, 1);
    assert.match(box.sends[0].html, /NOTES CHECKOUT LEAD/);
    assert.match(box.sends[0].html, /Rahul Sharma/);
    assert.match(box.sends[0].html, /\+91 98765 43210/);
    assert.match(box.sends[0].html, /Indian Polity Notes/);
    assert.match(box.sends[0].html, /₹2,500/);
    assert.match(box.sends[0].html, /Checkout abandoned/);
    assert.match(box.sends[0].html, /Marketing consent:<\/b> Yes/);
    assert.match(box.sends[0].html, /Call and help the student complete the Notes order/);
    assert.match(box.sends[0].html, /Instagram/);
    assert.match(box.sends[0].html, /Auto-DM/);
    assert.match(box.sends[0].html, /notes_launch/);
    assert.match(box.sends[0].html, /polity_reel_03/);
    assert.doesNotMatch(box.sends[0].html, /fbclid|gclid/);
    assert.match(box.sends[0].html, new RegExp(notesLeadAdminUrl("lead-1").replace("?", "\\?")));
  });

  test("repeating the abandonment worker does not send again", async () => {
    const box = harness(lead());
    assert.equal(await deliverAbandonedLead(lead(), box.deps), "sent");
    assert.equal(await deliverAbandonedLead(lead(), box.deps), "duplicate");
    assert.equal(await deliverAbandonedLead(lead(), box.deps), "duplicate");
    assert.equal(box.sends.length, 1);
  });

  test("payment abandonment is one high-intent alert", async () => {
    const row = lead({ stage: "PAYMENT_ABANDONED", cart: [{ product_id: "eco", name: "Indian Economy Notes", qty: 1 }] });
    const box = harness(row);
    assert.equal(await deliverAbandonedLead(row, box.deps), "sent");
    assert.match(box.sends[0].html, /HOT NOTES LEAD — PAYMENT NOT COMPLETED/);
    assert.match(box.sends[0].html, /Payment started, not completed/);
    assert.match(box.sends[0].html, /payment or checkout issue/);
    assert.equal(box.sends[0].replyTo, null);
  });

  test("checkout abandonment then payment abandonment is one escalation", async () => {
    const first = lead();
    const box = harness(first);
    assert.equal(await deliverAbandonedLead(first, box.deps), "sent");
    box.setLead({ stage: "PAYMENT_ABANDONED" });
    const hotter = lead({ stage: "PAYMENT_ABANDONED" });
    assert.equal(await deliverAbandonedLead(hotter, box.deps), "sent");
    assert.equal(box.sends.length, 2);
    assert.match(box.sends[1].html, /UPDATED \/ HOTTER LEAD/);
    assert.equal(box.sends[1].replyTo, 501);
  });

  test("a payment that lands before send suppresses the abandoned alert", async () => {
    const box = harness(lead());
    box.setLead({ paid: true, stage: "CONVERTED" as CheckoutStage, orderNo: "NIAS-N-2026-001010", paidPaise: 250000 });
    assert.equal(await deliverAbandonedLead(lead(), box.deps), "skipped");
    assert.equal(box.sends.length, 0);
    assert.equal(box.rows.get(notesLeadAlertSlot("checkout", "lead-1"))?.lastError, "paid");
  });

  test("a converted lead edits the original alert and says no follow-up", async () => {
    const box = harness(lead());
    assert.equal(await deliverAbandonedLead(lead(), box.deps), "sent");
    box.setLead({ stage: "CONVERTED", paid: true, paidPaise: 250000, orderNo: "NIAS-N-2026-001010" });
    assert.equal(await deliverLeadConvertedAlert("lead-1", box.deps), "sent");
    assert.equal(box.edits.length, 1);
    assert.match(box.edits[0], /CONVERTED \/ PAID/);
    assert.match(box.edits[0], /NIAS-N-2026-001010/);
    assert.match(box.edits[0], /₹2,500/);
    assert.match(box.edits[0], /No sales follow-up required/);
    assert.equal(box.sends.length, 1);
  });

  test("do not contact does not send a call alert", async () => {
    const row = lead({ salesStatus: "DO_NOT_CONTACT" as SalesStatus });
    const box = harness(row);
    assert.equal(await deliverAbandonedLead(row, box.deps), "skipped");
    assert.equal(box.sends.length, 0);
    assert.equal(box.rows.get(notesLeadAlertSlot("checkout", "lead-1"))?.lastError, "do_not_contact");
  });

  test("marketing consent false is shown as no", async () => {
    const row = lead({ marketingConsent: false, touch: null, name: null });
    const box = harness(row);
    assert.equal(await deliverAbandonedLead(row, box.deps), "sent");
    assert.match(box.sends[0].html, /Marketing consent:<\/b> No/);
    assert.match(box.sends[0].html, /Student:<\/b> Not available/);
    assert.match(box.sends[0].html, /Source:<\/b> Direct/);
    assert.doesNotMatch(box.sends[0].html, /Campaign:/);
  });

  test("multiple products and quantity use the stored cart", () => {
    const html = formatNotesLeadAlertHtml({
      lead: lead({
        cart: [
          { product_id: "polity", name: "Indian Polity Notes", qty: 2 },
          { product_id: "eco", name: "Indian Economy Notes", qty: 1 },
        ],
        cartValuePaise: 250000,
      }),
      kind: "checkout",
      escalation: false,
    });
    assert.match(html, /Indian Polity Notes ×2/);
    assert.match(html, /Indian Economy Notes ×1/);
    assert.match(html, /₹2,500/);
    assert.doesNotMatch(html, /₹2,999/);
  });

  test("names with markup are escaped", async () => {
    const row = lead({ name: "Aman & Sons", cart: [{ name: "History <Notes>", qty: 1 }] });
    const box = harness(row);
    assert.equal(await deliverAbandonedLead(row, box.deps), "sent");
    assert.match(box.sends[0].html, /Aman &amp; Sons/);
    assert.match(box.sends[0].html, /History &lt;Notes&gt;/);
  });

  test("telegram failure leaves the lead abandoned and can retry once", async () => {
    const row = lead();
    let fail = true;
    const box = harness(row, () => (fail ? { ok: false, messageId: null, error: "telegram_down" } : { ok: true, messageId: 77, error: null }));
    assert.equal(await deliverAbandonedLead(row, box.deps), "failed");
    assert.equal(row.stage, "CHECKOUT_ABANDONED");
    fail = false;
    assert.equal(await deliverAbandonedLead(row, box.deps), "sent");
    assert.equal(box.sends.length, 2);
    assert.equal(box.rows.get(notesLeadAlertSlot("checkout", "lead-1"))?.status, "sent");
    assert.equal(box.rows.get(notesLeadAlertSlot("checkout", "lead-1"))?.messageId, 77);
    assert.equal(await deliverAbandonedLead(row, box.deps), "duplicate");
    assert.equal(box.sends.length, 2);
  });

  test("historical abandoned leads are not sent", async () => {
    const row = lead({ lastActivityAt: "2026-09-20T00:00:00.000Z" });
    const box = harness(row);
    assert.equal(abandonedAlertDecision({
      requested: "checkout",
      stage: "CHECKOUT_ABANDONED",
      salesStatus: "NEW",
      lastActivityAt: row.lastActivityAt,
      cutoffMs: Date.parse(CUTOFF),
      paid: false,
    }), "historical");
    assert.equal(await deliverAbandonedLead(row, box.deps), "skipped");
    assert.equal(box.sends.length, 0);
    assert.equal(box.rows.size, 0);
  });

  test("a synthetic test lead is labelled and analytics omit the phone", () => {
    const row = lead({ isTest: true, name: "QA Notes Lead", phone: "6000000091" });
    const html = formatNotesLeadAlertHtml({ lead: row, kind: "checkout", escalation: false });
    assert.match(html, /TEST — NOTES SALES LEAD/);
    assert.match(html, /Do not call/);
    const props = notesLeadAlertAnalytics(row, "checkout");
    assert.equal("phone" in props, false);
    assert.equal("name" in props, false);
    assert.equal("email" in props, false);
    assert.deepEqual(props.product_ids, ["polity"]);
  });

  test("a lead with no prior alert does not get a conversion message", async () => {
    const box = harness(lead({ stage: "CONVERTED", paid: true, paidPaise: 250000, orderNo: "NIAS-N-2026-001010" }));
    assert.equal(await deliverLeadConvertedAlert("lead-1", box.deps), "skipped");
    assert.equal(box.edits.length, 0);
    assert.equal(box.sends.length, 0);
  });
});
