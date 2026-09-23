import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { computePromisedDate, isValidPincode, matchZone, PHASE1_DELIVERY_BUFFER_DAYS } from "../../lib/store/serviceability";
import { projectCustomerStage } from "../../lib/store/projection";

describe("delivery date buffer", () => {
  test("buffer is two days", () => {
    assert.equal(PHASE1_DELIVERY_BUFFER_DAYS, 2);
  });

  test("promised date is dispatch + transit max + buffer, in IST", () => {
    const from = new Date("2026-09-17T18:30:00.000Z"); // midnight IST on the 18th
    // dispatch 2, transit 4, buffer 2 → +8 calendar days from 18 Sep = 26 Sep
    assert.equal(computePromisedDate(2, 4, from), "2026-09-26");
  });

  test("PIN shape", () => {
    assert.equal(isValidPincode("160036"), true);
    assert.equal(isValidPincode("016036"), false);
    assert.equal(isValidPincode("16003"), false);
  });

  test("longest prefix wins", () => {
    const zone = matchZone("160036", [
      { pincode_prefix: "", zone: "national", label: "x", transit_days_min: 5, transit_days_max: 9, shipping_paise: 1, free_above_paise: null, serviceable: true },
      { pincode_prefix: "16", zone: "local", label: "chd", transit_days_min: 1, transit_days_max: 2, shipping_paise: 1, free_above_paise: null, serviceable: true },
    ]);
    assert.equal(zone.zone, "local");
  });
});

describe("customer projection", () => {
  test("packed stays packed until the courier has the parcel", () => {
    assert.equal(projectCustomerStage("PACKED", false), "packed");
    assert.equal(projectCustomerStage("PACKED", true), "packed");
    assert.equal(projectCustomerStage("PICKED_UP", true), "shipped");
    assert.equal(projectCustomerStage("IN_TRANSIT", true), "in_transit");
    assert.equal(projectCustomerStage("ORDER_CONFIRMED", false), "confirmed");
    assert.equal(projectCustomerStage("PAYMENT_PENDING", false), "pending");
    assert.equal(projectCustomerStage("DELIVERED", true), "delivered");
  });
});
