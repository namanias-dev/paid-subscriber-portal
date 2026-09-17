import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  isStoreReference,
  isWellFormedStoreReference,
  makeStoreReference,
  STORE_REFERENCE_PREFIX,
} from "../../lib/store/references";
import {
  mapStoreVerifyStatus,
  nextVerifyDelayMs,
  storeSettlementFor,
  storeStatusForOutcome,
} from "../../lib/store/payments/status";
import { paiseToGatewayAmount } from "../../lib/store/payments/eazypay";

describe("store reference namespace", () => {
  test("generated references are in the store namespace and well formed", () => {
    for (let i = 0; i < 200; i += 1) {
      const ref = makeStoreReference();
      assert.ok(ref.startsWith(STORE_REFERENCE_PREFIX), ref);
      assert.ok(isStoreReference(ref), ref);
      assert.ok(isWellFormedStoreReference(ref), ref);
      assert.ok(ref.length <= 32, `${ref} too long for the gateway field`);
    }
  });

  test("generated references do not collide", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) seen.add(makeStoreReference());
    assert.equal(seen.size, 5000);
  });

  test("every reference prefix that exists in production is rejected", () => {
    // The complete set of first segments across all 2,429 rows of public.payments.
    for (const ref of [
      "NAMAN-KL7X9Q-4821",
      "OFF-2X8K1-9931",
      "LEGACY-88213",
      "SAARTHI-4471-AB",
      "",
      "NIASN",
      "NIASN-",
      "XNIASN-N-ABCD-12",
      "nothing-like-it",
    ]) {
      assert.equal(isStoreReference(ref), false, ref);
    }
  });

  test("case and whitespace cannot smuggle a reference past the check", () => {
    assert.equal(isStoreReference("  niasn-n-abcd-12  "), true);
    assert.equal(isStoreReference("NAMAN-NIASN-N-ABCD"), false);
  });
});

describe("store verify status mapping (copied, not imported)", () => {
  test("money received maps to paid", () => {
    for (const s of ["Success", "SUCCESS", "paid", "RIP", "SIP"]) {
      assert.equal(mapStoreVerifyStatus(s), "paid", s);
    }
  });

  test("settlement is recorded separately from paid-ness", () => {
    assert.equal(storeSettlementFor("Success"), "settled");
    assert.equal(storeSettlementFor("RIP"), "in_progress");
    assert.equal(storeSettlementFor("Initiated"), null);
  });

  test("never-started maps to expired, including ICICI's misspelling", () => {
    for (const s of ["NotInitiated", "Not Initiated", "not_initiated", "NotInitated"]) {
      assert.equal(mapStoreVerifyStatus(s), "expired", s);
    }
  });

  test("gateway failures map to failed", () => {
    for (const s of ["Failed", "Timeout", "Expired", "Cancelled", "Rejected", "Declined", "Returned"]) {
      assert.equal(mapStoreVerifyStatus(s), "failed", s);
    }
  });

  test("ambiguity is never a terminal, and never writes", () => {
    for (const s of ["Initiated", "Challan Generated", "In Clearance", "", null, undefined, "wat"]) {
      assert.equal(mapStoreVerifyStatus(s), "unknown", String(s));
    }
    assert.equal(storeStatusForOutcome("unknown"), null);
  });

  test("outcomes map onto the store's own ledger statuses", () => {
    assert.equal(storeStatusForOutcome("paid"), "CAPTURED");
    assert.equal(storeStatusForOutcome("failed"), "FAILED");
    assert.equal(storeStatusForOutcome("expired"), "EXPIRED");
  });

  test("verify backoff grows and eventually gives up", () => {
    assert.equal(nextVerifyDelayMs(0), 2 * 60_000);
    assert.ok(nextVerifyDelayMs(1)! > nextVerifyDelayMs(0)!);
    assert.equal(nextVerifyDelayMs(999), null);
  });
});

describe("gateway amount formatting", () => {
  test("whole rupees are sent without decimals, matching the course path", () => {
    assert.equal(paiseToGatewayAmount(100), "1");
    assert.equal(paiseToGatewayAmount(129900), "1299");
  });
  test("part rupees keep two decimals", () => {
    assert.equal(paiseToGatewayAmount(150), "1.50");
    assert.equal(paiseToGatewayAmount(99), "0.99");
  });
});
