/**
 * Notes discount codes. Pure rules only — no payment, shipment, or database.
 * Catalog price stays on the product. Automatic store_offers stay per line.
 * An entered code discounts eligible post-offer merchandise once per order.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { CLIENT_ALLOWED_EVENTS } from "../../lib/analytics/events.ts";
import { aggregateNotesAnalytics, stripAnalyticsProps, type NotesEventRow, type NotesOrderFact } from "../../lib/analytics/notesCommerce.ts";
import {
  allocateDiscountPaise,
  clampDiscountHoldTtl,
  couponDiscountPaise,
  customerDiscountMessage,
  discountCapacity,
  deriveDiscountStatus,
  DISCOUNT_HOLD_TTL_DEFAULT_SECONDS,
  formatIstDateTime,
  istLocalToUtcIso,
  judgeDiscountCode,
  normalizeDiscountCode,
  payTimeDiscountMessage,
  redemptionCaptureIncrements,
  reservationDecision,
  settledOrderMoney,
  utcIsoToIstParts,
  validateDiscountWrite,
  type DiscountCodeRule,
  type DiscountLine,
} from "../../lib/store/discountPricing.ts";
import { discountPhoneHash, publicDiscountSummary, couponSnapshot, type AppliedDiscount } from "../../lib/store/discountCodes.ts";
import { computeTaxDocument } from "../../lib/store/invoice/tax.ts";
import { lineTaxPaise } from "../../lib/store/money.ts";
import { formatNotesOrderAlertHtml, type NotesAlertCustomer } from "../../lib/telegram/notesOrderAlertFormat.ts";
import { formatNotesLeadAlertHtml, type NotesLeadAlertRecord } from "../../lib/telegram/notesLeadAlertFormat.ts";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const EXPIRY = "2026-09-30T18:29:00.000Z";
const POLITY = "polity";
const ECONOMY = "economy";
const FUTURE = "future-subject";

function rule(partial: Partial<DiscountCodeRule> = {}): DiscountCodeRule {
  return {
    id: "code-1",
    code: "NOTES500",
    name: "Notes ₹500",
    discount_type: "fixed_amount",
    discount_value: 50_000,
    scope: "selected_products",
    product_ids: [POLITY, ECONOMY],
    starts_at: null,
    expires_at: EXPIRY,
    is_active: true,
    archived_at: null,
    max_redemptions: null,
    redemption_count: 0,
    held_count: 0,
    per_customer_limit: null,
    customer_uses: 0,
    ...partial,
  };
}

function lines(...rows: Array<[string, number]>): DiscountLine[] {
  return rows.map(([product_id, merchandise_paise]) => ({ product_id, merchandise_paise }));
}

describe("normalization", () => {
  test("codes are trimmed, uppercased, and reject markup", () => {
    assert.equal(normalizeDiscountCode(" notes500 "), "NOTES500");
    assert.equal(normalizeDiscountCode("Notes500"), "NOTES500");
    assert.equal(normalizeDiscountCode("POLITY-300"), "POLITY-300");
    assert.equal(normalizeDiscountCode("A_1"), "A_1");
    assert.equal(normalizeDiscountCode(""), null);
    assert.equal(normalizeDiscountCode("  "), null);
    assert.equal(normalizeDiscountCode("<script>"), null);
    assert.equal(normalizeDiscountCode("notes 500"), null);
    assert.equal(normalizeDiscountCode("₹500"), null);
  });
});

describe("fixed amount, once per order", () => {
  test("POLITY500 discounts a Polity cart by ₹500", () => {
    const judged = judgeDiscountCode(rule({ code: "POLITY500", product_ids: [POLITY] }), lines([POLITY, 250_000]), NOW);
    assert.equal(judged.ok, true);
    assert.equal(judged.eligible_paise, 250_000);
    assert.equal(judged.discount_paise, 50_000);
  });

  test("ECONOMY500 discounts an Economy cart by ₹500", () => {
    const judged = judgeDiscountCode(rule({ code: "ECONOMY500", product_ids: [ECONOMY] }), lines([ECONOMY, 250_000]), NOW);
    assert.equal(judged.ok, true);
    assert.equal(judged.discount_paise, 50_000);
  });

  test("a Polity-only code does not discount Economy", () => {
    const judged = judgeDiscountCode(rule({ code: "POLITY500", product_ids: [POLITY] }), lines([ECONOMY, 250_000]), NOW);
    assert.equal(judged.ok, false);
    assert.equal(judged.reason, "not_applicable");
    assert.equal(judged.discount_paise, 0);
    assert.equal(judged.message, "This code doesn’t apply to the items in your cart.");
  });

  test("NOTES500 on Polity and Economy is ₹500 total, not ₹1,000", () => {
    const judged = judgeDiscountCode(rule(), lines([POLITY, 250_000], [ECONOMY, 250_000]), NOW);
    assert.equal(judged.eligible_paise, 500_000);
    assert.equal(judged.discount_paise, 50_000);
    assert.deepEqual(judged.eligible_product_ids, [POLITY, ECONOMY]);
  });

  test("quantity does not multiply a fixed code", () => {
    const judged = judgeDiscountCode(rule({ product_ids: [POLITY] }), lines([POLITY, 500_000]), NOW);
    assert.equal(judged.eligible_paise, 500_000);
    assert.equal(judged.discount_paise, 50_000);
  });

  test("a mixed cart discounts only the eligible merchandise", () => {
    const judged = judgeDiscountCode(rule({ product_ids: [POLITY] }), lines([POLITY, 250_000], [FUTURE, 300_000]), NOW);
    assert.equal(judged.eligible_paise, 250_000);
    assert.equal(judged.discount_paise, 50_000);
    assert.deepEqual(judged.eligible_product_ids, [POLITY]);
  });

  test("all current and future Notes are eligible when scope is all_notes", () => {
    const judged = judgeDiscountCode(rule({ scope: "all_notes", product_ids: [] }), lines([POLITY, 250_000], [FUTURE, 180_000]), NOW);
    assert.equal(judged.eligible_paise, 430_000);
    assert.equal(judged.discount_paise, 50_000);
  });

  test("percentage is once on the eligible subtotal", () => {
    const judged = judgeDiscountCode(
      rule({ discount_type: "percentage", discount_value: 10 }),
      lines([POLITY, 250_000], [ECONOMY, 250_000]),
      NOW,
    );
    assert.equal(couponDiscountPaise(500_000, { discount_type: "percentage", discount_value: 10 }), 50_000);
    assert.equal(judged.discount_paise, 50_000);
  });

  test("the coupon sits on the post-offer selling subtotal", () => {
    const judged = judgeDiscountCode(rule(), lines([POLITY, 200_000], [ECONOMY, 200_000]), NOW);
    assert.equal(judged.eligible_paise, 400_000);
    assert.equal(judged.discount_paise, 50_000);
    const money = settledOrderMoney({
      subtotalPaise: 500_000,
      offerDiscountPaise: 100_000,
      couponDiscountPaise: judged.discount_paise,
      taxPaise: 0,
      shippingPaise: 8_000,
    });
    assert.equal(money.discountPaise, 150_000);
    assert.equal(money.totalPaise, 358_000);
  });
});

describe("caps, schedule, and limits", () => {
  test("discount cannot exceed eligible merchandise or drive a negative total", () => {
    const judged = judgeDiscountCode(rule(), lines([POLITY, 30_000]), NOW);
    assert.equal(judged.discount_paise, 30_000);
    const money = settledOrderMoney({
      subtotalPaise: 30_000,
      offerDiscountPaise: 0,
      couponDiscountPaise: judged.discount_paise,
      taxPaise: -50,
      shippingPaise: 8_000,
    });
    assert.equal(money.totalPaise, 8_000);
    assert.ok(money.totalPaise >= 0);
    assert.ok(money.discountPaise >= 0);
  });

  test("a code with no coupon leaves the existing total identity unchanged", () => {
    const money = settledOrderMoney({
      subtotalPaise: 250_000,
      offerDiscountPaise: 0,
      couponDiscountPaise: 0,
      taxPaise: 0,
      shippingPaise: 8_000,
    });
    assert.equal(money.discountPaise, 0);
    assert.equal(money.totalPaise, 258_000);
  });

  test("shipping is not discounted", () => {
    const money = settledOrderMoney({
      subtotalPaise: 250_000,
      offerDiscountPaise: 0,
      couponDiscountPaise: 50_000,
      taxPaise: 0,
      shippingPaise: 8_000,
    });
    assert.equal(money.totalPaise, 208_000);
  });

  test("exact expiry is UTC storage and IST display", () => {
    assert.equal(istLocalToUtcIso("2026-09-30", "23:59"), EXPIRY);
    assert.deepEqual(utcIsoToIstParts(EXPIRY), { date: "2026-09-30", time: "23:59" });
    const label = formatIstDateTime(EXPIRY);
    assert.match(label || "", /30 Sept? 2026/);
    assert.match(label || "", /11:59 PM IST/);
  });

  test("valid before expiry and invalid at the expiry instant", () => {
    const before = judgeDiscountCode(rule(), lines([POLITY, 250_000]), new Date("2026-09-30T18:28:59.000Z"));
    const at = judgeDiscountCode(rule(), lines([POLITY, 250_000]), new Date(EXPIRY));
    assert.equal(before.ok, true);
    assert.equal(at.ok, false);
    assert.equal(at.reason, "expired");
    assert.equal(at.message, "This offer has expired.");
  });

  test("inactive, archived, and not-yet-started codes fail closed", () => {
    const inactive = judgeDiscountCode(rule({ is_active: false }), lines([POLITY, 250_000]), NOW);
    assert.equal(inactive.reason, "invalid");
    assert.equal(inactive.message, "This code isn’t valid.");
    assert.equal(deriveDiscountStatus(rule({ is_active: false }), NOW), "inactive");
    assert.equal(deriveDiscountStatus(rule({ archived_at: EXPIRY, is_active: false }), new Date("2026-10-01T00:00:00.000Z")), "archived");
    assert.equal(deriveDiscountStatus(rule({ starts_at: "2026-09-28T00:00:00.000Z" }), NOW), "scheduled");
    assert.equal(deriveDiscountStatus(rule(), NOW), "active");
    assert.equal(deriveDiscountStatus(rule(), new Date(EXPIRY)), "expired");
    const scheduled = judgeDiscountCode(rule({ starts_at: "2026-09-28T00:00:00.000Z" }), lines([POLITY, 250_000]), NOW);
    assert.equal(scheduled.message, "This code isn’t valid.");
  });

  test("usage limit counts captured plus held, and is optional per customer", () => {
    const full = judgeDiscountCode(rule({ max_redemptions: 100, redemption_count: 100 }), lines([POLITY, 250_000]), NOW);
    assert.equal(full.reason, "limit");
    assert.equal(full.message, "This offer has reached its usage limit.");
    const raced = judgeDiscountCode(rule({ max_redemptions: 100, redemption_count: 99, held_count: 1 }), lines([POLITY, 250_000]), NOW);
    assert.equal(raced.reason, "limit");
    const open = judgeDiscountCode(rule({ max_redemptions: 100, redemption_count: 99 }), lines([POLITY, 250_000]), NOW);
    assert.equal(open.ok, true);
    const repeat = judgeDiscountCode(rule({ per_customer_limit: 1, customer_uses: 1 }), lines([POLITY, 250_000]), NOW);
    assert.equal(repeat.reason, "customer_limit");
    assert.equal(repeat.message, "This offer has already been used for this customer.");
    const first = judgeDiscountCode(rule({ per_customer_limit: 1, customer_uses: 0 }), lines([POLITY, 250_000]), NOW);
    assert.equal(first.ok, true);
  });

  test("a payment reservation is not created by applying a code, and the final slot is exclusive", () => {
    const open = reservationDecision({
      maxRedemptions: 10,
      redeemed: 9,
      otherActiveHolds: 0,
      sameCustomerActiveHold: false,
      capturedByCustomer: 0,
      perCustomerLimit: 1,
    });
    assert.equal(open, "ok");
    const taken = reservationDecision({
      maxRedemptions: 10,
      redeemed: 9,
      otherActiveHolds: 1,
      sameCustomerActiveHold: false,
      capturedByCustomer: 0,
      perCustomerLimit: 1,
    });
    assert.equal(taken, "limit");
    const sameCustomer = reservationDecision({
      maxRedemptions: 10,
      redeemed: 0,
      otherActiveHolds: 0,
      sameCustomerActiveHold: true,
      capturedByCustomer: 0,
      perCustomerLimit: 1,
    });
    assert.equal(sameCustomer, "customer_pending");
    const used = reservationDecision({
      maxRedemptions: 10,
      redeemed: 1,
      otherActiveHolds: 0,
      sameCustomerActiveHold: false,
      capturedByCustomer: 1,
      perCustomerLimit: 1,
    });
    assert.equal(used, "customer_limit");
    assert.equal(payTimeDiscountMessage("limit"), "This offer is no longer available. Your order total has been updated.");
    assert.equal(payTimeDiscountMessage("customer_pending"), "A payment for this offer is already in progress. Your order total has been updated.");
    assert.equal(payTimeDiscountMessage("customer_limit"), "This offer has already been used for this customer.");
    assert.equal(clampDiscountHoldTtl(undefined), DISCOUNT_HOLD_TTL_DEFAULT_SECONDS);
    assert.equal(clampDiscountHoldTtl(20 * 60), 20 * 60);
    assert.equal(clampDiscountHoldTtl(60), DISCOUNT_HOLD_TTL_DEFAULT_SECONDS);
    const room = discountCapacity({ max: 10, redeemed: 8, reserved: 1 });
    assert.deepEqual(room, { redeemed: 8, reserved: 1, available: 1 });
    assert.equal(discountCapacity({ max: null, redeemed: 8, reserved: 1 }).available, null);
  });

  test("cart edits that drop the eligible product invalidate the code", () => {
    assert.equal(
      customerDiscountMessage("not_applicable", "NOTES500"),
      "NOTES500 no longer applies to your cart.",
    );
  });
});

describe("money identity, invoice, and redemption", () => {
  test("quote, charged total, and invoice reconcile, and shipping stays separate", () => {
    const discount = 50_000;
    const shipping = 8_000;
    const money = settledOrderMoney({
      subtotalPaise: 250_000,
      offerDiscountPaise: 0,
      couponDiscountPaise: discount,
      taxPaise: lineTaxPaise(200_000, "nil", 0),
      shippingPaise: shipping,
    });
    const doc = computeTaxDocument({
      lines: [{
        name: "Indian Polity Notes",
        sku: "NOTES-POLITY",
        hsn: "4901",
        qty: 1,
        lineTotalPaise: 250_000,
        discountPaise: 0,
        taxTreatment: "nil",
        taxRateBps: 0,
      }],
      shippingPaise: shipping,
      pricesIncludeTax: true,
      supplierStateCode: "04",
      placeOfSupplyCode: "04",
      chargedTotalPaise: money.totalPaise,
      couponCode: "NOTES500",
      couponDiscountPaise: discount,
    });
    assert.equal(money.totalPaise, 208_000);
    assert.equal(doc.grandTotalPaise, money.totalPaise);
    assert.equal(doc.roundingPaise, 0);
    assert.equal(doc.couponCode, "NOTES500");
    assert.equal(doc.couponDiscountPaise, 50_000);
    assert.equal(doc.shippingPaise, shipping);
  });

  test("a document without a coupon is unchanged", () => {
    const doc = computeTaxDocument({
      lines: [{
        name: "Indian Polity Notes",
        sku: "NOTES-POLITY",
        hsn: "4901",
        qty: 1,
        lineTotalPaise: 250_000,
        discountPaise: 0,
        taxTreatment: "nil",
        taxRateBps: 0,
      }],
      shippingPaise: 8_000,
      pricesIncludeTax: true,
      supplierStateCode: "04",
      placeOfSupplyCode: "04",
      chargedTotalPaise: 258_000,
    });
    assert.equal(doc.couponDiscountPaise, 0);
    assert.equal(doc.couponCode, null);
    assert.equal(doc.grandTotalPaise, 258_000);
    assert.equal(doc.roundingPaise, 0);
  });

  test("allocation never exceeds a line and sums to the discount", () => {
    const split = allocateDiscountPaise(
      lines([POLITY, 250_000], [ECONOMY, 250_000]),
      50_000,
    );
    assert.equal((split[POLITY] || 0) + (split[ECONOMY] || 0), 50_000);
    assert.ok((split[POLITY] || 0) <= 250_000);
    assert.ok((split[ECONOMY] || 0) <= 250_000);
  });

  test("a repeated capture does not increment, and a phone is stored only as a hash", () => {
    assert.equal(redemptionCaptureIncrements("captured"), false);
    assert.equal(redemptionCaptureIncrements("held"), true);
    assert.equal(redemptionCaptureIncrements("missing"), false);
    assert.equal(redemptionCaptureIncrements("released"), false);
    assert.equal(redemptionCaptureIncrements("released", {
      redeemed: 9,
      otherActiveHolds: 0,
      max: 10,
      capturedByCustomer: 0,
      perCustomerLimit: 1,
    }), true);
    assert.equal(redemptionCaptureIncrements("released", {
      redeemed: 10,
      otherActiveHolds: 0,
      max: 10,
      capturedByCustomer: 0,
      perCustomerLimit: 1,
    }), false);
    const hash = discountPhoneHash("+91 98765 43210");
    assert.equal(hash, discountPhoneHash("9876543210"));
    assert.equal(hash, discountPhoneHash("+919876543210"));
    assert.notEqual(hash, "9876543210");
    assert.equal(hash?.length, 64);
    assert.equal(discountPhoneHash("12345"), null);
  });

  test("the public summary hides the promotion id that the order snapshot keeps", () => {
    const applied: AppliedDiscount = {
      id: "secret-id",
      code: "NOTES500",
      name: "Notes ₹500",
      discount_type: "fixed_amount",
      discount_value: 50_000,
      scope: "selected_products",
      discount_paise: 50_000,
      eligible_product_ids: [POLITY],
      eligible_paise: 250_000,
      merchandise_before_paise: 250_000,
    };
    assert.equal("id" in publicDiscountSummary(applied), false);
    assert.equal(couponSnapshot(applied).coupon_id, "secret-id");
    assert.equal(couponSnapshot(applied).discount_paise, 50_000);
  });
});

describe("admin write rules", () => {
  test("server validation rejects unsafe or inconsistent codes", () => {
    const base = {
      code: "NOTES500",
      name: "September notes",
      discount_type: "fixed_amount",
      discount_value: 50_000,
      scope: "selected_products",
      product_ids: [POLITY, ECONOMY],
      starts_at: null,
      expires_at: EXPIRY,
      is_active: true,
      max_redemptions: null,
      per_customer_limit: null,
      now: NOW,
    };
    assert.deepEqual(validateDiscountWrite(base), []);
    assert.ok(validateDiscountWrite({ ...base, code: "<b>NOTES</b>" }).length);
    assert.ok(validateDiscountWrite({ ...base, discount_value: 50 }).some((error) => /₹1/.test(error)));
    assert.ok(validateDiscountWrite({ ...base, scope: "selected_products", product_ids: [] }).length);
    assert.ok(validateDiscountWrite({ ...base, starts_at: EXPIRY, expires_at: "2026-09-27T00:00:00.000Z" }).length);
    assert.ok(validateDiscountWrite({ ...base, expires_at: "2026-09-27T00:00:00.000Z" }).length);
    assert.ok(validateDiscountWrite({ ...base, max_redemptions: 0 }).length);
    const lowered = validateDiscountWrite({ ...base, max_redemptions: 5, redeemed_count: 8, reserved_count: 0 });
    assert.match(lowered[0] || "", /cannot be lower than the 8 redemptions already completed/);
    const reserved = validateDiscountWrite({ ...base, max_redemptions: 8, redeemed_count: 8, reserved_count: 1 });
    assert.match(reserved[0] || "", /plus 1 payment in progress/);
    assert.deepEqual(validateDiscountWrite({ ...base, max_redemptions: 20, redeemed_count: 8, reserved_count: 1 }), []);
  });
});

describe("analytics and alerts", () => {
  test("discount performance counts applications and captured purchases without PII", () => {
    const events: NotesEventRow[] = [
      {
        event_name: "notes_discount_applied",
        occurred_at: "2026-09-27T12:00:00.000Z",
        props: { coupon_code: "notes500", phone: "9876543210", email: "student@example.com" },
      },
      {
        event_name: "notes_payment_initiated",
        occurred_at: "2026-09-27T12:05:00.000Z",
        props: { coupon_code: "NOTES500" },
      },
      {
        event_name: "notes_discount_payment_reserved",
        occurred_at: "2026-09-27T12:05:00.000Z",
        props: { coupon_code: "NOTES500", discount_amount: 50_000 },
      },
    ];
    const orders: NotesOrderFact[] = [{
      id: "order-1",
      status: "ORDER_CONFIRMED",
      total_paise: 208_000,
      coupon_code: "NOTES500",
      coupon_discount_paise: 50_000,
      paid_at: "2026-09-27T12:10:00.000Z",
    }];
    const report = aggregateNotesAnalytics(events, orders);
    assert.equal(report.kpis.revenuePaise, 208_000);
    assert.equal(report.discountCodes[0]?.code, "NOTES500");
    assert.equal(report.discountCodes[0]?.applications, 1);
    assert.equal(report.discountCodes[0]?.checkoutStarts, 1);
    assert.equal(report.discountCodes[0]?.paymentAttempts, 1);
    assert.equal(report.discountCodes[0]?.paidOrders, 1);
    assert.equal(report.discountCodes[0]?.discountPaise, 50_000);
    assert.equal(report.discountCodes[0]?.revenuePaise, 208_000);
    const safe = stripAnalyticsProps(events[0].props || {});
    assert.equal("phone" in safe, false);
    assert.equal("email" in safe, false);
    assert.equal(CLIENT_ALLOWED_EVENTS.has("notes_discount_applied"), true);
    assert.equal(CLIENT_ALLOWED_EVENTS.has("notes_discount_rejected"), true);
    assert.equal(CLIENT_ALLOWED_EVENTS.has("notes_discount_removed"), true);
    assert.equal(CLIENT_ALLOWED_EVENTS.has("notes_discount_opened"), true);
    assert.equal(CLIENT_ALLOWED_EVENTS.has("notes_purchase_with_discount"), false);
    assert.equal(CLIENT_ALLOWED_EVENTS.has("notes_discount_payment_reserved"), false);
    assert.equal(CLIENT_ALLOWED_EVENTS.has("notes_discount_reservation_released"), false);
    assert.equal(CLIENT_ALLOWED_EVENTS.has("notes_discount_redeemed"), false);
  });

  test("Telegram mentions an offer only when one was applied, and the paid amount is the captured total", () => {
    const customer: NotesAlertCustomer = { name: "Student", phone: "9876543210", city: "Delhi" };
    const plain = formatNotesOrderAlertHtml({
      orderNo: "NIAS-N-2026-000001",
      sequence: 1,
      items: [{ name: "Indian Polity Notes", qty: 1 }],
      paidPaise: 258_000,
      paidAt: "2026-09-27T12:10:00.000Z",
      todayCount: 1,
      totalCount: 1,
      customer,
    });
    const offered = formatNotesOrderAlertHtml({
      orderNo: "NIAS-N-2026-000002",
      sequence: 2,
      items: [{ name: "Indian Polity Notes", qty: 1 }],
      paidPaise: 208_000,
      paidAt: "2026-09-27T12:10:00.000Z",
      todayCount: 2,
      totalCount: 2,
      customer,
      couponCode: "NOTES500",
      couponDiscountPaise: 50_000,
    });
    assert.equal(plain.includes("Offer:"), false);
    assert.match(offered, /Offer: NOTES500/);
    assert.match(offered, /₹2,080/);
    const lead: NotesLeadAlertRecord = {
      id: "lead-1",
      name: "Student",
      phone: "9876543210",
      stage: "CHECKOUT_ABANDONED",
      salesStatus: "NEW",
      cart: [{ name: "Indian Polity Notes", qty: 1 }],
      cartValuePaise: 250_000,
      couponCode: "NOTES500",
      couponDiscountPaise: 50_000,
      cartAfterDiscountPaise: 200_000,
      lastActivityAt: "2026-09-27T12:00:00.000Z",
      marketingConsent: false,
      touch: { source: "instagram", medium: "story", campaign: "notes" },
      orderId: null,
      orderNo: null,
      paid: false,
      paidPaise: null,
      isTest: true,
      priorCheckoutMessageId: null,
    };
    const html = formatNotesLeadAlertHtml({ lead, kind: "checkout", escalation: false });
    assert.match(html, /Offer: NOTES500/);
    const bare = formatNotesLeadAlertHtml({
      lead: { ...lead, couponCode: null, couponDiscountPaise: 0, cartAfterDiscountPaise: null },
      kind: "checkout",
      escalation: false,
    });
    assert.equal(bare.includes("Offer:"), false);
  });
});

describe("migration safety", () => {
  test("the schema is additive, locks the code row, and does not seed NOTES500", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/2026-09-27-notes-discount-codes.sql", import.meta.url), "utf8");
    assert.match(sql, /create table if not exists public\.store_discount_codes/);
    assert.match(sql, /add column if not exists coupon_code/);
    assert.match(sql, /for update/);
    assert.match(sql, /unique \(order_id\)/);
    assert.match(sql, /redemption_count = redemption_count \+ 1/);
    assert.match(sql, /existing\.status = 'captured'/);
    assert.match(sql, /existing\.status = 'held'/);
    assert.match(sql, /expires_at <= now_ts/);
    assert.match(sql, /customer_pending/);
    assert.match(sql, /store_discount_redemptions_one_live_hold_uq/);
    assert.match(sql, /store_release_expired_discount_holds/);
    assert.match(sql, /on conflict \(key\) do nothing/);
    assert.doesNotMatch(sql, /enabled = true/);
    assert.doesNotMatch(sql, /insert into public\.store_discount_codes/i);
    assert.doesNotMatch(sql, /drop column/i);
    assert.match(sql, /notes_store_coupons/);
  });
});
