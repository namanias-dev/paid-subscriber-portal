import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { customerShipTo, keepCanonicalAddress, pinPlaceConflict, providerDestinationMismatch, shipmentHandoffBlocked, type CanonicalAddress } from "../../lib/store/address";

const CANONICAL: CanonicalAddress = {
  line1: "H No. 1920 P",
  line2: "Sector-28",
  city: "Panchkula",
  state: "Haryana",
  pincode: "134109",
  country: "India",
};

describe("canonical shipping address", () => {
  test("the customer summary keeps Sector-28 and PIN 134109", () => {
    const summary = customerShipTo(CANONICAL);
    assert.match(summary, /H No\. 1920 P/);
    assert.match(summary, /Sector-28/);
    assert.match(summary, /Panchkula/);
    assert.match(summary, /Haryana/);
    assert.match(summary, /134109/);
    assert.equal(summary.includes("134116"), false);
  });

  test("a Zirakpur hub cannot rewrite Panchkula or the PIN", () => {
    const kept = keepCanonicalAddress(CANONICAL, {
      hub: "Zirakpur_Dhakoli_D (Punjab)",
      city: "Zirakpur",
      state: "Punjab",
      pincode: "134116",
    });
    assert.equal(kept.pincode, "134109");
    assert.equal(kept.city, "Panchkula");
    assert.equal(kept.state, "Haryana");
    assert.equal(kept.line2, "Sector-28");
    assert.equal(JSON.stringify(kept).includes("134116"), false);
    assert.equal(/zirakpur|dhakoli|punjab/i.test(JSON.stringify(kept)), false);
  });

  test("Panchkula and Haryana agree with PIN 134109", () => {
    assert.equal(pinPlaceConflict("Panchkula", "Haryana", "Panchkula", "Haryana"), null);
  });

  test("a courier PIN or state that is not 134109 Haryana blocks handoff", () => {
    assert.equal(
      providerDestinationMismatch(
        { city: "Panchkula", state: "Haryana", pincode: "134109" },
        { city: "Panchkula", state: "Haryana", pincode: "134109" },
      ),
      false,
    );
    assert.equal(
      providerDestinationMismatch(
        { city: "Panchkula", state: "Haryana", pincode: "134109" },
        { city: "Panchkula", state: "Punjab", pincode: "134111" },
      ),
      true,
    );
    assert.equal(
      shipmentHandoffBlocked({ requested_pin: "134109", provider_pin: "134111", do_not_handoff: true }),
      true,
    );
    assert.equal(shipmentHandoffBlocked({ requested_pin: "134109", provider_pin: "134109" }), false);
  });

  test("Zirakpur or Punjab against a Panchkula PIN must be confirmed", () => {
    const message = pinPlaceConflict("Zirakpur", "Punjab", "Panchkula", "Haryana");
    assert.ok(message);
    assert.match(message || "", /Panchkula, Haryana/);
  });
});
