import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { shipmentHandoffBlocked } from "../../lib/store/address";
import { courierCostNotice, explicitCourierSelection, quoteWithinShippingNotice } from "../../lib/store/adminConsole";
import { bookSelectedCourier } from "../../lib/store/shipping/manualBook";
import {
  aliasesForPin,
  canonicalCityForPin,
  cityConfirmationView,
  classifyCourierDestination,
  evaluateProviderReadback,
  normalizedCustomerPhone,
  shipmentQuoteAudit,
} from "../../lib/store/shipping/destinationCheck";

const delhi = { city: "Delhi", state: "Delhi", pincode: "110055" };

test("Delhivery blank telephone with a matching destination passes", () => {
  const decision = evaluateProviderReadback({
    provider: "delhivery",
    order: { city: "Delhi", state: "Delhi", pincode: "110085" },
    stored: { pin: "110085", city: "Delhi", state: "Delhi", phoneStored: false, read: true },
    sentPhone: "9810012345",
  });
  assert.equal(decision.addressMismatch, false);
  assert.equal(decision.cityConfirm, false);
  assert.equal(decision.unverified, false);
});

test("a valid outbound 10-digit phone is still required", () => {
  assert.equal(normalizedCustomerPhone("9810012345"), "9810012345");
  assert.equal(normalizedCustomerPhone("+91 98100 12345"), "9810012345");
  assert.equal(normalizedCustomerPhone("12345"), null);
  assert.equal(normalizedCustomerPhone(""), null);
  const missing = evaluateProviderReadback({
    provider: "delhivery",
    order: delhi,
    stored: { pin: "110055", city: "Delhi", state: "Delhi", phoneStored: false, read: true },
    sentPhone: "12345",
  });
  assert.equal(missing.addressMismatch, true);
});

test("#1002 Delhivery echo with a blank phone passes", () => {
  const decision = evaluateProviderReadback({
    provider: "delhivery",
    order: { city: "Delhi", state: "Delhi", pincode: "110085" },
    stored: { pin: "110085", city: "Delhi", state: "Delhi", phoneStored: false, read: true },
    sentPhone: "9999999999",
  });
  assert.equal(decision.addressMismatch, false);
  assert.equal(decision.cityConfirm, false);
});

test("#1004 Delhivery echo with a blank phone passes", () => {
  const decision = evaluateProviderReadback({
    provider: "delhivery",
    order: delhi,
    stored: { pin: "110055", city: "Delhi", state: "Delhi", phoneStored: false, read: true },
    sentPhone: "9999999999",
  });
  assert.equal(decision.addressMismatch, false);
});

test("#1004 Central Delhi passes only when the PIN cache says so", () => {
  const withoutCache = classifyCourierDestination({
    order: delhi,
    provider: { city: "Central Delhi", state: "Delhi", pincode: "110055" },
  });
  assert.equal(withoutCache.verdict, "confirm");
  const cacheCity = canonicalCityForPin(
    { pincode: "110055", city: "Central Delhi", state: "Delhi" },
    { pincode: "110055", state: "Delhi" },
  );
  const withCache = classifyCourierDestination({
    order: delhi,
    provider: { city: "Central Delhi", state: "Delhi", pincode: "110055" },
    canonicalCity: cacheCity,
  });
  assert.equal(withCache.verdict, "pass");
  assert.equal(withCache.reason, "canonical");
});

test("#1002 district names pass only from PIN canonical or alias data", () => {
  const northWest = classifyCourierDestination({
    order: { city: "Delhi", state: "Delhi", pincode: "110085" },
    provider: { city: "North West Delhi", state: "Delhi", pincode: "110085" },
    canonicalCity: "North Delhi",
  });
  assert.equal(northWest.verdict, "confirm");
  const aliased = classifyCourierDestination({
    order: { city: "Delhi", state: "Delhi", pincode: "110085" },
    provider: { city: "North West Delhi", state: "Delhi", pincode: "110085" },
    canonicalCity: "North Delhi",
    aliases: aliasesForPin("110085"),
  });
  assert.equal(aliased.verdict, "pass");
  assert.equal(aliased.reason, "alias");
  const north = classifyCourierDestination({
    order: { city: "Delhi", state: "Delhi", pincode: "110085" },
    provider: { city: "North Delhi", state: "Delhi", pincode: "110085" },
  });
  assert.equal(north.verdict, "confirm");
  const canonical = classifyCourierDestination({
    order: { city: "Delhi", state: "Delhi", pincode: "110085" },
    provider: { city: "North Delhi", state: "Delhi", pincode: "110085" },
    canonicalCity: "North Delhi",
  });
  assert.equal(canonical.verdict, "pass");
  assert.equal(canonical.reason, "canonical");
  assert.equal(aliasesForPin("110055").includes("North West Delhi"), false);
});

test("#1001 different PIN and state still fail", () => {
  const decision = classifyCourierDestination({
    order: { city: "Panchkula", state: "Haryana", pincode: "134109" },
    provider: { city: "Panchkula", state: "Punjab", pincode: "134111" },
    canonicalCity: "Panchkula",
  });
  assert.equal(decision.verdict, "fail");
  assert.equal(decision.reason, "pin");
});

test("a different state fails even when the PIN matches", () => {
  const decision = classifyCourierDestination({
    order: { city: "Panchkula", state: "Haryana", pincode: "134109" },
    provider: { city: "Panchkula", state: "Punjab", pincode: "134109" },
  });
  assert.equal(decision.verdict, "fail");
  assert.equal(decision.reason, "state");
});

test("an unrelated city fails closed", () => {
  const decision = classifyCourierDestination({
    order: { city: "Pune", state: "Maharashtra", pincode: "411028" },
    provider: { city: "Mumbai", state: "Maharashtra", pincode: "411028" },
    canonicalCity: "Pune",
  });
  assert.equal(decision.verdict, "fail");
  assert.equal(decision.reason, "city");
});

test("an unknown city expansion asks for confirmation and does not rewrite the customer address", () => {
  const decision = classifyCourierDestination({
    order: delhi,
    provider: { city: "New Delhi", state: "Delhi", pincode: "110055" },
  });
  assert.equal(decision.verdict, "confirm");
  const view = cityConfirmationView({
    orderCity: "Delhi",
    orderState: "Delhi",
    providerCity: "Central Delhi",
    providerState: "Delhi",
    pincode: "110055",
  });
  assert.equal(view.customer, "Delhi, Delhi — 110055");
  assert.equal(view.courier, "Central Delhi, Delhi — 110055");
  assert.equal(view.pin, "MATCH");
  assert.equal(view.state, "MATCH");
  assert.equal(view.customer.includes("Central Delhi"), false);
});

test("a cache row for another state is not a canonical city", () => {
  assert.equal(
    canonicalCityForPin({ pincode: "134109", city: "Panchkula", state: "Punjab" }, { pincode: "134109", state: "Haryana" }),
    null,
  );
});

test("city confirmation does not cancel or request pickup", async () => {
  let cancelled = 0;
  let pickups = 0;
  const result = await bookSelectedCourier({
    selected: { provider: "shiprocket", courier: "Xpressbees Surface", service: "Surface", courierId: "51", ratePaise: 9372 },
    activeAwb: null,
    create: async () => ({
      awb: "AWB-CONFIRM",
      labelUrl: null,
      providerOrderId: "o",
      providerShipmentId: "s",
      courierName: "Xpressbees Surface",
      addressMismatch: false,
      cityConfirm: true,
      unverified: false,
      possessed: false,
      storedPin: "110055",
      storedCity: "Central Delhi",
      storedState: "Delhi",
    }),
    cancel: async () => {
      cancelled += 1;
      return true;
    },
    requestPickup: async () => {
      pickups += 1;
    },
  });
  assert.equal(cancelled, 0);
  assert.equal(pickups, 0);
  assert.equal(result.blocked, "CITY_CONFIRM");
  assert.equal(result.creates, 1);
  assert.equal(result.providerCity, "Central Delhi");
  assert.equal(result.pickupRequested, false);
});

test("one active AWB blocks another create", async () => {
  let creates = 0;
  const result = await bookSelectedCourier({
    selected: { provider: "delhivery", courier: "Delhivery Surface", service: "Surface", courierId: null, ratePaise: 4568 },
    activeAwb: "14112364990437",
    create: async () => {
      creates += 1;
      return {
        awb: "NEW",
        labelUrl: null,
        providerOrderId: null,
        providerShipmentId: null,
        courierName: "Delhivery Surface",
        addressMismatch: false,
        unverified: false,
        possessed: false,
      };
    },
    cancel: async () => true,
    requestPickup: async () => undefined,
  });
  assert.equal(creates, 0);
  assert.equal(result.blocked, "EXISTING_AWB");
});

test("an accepted alias can be handed off and a different PIN cannot", () => {
  assert.equal(
    shipmentHandoffBlocked({
      requested_pin: "110055",
      provider_pin: "110055",
      requested_city: "Delhi",
      provider_city: "Central Delhi",
      requested_state: "Delhi",
      provider_state: "Delhi",
    }),
    true,
  );
  assert.equal(
    shipmentHandoffBlocked({
      requested_pin: "110055",
      provider_pin: "110055",
      requested_city: "Delhi",
      provider_city: "Central Delhi",
      requested_state: "Delhi",
      provider_state: "Delhi",
      destination_accepted: true,
    }),
    false,
  );
  assert.equal(
    shipmentHandoffBlocked({
      requested_pin: "134109",
      provider_pin: "134111",
      requested_state: "Haryana",
      provider_state: "Punjab",
      destination_accepted: true,
    }),
    true,
  );
  assert.equal(shipmentHandoffBlocked({ destination_accepted: true, do_not_handoff: true }), true);
});

test("staff still choose the courier and rates above ₹100 stay bookable", () => {
  assert.equal(explicitCourierSelection(null), null);
  assert.equal(quoteWithinShippingNotice(4568), true);
  assert.equal(quoteWithinShippingNotice(10000), true);
  assert.equal(quoteWithinShippingNotice(15684), false);
  const under = courierCostNotice([{ eligible: true, ratePaise: 4568 }]);
  assert.equal(under.underHundred, true);
  assert.equal(under.lowestLine, null);
  const over = courierCostNotice([{ eligible: true, ratePaise: 15684 }]);
  assert.equal(over.underHundred, false);
  assert.match(over.lowestLine || "", /Lowest available rate is ₹156\.84/);
  const audit = shipmentQuoteAudit({
    ratePaise: 4568,
    provider: "delhivery",
    courier: "Delhivery Surface",
    service: "Surface",
    selectedAt: "2026-09-29T00:00:00.000Z",
    selectedBy: "staff",
  });
  assert.equal(audit.quoted_rate_paise, 4568);
  assert.equal(audit.booked_rate_paise, 4568);
  assert.equal("provider_charge_paise" in audit, false);
});

test("compare couriers keeps manual booking and the city confirmation copy", () => {
  const picker = fs.readFileSync(new URL("../../components/notes/admin/orders/CourierPicker.tsx", import.meta.url), "utf8");
  const dispatch = fs.readFileSync(new URL("../../app/api/admin/notes/orders/[id]/dispatch/route.ts", import.meta.url), "utf8");
  assert.match(picker, /CHEAPEST/);
  assert.match(picker, /UNDER ₹100/);
  assert.match(picker, /Lowest available rate is/);
  assert.match(picker, /Shipping exceeds ₹100/);
  assert.match(picker, /COURIER ADDRESS CONFIRMATION/);
  assert.match(picker, /Confirm courier city/);
  assert.match(picker, /Unavailable — destination mismatch/);
  assert.equal(picker.includes("change courier address"), false);
  assert.equal(picker.includes("defaultQuote"), false);
  assert.match(dispatch, /confirm_city/);
  assert.match(dispatch, /decline_city/);
  assert.match(dispatch, /normalizedCustomerPhone/);
  assert.equal(dispatch.includes("runAutoFulfillment"), false);
});
