import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkoutFailureReason } from "../../lib/analytics/checkoutFailure";

describe("checkout failure reasons", () => {
  it("maps shopper-visible failures to stable codes and keeps the raw text out of analytics", () => {
    assert.equal(checkoutFailureReason("Confirm the delivery address before paying."), "address_unconfirmed");
    assert.equal(checkoutFailureReason("Your cart is empty"), "empty_cart");
    assert.equal(checkoutFailureReason("Failed to fetch"), "network");
    assert.equal(checkoutFailureReason("Payment response was not valid JSON."), "bad_response");
    assert.equal(checkoutFailureReason("Too many attempts. Please wait a few minutes."), "rate_limited");
    assert.equal(checkoutFailureReason("Just sold out: Polity"), "unavailable");
    assert.equal(checkoutFailureReason("This offer is no longer available. Please review the updated price and try again."), "unavailable");
    assert.equal(checkoutFailureReason("Enter a 10-digit mobile number"), "phone");
    assert.equal(checkoutFailureReason("Payment could not be started."), "gateway");
    assert.equal(checkoutFailureReason("could not save the order"), "checkout_rejected");
  });

  it("keeps a pay-button retry from being recorded as an ICICI failure", () => {
    const src = readFileSync(new URL("../../components/notes/CheckoutForm.tsx", import.meta.url), "utf8");
    assert.equal(src.includes('stage: "checkout_submit"'), false);
    assert.equal(src.includes("notes_payment_failed"), false);
    assert.equal(src.includes("submitLock"), true);
    assert.equal(src.includes("checkoutFailureReason"), true);
  });
});