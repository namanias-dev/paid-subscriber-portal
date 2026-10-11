/**
 * buildAndValidateNotes*Sms — the decision for every Notes SMS. Pure, so each
 * test states the facts and the expected verdict.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAndValidateNotesAcademyLeadPromo,
  buildAndValidateNotesLeadSms,
  buildAndValidateNotesOrderSms,
  notesTemplateHold,
} from "../../lib/store/sms/plan";
import { formatNotesAmount, notesSubjectFromLines } from "../../lib/store/sms/values";
import { notesApprovedByKey, notesCanonicalRow } from "../../lib/sms/notesApproved";
import {
  NOW,
  abandonedLead,
  captured,
  confirmInput,
  ctxFor,
  hoursAgo,
  leadInput,
  paidOrder,
  pendingInput,
} from "./fixtures";

describe("order confirmed", () => {
  test("a paid order renders the approved text with its own values", () => {
    const p = buildAndValidateNotesOrderSms(confirmInput());
    assert.equal(p.ok, true, p.blockers.join(","));
    assert.equal(
      p.text,
      "Thank you! Your Indian Polity Notes order is confirmed. Rs.2499 payment received. Track: https://www.namanias.com/notes/track Naman Sharma IAS Academy.",
    );
    assert.equal(p.destination.digits10, "9876543210");
    assert.equal(p.destination.masked, "••••••3210");
    assert.equal(p.dedupeKey, "NOTES_ORDER_CONFIRMED_01:ord-a:pay-a");
    assert.equal(p.dltTemplateId, "1777179058711611732");
  });

  test("order A's details never go to order B's phone", () => {
    const a = buildAndValidateNotesOrderSms(confirmInput());
    const b = buildAndValidateNotesOrderSms(
      confirmInput({
        order: paidOrder({ id: "ord-b", phone: "9000000001", phone_key: "9000000001", total_paise: 299900, amount_paid_paise: 299900 }),
        items: [{ sku: "NOTES-ECONOMY", qty: 1 }],
        payments: [captured({ id: "pay-b", amount_paise: 299900 })],
      }),
    );
    assert.equal(a.destination.digits10, "9876543210");
    assert.equal(b.destination.digits10, "9000000001");
    assert.match(a.text!, /Indian Polity .* Rs\.2499 /);
    assert.match(b.text!, /Indian Economy .* Rs\.2999 /);
    assert.notEqual(a.dedupeKey, b.dedupeKey);
  });

  test("phone and phone_key that disagree are refused (wrong customer)", () => {
    const p = buildAndValidateNotesOrderSms(confirmInput({ order: paidOrder({ phone_key: "9000000001" }) }));
    assert.equal(p.ok, false);
    assert.ok(p.blockers.includes("phone_mismatch"));
    assert.equal(p.destination.digits10, null);
  });

  test("invalid phone is refused", () => {
    const p = buildAndValidateNotesOrderSms(confirmInput({ order: paidOrder({ phone: "12345", phone_key: null }) }));
    assert.ok(p.blockers.includes("invalid_phone"));
  });

  test("amount mismatch: captured Rs.2999 against a Rs.2458.20 order", () => {
    const p = buildAndValidateNotesOrderSms(
      confirmInput({
        order: paidOrder({ total_paise: 245820, amount_paid_paise: 245820 }),
        payments: [captured({ amount_paise: 299900 })],
      }),
    );
    assert.equal(p.ok, false);
    assert.ok(p.blockers.includes("amount_mismatch"));
  });

  test("amount_paid disagreeing with total is refused", () => {
    const p = buildAndValidateNotesOrderSms(confirmInput({ order: paidOrder({ amount_paid_paise: 200000 }) }));
    assert.ok(p.blockers.includes("amount_mismatch"));
  });

  test("paise amounts keep two decimals", () => {
    const p = buildAndValidateNotesOrderSms(
      confirmInput({ order: paidOrder({ total_paise: 245820, amount_paid_paise: 245820 }), payments: [captured({ amount_paise: 245820 })] }),
    );
    assert.equal(p.ok, true, p.blockers.join(","));
    assert.match(p.text!, / Rs\.2458\.20 payment received\./);
  });

  test("product mismatch: an unknown SKU is refused, never guessed", () => {
    const p = buildAndValidateNotesOrderSms(confirmInput({ items: [{ sku: "NOTES-POLITY", qty: 1 }, { sku: "NOTES-GEOGRAPHY", qty: 1 }] }));
    assert.equal(p.ok, false);
    assert.ok(p.blockers.includes("subject_unknown_product"));
  });

  test("multi-subject orders list subjects in catalogue order", () => {
    const p = buildAndValidateNotesOrderSms(
      confirmInput({ items: [{ sku: "NOTES-ECONOMY", qty: 1 }, { sku: "notes-polity", qty: 2 }] }),
    );
    assert.match(p.text!, /^Thank you! Your Indian Polity \+ Indian Economy Notes order/);
  });

  test("unpaid, refunded, uncaptured and double-captured orders are refused", () => {
    assert.ok(buildAndValidateNotesOrderSms(confirmInput({ order: paidOrder({ paid_at: null }) })).blockers.includes("order_not_paid"));
    assert.ok(buildAndValidateNotesOrderSms(confirmInput({ order: paidOrder({ amount_refunded_paise: 100 }) })).blockers.includes("order_refunded"));
    assert.ok(buildAndValidateNotesOrderSms(confirmInput({ payments: [] })).blockers.includes("no_captured_payment"));
    assert.ok(
      buildAndValidateNotesOrderSms(confirmInput({ payments: [captured(), captured({ id: "pay-a2" })] })).blockers.includes("multiple_captured_payments"),
    );
    assert.ok(
      buildAndValidateNotesOrderSms(confirmInput({ order: paidOrder({ status: "CANCELLED" }) })).blockers.includes("order_status_cancelled"),
    );
  });

  test("a drifted template row holds every plan", () => {
    const row = notesCanonicalRow(notesApprovedByKey("NOTES_ORDER_CONFIRMED_01")!);
    const p = buildAndValidateNotesOrderSms(confirmInput({ ctx: { row: { ...row, category: "promo" } } }));
    assert.equal(p.ok, false);
    assert.equal(p.hold, "template_drift:category");
  });
});

describe("payment pending", () => {
  test("an unpaid order renders the approved text with the product link", () => {
    const p = buildAndValidateNotesOrderSms(pendingInput());
    assert.equal(p.ok, true, p.blockers.join(","));
    assert.equal(
      p.text,
      "Your Indian Economy Notes order is saved, but payment of Rs.2999 is pending. Complete payment: https://www.namanias.com/notes/economy Naman Sharma IAS Academy.",
    );
    assert.equal(p.dedupeKey, "NOTES_PAYMENT_PENDING_01:ord-p");
  });

  test("two subjects link to the store", () => {
    const p = buildAndValidateNotesOrderSms(pendingInput({ items: [{ sku: "NOTES-POLITY", qty: 1 }, { sku: "NOTES-ECONOMY", qty: 1 }] }));
    assert.match(p.text!, /Complete payment: https:\/\/www\.namanias\.com\/notes Naman/);
  });

  test("captured, in-flight or paid is never 'pending'", () => {
    assert.ok(
      buildAndValidateNotesOrderSms(pendingInput({ payments: [{ id: "x", status: "CAPTURED", amount_paise: 299900, captured_at: hoursAgo(1), created_at: hoursAgo(3) }] })).blockers.includes("payment_captured"),
    );
    assert.ok(
      buildAndValidateNotesOrderSms(pendingInput({ payments: [{ id: "x", status: "UNCONFIRMED", amount_paise: 299900, captured_at: null, created_at: hoursAgo(3) }] })).blockers.includes("payment_in_flight"),
    );
    assert.ok(buildAndValidateNotesOrderSms(pendingInput({ order: paidOrder({ id: "ord-p" }) })).blockers.includes("order_paid"));
  });

  test("an amount the customer was not asked for is refused", () => {
    const p = buildAndValidateNotesOrderSms(
      pendingInput({ payments: [{ id: "x", status: "FAILED", amount_paise: 245820, captured_at: null, created_at: hoursAgo(3) }] }),
    );
    assert.ok(p.blockers.includes("amount_mismatch"));
  });

  test("a later paid order or a newer attempt suppresses it", () => {
    assert.ok(
      buildAndValidateNotesOrderSms(
        pendingInput({ siblings: [{ id: "ord-later", status: "PROCESSING", created_at: hoursAgo(1), paid_at: hoursAgo(1) }] }),
      ).blockers.includes("customer_paid_later_order"),
    );
    assert.ok(
      buildAndValidateNotesOrderSms(
        pendingInput({ siblings: [{ id: "ord-later", status: "PAYMENT_PENDING", created_at: hoursAgo(1), paid_at: null }] }),
      ).blockers.includes("newer_order_attempt"),
    );
  });

  test("one pending SMS per phone per 24 hours", () => {
    const p = buildAndValidateNotesOrderSms(
      pendingInput({ history: [{ template_id: "notes_payment_pending_01", status: "SENT", created_at: hoursAgo(5), dedupe_key: "NOTES_PAYMENT_PENDING_01:other" }] }),
    );
    assert.ok(p.blockers.includes("pending_sms_sent_recently"));
  });

  test("orders older than 7 days are not chased", () => {
    assert.ok(buildAndValidateNotesOrderSms(pendingInput({ order: { ...pendingInput().order!, created_at: hoursAgo(24 * 8) } })).blockers.includes("order_too_old"));
  });
});

describe("checkout incomplete", () => {
  test("held: the approved text is not GSM-7", () => {
    const p = buildAndValidateNotesLeadSms(leadInput("NOTES_CHECKOUT_INCOMPLETE_01"));
    assert.equal(p.hold, "approved_text_not_gsm7");
    assert.equal(p.ok, false);
    assert.deepEqual(p.blockers, []);
    assert.equal(
      p.text,
      "Your order for Naman Sir\u2019s handwritten UPSC Notes is currently pending. View your order details here: https://www.namanias.com/notes Naman Sharma IAS Academy.",
    );
  });

  test("precedence: a lead that became an order never gets the recovery SMS", () => {
    assert.ok(buildAndValidateNotesLeadSms(leadInput("NOTES_CHECKOUT_INCOMPLETE_01", { lead: abandonedLead({ order_id: "ord-x" }) })).blockers.includes("lead_has_order"));
    assert.ok(
      buildAndValidateNotesLeadSms(
        leadInput("NOTES_CHECKOUT_INCOMPLETE_01", { phoneOrders: [{ id: "ord-y", status: "PAYMENT_PENDING", created_at: hoursAgo(1), paid_at: null }] }),
      ).blockers.includes("customer_ordered"),
    );
    assert.ok(
      buildAndValidateNotesLeadSms(
        leadInput("NOTES_CHECKOUT_INCOMPLETE_01", {
          history: [{ template_id: "notes_payment_pending_01", status: "DELIVERED", created_at: hoursAgo(30), dedupe_key: "NOTES_PAYMENT_PENDING_01:ord-z" }],
        }),
      ).blockers.includes("recovery_sms_sent_recently"),
    );
  });

  test("no consent, do-not-contact, test and non-abandoned leads are refused", () => {
    const b = (lead: Parameters<typeof abandonedLead>[0]) =>
      buildAndValidateNotesLeadSms(leadInput("NOTES_CHECKOUT_INCOMPLETE_01", { lead: abandonedLead(lead) })).blockers;
    assert.ok(b({ marketing_consent: false }).includes("no_marketing_consent"));
    assert.ok(b({ sales_status: "DO_NOT_CONTACT" }).includes("lead_do_not_contact"));
    assert.ok(b({ is_test: true }).includes("test_lead"));
    assert.ok(b({ checkout_stage: "DETAILS_ENTERED" }).includes("lead_stage_details_entered"));
  });
});

describe("promotional", () => {
  test("new-lead promo: unknown consent is refused, explicit consent is only held by encoding", () => {
    const base = { templateKey: "NOTES_NEW_LEAD_PROMO_01" as const, ctx: ctxFor("NOTES_NEW_LEAD_PROMO_01"), phoneOrders: [], history: [], now: NOW };
    const unknown = buildAndValidateNotesAcademyLeadPromo({ ...base, lead: { id: "l1", phone: "9123456780", consent_status: "unknown" } });
    assert.ok(unknown.blockers.includes("consent_unknown"));
    const explicit = buildAndValidateNotesAcademyLeadPromo({ ...base, lead: { id: "l1", phone: "9123456780", consent_status: "explicit" } });
    assert.deepEqual(explicit.blockers, []);
    assert.equal(explicit.hold, "approved_text_not_gsm7");
  });

  test("frequency cap and repeat suppression", () => {
    const base = { templateKey: "NOTES_NEW_LEAD_PROMO_01" as const, ctx: ctxFor("NOTES_NEW_LEAD_PROMO_01"), phoneOrders: [], now: NOW, lead: { id: "l1", phone: "9123456780", consent_status: "explicit" } };
    const capped = buildAndValidateNotesAcademyLeadPromo({
      ...base,
      history: [{ template_id: "notes_discount_notes500_01", status: "SENT", created_at: hoursAgo(48), dedupe_key: "x" }],
    });
    assert.ok(capped.blockers.includes("promo_frequency_cap"));
    const repeat = buildAndValidateNotesAcademyLeadPromo({
      ...base,
      history: [{ template_id: "notes_new_lead_promo_01", status: "DELIVERED", created_at: hoursAgo(24 * 30), dedupe_key: "y" }],
    });
    assert.ok(repeat.blockers.includes("promo_already_received"));
  });

  test("existing Notes customers do not get acquisition promos", () => {
    const p = buildAndValidateNotesLeadSms(
      leadInput("NOTES_NEW_LEAD_PROMO_01", { phoneOrders: [{ id: "o", status: "PROCESSING", created_at: hoursAgo(100), paid_at: hoursAgo(100) }] }),
    );
    assert.ok(p.blockers.includes("existing_notes_customer"));
  });

  test("NOTES500: an invalid code holds the template, a valid one does not add a hold", () => {
    const invalid = buildAndValidateNotesLeadSms(leadInput("NOTES_DISCOUNT_NOTES500_01", { ctx: ctxFor("NOTES_DISCOUNT_NOTES500_01", { promoCodeProblem: "expired" }) }));
    // The encoding hold is reported first; the code problem still blocks once encoding is resolved.
    assert.ok(invalid.hold);
    const t = { ...notesApprovedByKey("NOTES_DISCOUNT_NOTES500_01")!, approvedText: "Special offer: Get Rs.500 off. Use code NOTES500. Order: {#urg#} Naman Sharma IAS Academy." };
    const row = { ...notesCanonicalRow(t) };
    assert.equal(notesTemplateHold(t, { row, promoCodeProblem: "expired" }), "promo_code_expired");
    assert.equal(notesTemplateHold(t, { row, promoCodeProblem: undefined }), "promo_code_unverified");
    assert.equal(notesTemplateHold(t, { row, promoCodeProblem: null }), null);
  });
});

describe("values", () => {
  test("formatNotesAmount", () => {
    assert.equal(formatNotesAmount(249900), "2499");
    assert.equal(formatNotesAmount(245820), "2458.20");
    assert.equal(formatNotesAmount(245805), "2458.05");
    assert.equal(formatNotesAmount(0), null);
    assert.equal(formatNotesAmount(-100), null);
    assert.equal(formatNotesAmount(12.5), null);
    assert.equal(formatNotesAmount(null), null);
  });

  test("notesSubjectFromLines ignores zero-qty lines and refuses empty orders", () => {
    assert.deepEqual(notesSubjectFromLines([{ sku: "NOTES-POLITY", qty: 0 }]), { ok: false, reason: "no_items" });
    const r = notesSubjectFromLines([{ sku: "NOTES-MODERN-HISTORY", qty: 1 }]);
    assert.ok(r.ok && r.subject === "Modern History" && r.slugs[0] === "modern-history");
  });
});
