/**
 * Delivery address confirmation and correction rules. No courier calls.
 * Run: npx tsx tests/notes-store-address/delivery-address.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pinPlaceConflict } from "../../lib/store/address";
import {
  activeCustomerShipment,
  addressAnalyticsProps,
  addressFingerprint,
  canonicalDelivery,
  confirmationMatches,
  decideAddressChange,
  formatDeliveryAddress,
  buildDeliveryGoogleMapsUrl,
  deliveryMapsQuery,
  materialAddressChange,
  oneActiveAwb,
} from "../../lib/store/deliveryAddress";
import { executeAddressCorrection } from "../../lib/store/deliveryAddressChange";

let passed = 0;
const pending: Promise<void>[] = [];
function check(name: string, fn: () => void | Promise<void>) {
  pending.push((async () => {
    await fn();
    passed += 1;
    console.log(`ok ${name}`);
  })());
}

const base = { line1: "H No. 1920 P", line2: "Sector 28", city: "Panchkula", state: "Haryana", pincode: "134109" };

check("PIN and city conflict blocks confirmation", () => {
  assert.match(pinPlaceConflict("Zirakpur", "Punjab", "Panchkula", "Haryana") || "", /Panchkula/);
  assert.equal(pinPlaceConflict("Panchkula", "Haryana", "Panchkula", "Haryana"), null);
});

check("raw spacing is collapsed and the house number stays", () => {
  const canonical = canonicalDelivery({ ...base, line1: "  H No. 1920 P  " });
  assert.equal(canonical.line1, "H No. 1920 P");
  assert.equal(canonical.pincode, "134109");
});

check("confirmation hash changes when the street or PIN changes", () => {
  const hash = addressFingerprint(base);
  assert.equal(confirmationMatches(base, hash), true);
  assert.equal(confirmationMatches({ ...base, line1: "H No. 1921 P" }, hash), false);
  assert.equal(confirmationMatches({ ...base, pincode: "134116" }, hash), false);
  assert.equal(addressFingerprint({ ...base, line2: "Sector-28" }), addressFingerprint({ ...base, line2: "Sector 28" }));
});

check("maps URL encodes the address and has no API key", () => {
  const url = new URL(buildDeliveryGoogleMapsUrl(base) || "");
  assert.equal(url.origin + url.pathname, "https://www.google.com/maps/search/");
  assert.equal(url.searchParams.get("api"), "1");
  assert.match(url.searchParams.get("query") || "", /H No\. 1920 P/);
  assert.match(url.searchParams.get("query") || "", /134109/);
  assert.equal(url.searchParams.get("key"), null);
});

check("checkout maps query is the delivery destination, not the academy", () => {
  const destination = { line1: "1920-P", line2: "Sector-28", city: "Panchkula", state: "Haryana", pincode: "134116" };
  const query = deliveryMapsQuery(destination);
  const card = formatDeliveryAddress(destination);
  const url = new URL(buildDeliveryGoogleMapsUrl(destination) || "");
  assert.equal(url.searchParams.get("query"), query);
  assert.equal(query, "1920-P, Sector-28, Panchkula, Haryana, 134116, India");
  for (const token of ["1920-P", "Sector-28", "Panchkula", "Haryana", "134116", "India"]) {
    assert.match(card, new RegExp(token.replace("-", "\\-")));
    assert.match(query || "", new RegExp(token.replace("-", "\\-")));
  }
  assert.equal((query || "").includes("Naman Sharma IAS Academy"), false);
  assert.equal((query || "").includes("SCO 173"), false);
  assert.equal((query || "").includes("Sector 17"), false);
  assert.equal((query || "").includes("160017"), false);
  assert.equal(deliveryMapsQuery({ ...destination, line1: "1921-P" }), "1921-P, Sector-28, Panchkula, Haryana, 134116, India");
});

check("a second destination does not reuse the first address", () => {
  const query = deliveryMapsQuery({ line1: "55", line2: "Sector 8", city: "Chandigarh", state: "Chandigarh", pincode: "160009" });
  assert.equal(query, "55, Sector 8, Chandigarh, Chandigarh, 160009, India");
  assert.equal((query || "").includes("1920-P"), false);
  assert.equal((query || "").includes("134116"), false);
});

check("maps encoding keeps hyphens, slashes, and apostrophes", () => {
  const destination = { line1: "12/A O'Brien", line2: "Sector-28", city: "Panchkula", state: "Haryana", pincode: "134116" };
  const query = deliveryMapsQuery(destination);
  const url = new URL(buildDeliveryGoogleMapsUrl(destination) || "");
  assert.equal(url.searchParams.get("query"), query);
  assert.match(query || "", /12\/A O'Brien/);
  assert.equal(buildDeliveryGoogleMapsUrl({ line1: "", line2: "Sector-28", city: "Panchkula", state: "Haryana", pincode: "134116" }), null);
});

check("delivery maps helper does not read the academy address", () => {
  const src = readFileSync(new URL("../../lib/store/deliveryAddress.ts", import.meta.url), "utf8");
  assert.match(src, /function buildDeliveryGoogleMapsUrl/);
  assert.doesNotMatch(src, /Naman Sharma IAS Academy/);
  assert.doesNotMatch(src, /directionsUrl/);
  assert.doesNotMatch(src, /SCO 173/);
  const checkout = readFileSync(new URL("../../components/notes/CheckoutForm.tsx", import.meta.url), "utf8");
  assert.match(checkout, /buildDeliveryGoogleMapsUrl\(canonical\)/);
  assert.match(checkout, /formatDeliveryAddress\(canonical\)/);
});

check("analytics props do not carry the street", () => {
  const props = addressAnalyticsProps({ reason: "pin_conflict", itemCount: 1 });
  assert.equal("line1" in props, false);
  assert.equal("phone" in props, false);
  assert.equal(props.reason, "pin_conflict");
});

check("no shipment updates the order address only", async () => {
  let updated = false;
  const result = await executeAddressCorrection({
    decision: decideAddressChange({ orderStatus: "ORDER_CONFIRMED", lockFresh: false, shipmentStatus: null, awb: null, possessed: false }),
    confirmRebook: false,
    recordRequest: false,
  }, {
    updateAddress: async () => { updated = true; },
    cancelActive: async () => "cancelled",
    refulfill: async () => { throw new Error("no rebook"); },
    recordRequest: async () => { throw new Error("no request"); },
  });
  assert.equal(result.code, "UPDATED");
  assert.equal(updated, true);
});

check("active AWB asks before rebook and stops when cancellation is ambiguous", async () => {
  const decision = decideAddressChange({ orderStatus: "PACKED", lockFresh: false, shipmentStatus: "created", awb: "AWB1", possessed: false });
  assert.equal(decision.action, "rebook");
  let created = 0;
  const preview = await executeAddressCorrection({ decision, confirmRebook: false, recordRequest: false }, {
    updateAddress: async () => { created += 1; },
    cancelActive: async () => "cancelled",
    refulfill: async () => ({ ok: true, awb: "AWB2" }),
    recordRequest: async () => {},
  });
  assert.equal(preview.code, "CONFIRM_REBOOK");
  assert.equal(created, 0);
  const ambiguous = await executeAddressCorrection({ decision, confirmRebook: true, recordRequest: false }, {
    updateAddress: async () => { created += 1; },
    cancelActive: async () => "ambiguous",
    refulfill: async () => ({ ok: true, awb: "AWB2" }),
    recordRequest: async () => {},
  });
  assert.equal(ambiguous.code, "ACTION_REQUIRED");
  assert.equal(created, 0);
});

check("confirmed cancellation updates once and keeps one active AWB", async () => {
  const rows = [{ awb: "OLD", status: "created" }, { awb: "NEW", status: "created" }];
  assert.equal(oneActiveAwb(rows), false);
  const decision = decideAddressChange({ orderStatus: "PACKED", lockFresh: false, shipmentStatus: "created", awb: "OLD", possessed: false });
  const result = await executeAddressCorrection({ decision, confirmRebook: true, recordRequest: false }, {
    updateAddress: async () => { rows[0].status = "cancelled"; },
    cancelActive: async () => "cancelled",
    refulfill: async () => ({ ok: true, awb: "NEW" }),
    recordRequest: async () => {},
  });
  assert.equal(result.rebooked, true);
  assert.equal(oneActiveAwb(rows), true);
  assert.equal(activeCustomerShipment(rows)?.awb, "NEW");
});

check("carrier possession blocks the rewrite and delivered stays immutable", () => {
  assert.equal(decideAddressChange({ orderStatus: "IN_TRANSIT", lockFresh: false, shipmentStatus: "in_transit", awb: "AWB", possessed: true }).action, "request_only");
  assert.equal(decideAddressChange({ orderStatus: "DELIVERED", lockFresh: false, shipmentStatus: "delivered", awb: "AWB", possessed: true }).action, "immutable");
  assert.equal(decideAddressChange({ orderStatus: "ORDER_CONFIRMED", lockFresh: true, shipmentStatus: null, awb: null, possessed: false }).action, "busy");
});

check("material PIN change is distinct from a landmark edit", () => {
  assert.equal(materialAddressChange(base, { ...base, pincode: "134116" }), true);
  assert.equal(materialAddressChange(base, { ...base, line1: "H No. 1920 P, near park" }), false);
});

check("checkout still requires the confirmation hash before payment", () => {
  const src = readFileSync(new URL("../../lib/store/checkout.ts", import.meta.url), "utf8");
  assert.match(src, /Confirm the delivery address before paying/);
  assert.match(src, /CUSTOMER_CONFIRMED/);
});

check("admin address route is staff-only", () => {
  const src = readFileSync(new URL("../../app/api/admin/notes/orders/address/route.ts", import.meta.url), "utf8");
  assert.match(src, /requireFreshPermission\("store_manage_orders"\)/);
});

void Promise.all(pending).then(() => {
  console.log(`\n${passed} passed`);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
