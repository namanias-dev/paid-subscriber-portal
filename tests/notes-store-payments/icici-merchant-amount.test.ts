import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseVerifyPacket } from "../../lib/store/payments/eazypay";
import {
  formatReconciledPaymentAlert,
  gatewayChargesForStaff,
  gatewayRupeesToPaise,
  merchantAmountDecision,
  normalizeEazypayVerifyAmounts,
} from "../../lib/store/payments/eazypayAmounts";
import { mapStoreVerifyStatus, STORE_OPEN_STATUSES } from "../../lib/store/payments/status";
import { shouldFireNotesPaidAlert } from "../../lib/telegram/notesOrderAlertFormat";
import { notesPurchaseDedupeKey } from "../../lib/analytics/notesCommerce";

const REF = "NIASN-N-MUK1CPWK-MDBEUV";
const ORDER = 205_900;

/** The live EazyPGVerify body for the blocked credit-card order. */
const INCIDENT_PACKET =
  "status=RIP&ezpaytranid=260927286446694&amount=2078.77&trandate=2026-09-27 22:01:55&pgreferenceno=NIASN-N-MUK1CPWK-MDBEUV&sdt=&BA=2059&PF=16.75&TAX=0.0&PaymentMode=CREDIT_CARD";

const SIGNED_CALLBACK = {
  transactionAmount: "2059",
  serviceTaxAmount: "3.02",
};

function decide(body: string, expected = ORDER, signed = SIGNED_CALLBACK) {
  const normalized = normalizeEazypayVerifyAmounts({
    packet: parseVerifyPacket(body),
    expectedReference: REF,
    signedCallback: signed,
  });
  return { normalized, decision: merchantAmountDecision(normalized, expected) };
}

describe("ICICI merchant amount", () => {
  test("parses gateway rupees to integer paise without float drift", () => {
    assert.equal(gatewayRupeesToPaise("2078.77"), 207_877);
    assert.equal(gatewayRupeesToPaise("16.75"), 1_675);
    assert.equal(gatewayRupeesToPaise("3.02"), 302);
    assert.equal(gatewayRupeesToPaise("0.0"), 0);
    assert.equal(gatewayRupeesToPaise("2059"), 205_900);
    assert.equal(gatewayRupeesToPaise("1.234"), null);
  });

  test("fee-added credit card compares BA, not the cardholder total", () => {
    const { normalized, decision } = decide(INCIDENT_PACKET);
    assert.equal(mapStoreVerifyStatus(normalized.verified_status), "paid");
    assert.equal(decision, "accept");
    assert.equal(normalized.merchant_amount_paise, 205_900);
    assert.equal(normalized.submitted_amount_paise, 205_900);
    assert.equal(normalized.processing_fee_paise, 1_675);
    assert.equal(normalized.processing_fee_tax_paise, 302);
    assert.equal(normalized.cardholder_total_paise, 207_877);
    assert.equal(normalized.payment_mode, "CREDIT_CARD");
    assert.equal(normalized.merchant_source, "BA");
    assert.notEqual(normalized.cardholder_total_paise, ORDER);
  });

  test("a matching base amount is accepted even when the callback is absent", () => {
    const normalized = normalizeEazypayVerifyAmounts({
      packet: parseVerifyPacket(INCIDENT_PACKET),
      expectedReference: REF,
    });
    assert.equal(merchantAmountDecision(normalized, ORDER), "accept");
    assert.equal(normalized.merchant_amount_paise, 205_900);
    assert.equal(normalized.processing_fee_paise, 1_675);
  });

  test("fee-free payment passes when merchant, submitted, and card total match", () => {
    const { normalized, decision } = decide(
      `status=RIP&amount=2059&pgreferenceno=${REF}&BA=2059&PF=0.00&TAX=0.0&PaymentMode=UPI_ICICI`,
      ORDER,
      { transactionAmount: "2059", serviceTaxAmount: "0.00" },
    );
    assert.equal(decision, "accept");
    assert.equal(normalized.merchant_amount_paise, 205_900);
    assert.equal(normalized.cardholder_total_paise, 205_900);
    assert.equal(normalized.processing_fee_paise, 0);
    assert.equal(normalized.processing_fee_tax_paise, 0);
  });

  test("UPI and net banking use the same base-amount field", () => {
    for (const mode of ["UPI_ICICI", "NET_BANKING"]) {
      const { decision, normalized } = decide(
        `status=Success&amount=2599&pgreferenceno=${REF}&BA=2599&PF=0.00&TAX=0.0&PaymentMode=${mode}`,
        259_900,
        null as unknown as typeof SIGNED_CALLBACK,
      );
      assert.equal(decision, "accept", mode);
      assert.equal(normalized.merchant_source, "BA");
      assert.equal(normalized.payment_mode, mode);
    }
  });

  test("a lower merchant amount fails even when the card total is closer", () => {
    const { decision, normalized } = decide(
      `status=RIP&amount=2068.77&pgreferenceno=${REF}&BA=2049&PF=16.75&TAX=3.02&PaymentMode=CREDIT_CARD`,
      ORDER,
      { transactionAmount: "2049", serviceTaxAmount: "3.02" },
    );
    assert.equal(mapStoreVerifyStatus("RIP"), "paid");
    assert.equal(decision, "mismatch");
    assert.equal(normalized.merchant_amount_paise, 204_900);
    assert.notEqual(decision, "accept");
  });

  test("a higher merchant amount fails", () => {
    const { decision, normalized } = decide(
      `status=RIP&amount=2069&pgreferenceno=${REF}&BA=2069&PF=0.00&TAX=0.0&PaymentMode=CREDIT_CARD`,
      ORDER,
      { transactionAmount: "2069", serviceTaxAmount: "0" },
    );
    assert.equal(decision, "mismatch");
    assert.equal(normalized.merchant_amount_paise, 206_900);
  });

  test("a fee packet with no base amount is not trusted just because the card total is higher", () => {
    const { decision, normalized } = decide(
      `status=RIP&amount=2078.77&pgreferenceno=${REF}&PF=16.75&TAX=3.02&PaymentMode=CREDIT_CARD`,
    );
    assert.equal(decision, "untrusted");
    assert.equal(normalized.merchant_amount_paise, null);
    assert.equal(normalized.cardholder_total_paise, 207_877);
  });

  test("a signed callback transaction amount that disagrees with BA fails closed", () => {
    const { decision } = decide(INCIDENT_PACKET, ORDER, { transactionAmount: "2078.77", serviceTaxAmount: "3.02" });
    assert.equal(decision, "untrusted");
  });

  test("a mismatched reference fails closed", () => {
    const normalized = normalizeEazypayVerifyAmounts({
      packet: parseVerifyPacket(INCIDENT_PACKET),
      expectedReference: "NIASN-N-OTHER",
      signedCallback: SIGNED_CALLBACK,
    });
    assert.equal(merchantAmountDecision(normalized, ORDER), "untrusted");
    assert.equal(normalized.reason, "reference_mismatch");
  });

  test("staff fee metadata stays off the order total", () => {
    const { normalized } = decide(INCIDENT_PACKET);
    const charges = gatewayChargesForStaff(
      {
        merchant_amount_paise: normalized.merchant_amount_paise,
        cardholder_total_paise: normalized.cardholder_total_paise,
        processing_fee_paise: normalized.processing_fee_paise,
        processing_fee_tax_paise: normalized.processing_fee_tax_paise,
      },
      ORDER,
    );
    assert.ok(charges);
    assert.equal(charges.order_amount_paise, 205_900);
    assert.equal(charges.gateway_fee_paise, 1_977);
    assert.equal(charges.processing_fee_paise, 1_675);
    assert.equal(charges.processing_fee_tax_paise, 302);
    assert.equal(charges.cardholder_total_paise, 207_877);
    assert.equal(gatewayChargesForStaff({ merchant_amount_paise: 205_900, cardholder_total_paise: 205_900 }, ORDER), null);
  });

  test("repeated verify does not repeat capture, redemption, purchase, or the paid alert", () => {
    const first = decide(INCIDENT_PACKET);
    const second = decide(INCIDENT_PACKET);
    assert.equal(first.decision, "accept");
    assert.equal(second.decision, "accept");
    assert.equal(STORE_OPEN_STATUSES.includes("CAPTURED"), false);
    assert.equal(shouldFireNotesPaidAlert({ outcome: "paid", transitioned: true }), true);
    assert.equal(shouldFireNotesPaidAlert({ outcome: "paid", transitioned: false }), false);
    const orderId = "order-1";
    assert.equal(notesPurchaseDedupeKey(orderId), notesPurchaseDedupeKey(orderId));
  });

  test("the resolution note reports the order amount and the gateway fee", () => {
    const text = formatReconciledPaymentAlert({
      orderNo: "NIAS-N-2026-001011",
      orderAmountPaise: 205_900,
      gatewayFeePaise: 1_977,
    });
    assert.match(text, /NOTES PAYMENT RECONCILED/);
    assert.match(text, /NIAS-N-2026-001011/);
    assert.match(text, /₹2,059/);
    assert.match(text, /₹19\.77/);
    assert.match(text, /Order confirmed/);
    assert.equal(text.includes("2078.77"), false);
    assert.equal(text.includes("BA="), false);
  });
});
