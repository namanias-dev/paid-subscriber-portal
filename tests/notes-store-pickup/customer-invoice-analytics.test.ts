import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPickupTimeline, formatCustomerWhen, pickupNarrative } from "../../lib/store/pickupTracking";
import { buildTrackingTimeline, trackingNarrative } from "../../lib/store/trackingView";
import { projectCustomerStage } from "../../lib/store/projection";
import { categoriesForStage } from "../../lib/store/issues";
import { getPublicOrder } from "../../lib/store/orders";
import { placeOfSupplyFor, pickupTaxSupported } from "../../lib/store/invoice/placeOfSupply";
import { pickupBuyerLines, pickupCollectionLines } from "../../lib/store/invoice/issue";
import { computeTaxDocument } from "../../lib/store/invoice/tax";
import { renderInvoicePdf } from "../../lib/store/invoice/pdf";
import { buildPickupOps, buildNotesIntel } from "../../lib/analytics/notesIntel";
import { destinationForOrder } from "../../lib/analytics/notesVisuals";
import { formatNotesOrderAlertHtml, resolveNotesAlertCustomer } from "../../lib/telegram/notesOrderAlertFormat";
import { snapshotPickupLocation, PICKUP_LOCATIONS } from "../../lib/store/pickupLocation";

const COURIER_WORDS = /\bawb\b|courier|shipment|expected by|track on courier|delivery address|shipped/i;

test("pickup customer lifecycle: five steps, no courier language at any stage", () => {
  for (const status of ["ORDER_CONFIRMED", "PROCESSING", "PRINTING", "READY_FOR_COLLECTION", "COLLECTED"]) {
    const stage = projectCustomerStage(status, false);
    const steps = buildPickupTimeline({ stage, placedAt: "2026-10-04T06:00:00Z", readyAt: "2026-10-04T08:45:00Z", collectedAt: "2026-10-06T06:10:00Z" });
    assert.deepEqual(steps.map((s) => s.label), ["Order confirmed", "Preparing", "Printing", "Ready for collection", "Collected"]);
    const copy = pickupNarrative({ stage });
    assert.doesNotMatch(`${copy.headline} ${copy.explanation} ${copy.next}`, COURIER_WORDS, status);
    assert.doesNotMatch(`${copy.headline} ${copy.explanation} ${copy.next}`, /\b(\d+\s?(am|pm)|same day|24 hours|2 days|3 days)\b/i, `${status}: no invented hours or SLA`);
  }
  const ready = pickupNarrative({ stage: "ready_for_collection" });
  assert.equal(ready.headline, "Ready for collection");
  assert.match(ready.next, /Collect them from the academy/);
  const collected = buildPickupTimeline({ stage: "collected", collectedAt: "2026-10-06T06:10:00Z" });
  assert.equal(collected.at(-1)?.state, "done");
  assert.equal(collected.at(-1)?.at, "6 Oct, 11:40 am", "IST, never raw UTC");
});

test("delivery tracking: only the courier relabel changed", () => {
  const steps = buildTrackingTimeline({ stage: "packed", orderStatus: "PICKUP_SCHEDULED" });
  assert.equal(steps.find((s) => s.id === "pickup")?.label, "Courier pickup scheduled");
  assert.equal(steps.length, 9);
  assert.doesNotMatch(steps.map((s) => s.label).join(" "), /academy|collection/i, "no Academy Pickup copy on delivery");
  assert.equal(trackingNarrative({ stage: "packed", orderStatus: "PICKUP_SCHEDULED" }).headline, "Courier pickup scheduled");
  assert.equal(trackingNarrative({ stage: "delivered" }).headline, "Delivered");
});

test("pickup issue categories never offer courier problems", () => {
  for (const stage of ["confirmed", "preparing", "printing", "ready_for_collection", "collected"] as const) {
    const cats = categoriesForStage(stage, "ACADEMY_PICKUP");
    for (const courier of ["ADDRESS_ISSUE", "DELIVERY_DELAY", "PICKUP_ISSUE", "TRACKING_ISSUE"]) assert.equal(cats.includes(courier as never), false, `${stage} ${courier}`);
  }
  assert.ok(categoriesForStage("ready_for_collection", "ACADEMY_PICKUP").includes("CANNOT_COLLECT"));
  assert.ok(categoriesForStage("printing").includes("PICKUP_ISSUE"), "delivery unchanged");
});

test("public order for pickup: no shipment read, no courier fields, Free fulfilment, frozen location", async () => {
  const { fakeDb } = await import("./fakeDb");
  const { hashStoreAccessToken } = await import("../../lib/store/accessToken");
  const snap = snapshotPickupLocation(PICKUP_LOCATIONS.CHD_17C);
  const db = fakeDb({
    store_orders: [{
      id: "o1", order_no: "NIAS-N-2026-009001", status: "READY_FOR_COLLECTION", placed_at: "2026-10-04T06:00:00Z",
      subtotal_paise: 299900, discount_paise: 0, shipping_paise: 0, total_paise: 299900, tracking_token_hash: hashStoreAccessToken("tok"),
      shipping_address_id: null, fulfillment_method: "ACADEMY_PICKUP", pickup_location_snapshot: snap,
      ready_for_collection_at: "2026-10-04T08:45:00Z", collected_at: null, customer_location_snapshot: { city: "Mohali", state: "Punjab", pincode: "160062" },
      promised_delivery_date: null,
    }],
    store_order_items: [{ order_id: "o1", name_snapshot: "Indian Polity Notes", qty: 1, line_total_paise: 299900 }],
    store_shipments: [{ order_id: "o1", awb: "SHOULD-NEVER-SHOW", courier_name: "X" }],
  });
  const pub = await getPublicOrder("NIAS-N-2026-009001", { trackingToken: "tok", db: db.client });
  assert.ok(pub);
  assert.equal(pub!.fulfillment_method, "ACADEMY_PICKUP");
  assert.equal(pub!.awb, null);
  assert.equal(pub!.courier, null);
  assert.equal(pub!.courier_track_url, null);
  assert.equal(pub!.ship_to, null);
  assert.equal(pub!.promised_delivery_date, null);
  assert.equal(pub!.shipping_label, "Free");
  assert.equal(pub!.pickup_location?.name, "Naman Sharma IAS Academy");
  assert.equal(pub!.stage, "ready_for_collection");
  assert.equal(pub!.customer_location?.city, "Mohali");
  assert.equal(db.calls.some((c) => c.table === "store_shipments"), false, "pickup never reads shipments");
  assert.equal(await getPublicOrder("NIAS-N-2026-009001", { trackingToken: "wrong", db: db.client }), null, "token still required");
});

test("invoice: place of supply rule, taxable pickup refused, collection block", async () => {
  assert.deepEqual(placeOfSupplyFor({ fulfillment_method: "DELIVERY" }, { state: "Delhi" }), { state: "Delhi", source: "delivery_address" });
  assert.deepEqual(placeOfSupplyFor({}, { state: "Delhi" }), { state: "Delhi", source: "delivery_address" }, "historical rows unchanged");
  assert.deepEqual(placeOfSupplyFor({ fulfillment_method: "ACADEMY_PICKUP", customer_location_snapshot: { state: "Punjab" } }, null), { state: "Punjab", source: "pickup_customer_location_interim" });
  assert.equal(placeOfSupplyFor({ fulfillment_method: "ACADEMY_PICKUP" }, null).state, null);
  assert.equal(pickupTaxSupported([{ tax_rate_bps: 0, tax_treatment: "exempt" }, { taxRateBps: 0 }]), true);
  assert.equal(pickupTaxSupported([{ tax_rate_bps: 1200, tax_treatment: "taxable" }]), false);
  assert.deepEqual(pickupBuyerLines("Priya", { city: "Mohali", state: "Punjab", pincode: "160062" }), ["Priya", "Mohali, Punjab 160062", "India"]);
  assert.deepEqual(pickupCollectionLines({ name: "Naman Sharma IAS Academy", address_lines: ["SCO 173–174, 2nd Floor", "Sector 17C, Chandigarh"] }), ["Academy Pickup", "Naman Sharma IAS Academy", "SCO 173–174, 2nd Floor", "Sector 17C, Chandigarh"]);

  const tax = computeTaxDocument({
    lines: [{ name: "Indian Polity Notes", sku: "NOTES-POLITY", hsn: "49011010", qty: 1, lineTotalPaise: 239920, discountPaise: 59980, taxTreatment: "exempt", taxRateBps: 0 }],
    shippingPaise: 0,
    pricesIncludeTax: true,
    supplierStateCode: "04",
    placeOfSupplyCode: "03",
    chargedTotalPaise: 239920,
  });
  assert.equal(tax.shippingPaise, 0);
  assert.equal(tax.roundingPaise, 0, "zero shipping still reconciles to the captured amount");
  const pdf = Buffer.from(await renderInvoicePdf({
    documentType: "BILL_OF_SUPPLY",
    invoiceNumber: "TEST/26-27/00099",
    orderNumber: "NIAS-N-PICKUP",
    issuedAt: "5 Oct 2026",
    sellerName: "Naman IAS Academy",
    sellerLines: ["Chandigarh"],
    buyerLines: pickupBuyerLines("Priya", { city: "Mohali", state: "Punjab", pincode: "160062" }),
    shipLines: pickupCollectionLines({ name: "Naman Sharma IAS Academy", address_lines: ["SCO 173–174, 2nd Floor", "Sector 17C, Chandigarh"] }),
    shipHeading: "COLLECTION AT",
    shippingLabel: "Academy pickup",
    paymentReference: "NIASN-N-TEST",
    paidAt: null,
    tax,
    words: "Rupees",
    footer: null,
    attention: null,
  }));
  assert.ok(pdf.subarray(0, 5).toString() === "%PDF-");
  let text = "";
  try {
    const dir = mkdtempSync(join(tmpdir(), "pickup-invoice-"));
    writeFileSync(join(dir, "i.pdf"), pdf);
    text = execFileSync("pdftotext", [join(dir, "i.pdf"), "-"], { encoding: "utf8" });
  } catch {
    return; // Poppler not installed here; model-level assertions above still hold.
  }
  assert.match(text, /COLLECTION AT/);
  assert.match(text, /Academy pickup\s+₹0\.00/);
  assert.doesNotMatch(text, /SHIP TO/);
  assert.match(text, /Mohali, Punjab 160062/);
});

test("analytics: method split reconciles, pickup never in shipping stats, geography uses the buyer", () => {
  const paid = (id: string, extra: Record<string, unknown>) => ({ id, order_no: id, status: "IN_TRANSIT", total_paise: 250000, shipping_paise: 5900, discount_paise: 0, paid_at: "2026-10-03T06:00:00Z", shipping_address_id: `a-${id}`, ...extra });
  const orders = [
    ...Array.from({ length: 7 }, (_, i) => paid(`d${i}`, {})),
    paid("p0", { status: "PRINTING", shipping_paise: 0, total_paise: 299900, shipping_address_id: null, fulfillment_method: "ACADEMY_PICKUP", customer_location_snapshot: { city: "Mohali", state: "Punjab" } }),
    paid("p1", { status: "READY_FOR_COLLECTION", shipping_paise: 0, total_paise: 299900, shipping_address_id: null, fulfillment_method: "ACADEMY_PICKUP", ready_for_collection_at: "2026-10-03T10:00:00Z", customer_location_snapshot: { city: "Panchkula", state: "Haryana" } }),
    paid("p2", { status: "COLLECTED", shipping_paise: 0, total_paise: 299900, shipping_address_id: null, fulfillment_method: "ACADEMY_PICKUP", ready_for_collection_at: "2026-10-03T10:00:00Z", collected_at: "2026-10-04T10:00:00Z", customer_location_snapshot: { city: "New Delhi", state: "Delhi" } }),
  ];
  const items = orders.map((o) => ({ order_id: o.id, product_id: "pol", name_snapshot: "Indian Polity Notes", qty: 1, line_total_paise: o.total_paise - o.shipping_paise }));
  const destinations = orders.map((o) => destinationForOrder(o.id, null, o.shipping_address_id ? { city: "Pune", state: "Maharashtra" } : null, (o as { customer_location_snapshot?: { city: string; state: string } }).customer_location_snapshot || null));
  assert.equal(destinations.find((d) => d.orderId === "p0")?.state, "Punjab", "pickup geography is the buyer, never the academy");
  assert.equal(destinations.filter((d) => /chandigarh/i.test(d.city || "")).length, 0);
  const intel = buildNotesIntel({
    orders: orders as never,
    items: items as never,
    products: [{ id: "pol", name: "Indian Polity Notes", subject: "Polity", kind: "single", selling_price_paise: 299900 }] as never,
    shipments: [],
    destinations,
    start: new Date("2026-10-01T00:00:00Z"),
    end: new Date("2026-10-06T00:00:00Z"),
    todayStart: new Date("2026-10-05T18:30:00Z"),
    todayEnd: new Date("2026-10-06T18:30:00Z"),
    now: new Date("2026-10-06T00:00:00Z"),
  });
  assert.equal(intel.cohort.orders, 10);
  assert.equal(intel.methods.delivery.orders, 7);
  assert.equal(intel.methods.pickup.orders, 3);
  assert.equal(intel.methods.delivery.orders + intel.methods.pickup.orders, intel.cohort.orders);
  assert.equal(intel.methods.delivery.revenuePaise + intel.methods.pickup.revenuePaise, intel.cohort.revenuePaise);
  assert.equal(intel.methods.delivery.units + intel.methods.pickup.units, intel.cohort.units);
  assert.equal(intel.shipping.paidOrders, 7, "coverage context counts delivery orders only");
  assert.equal(intel.shipping.count, 0, "no pickup courier rate rows");
  assert.equal(intel.shipping.booked, 0, "no pickup booked shipments");
  assert.equal(intel.anomalies.length, 0);
  const stateTotal = intel.states.reduce((sum, row) => sum + row.orders, 0);
  assert.equal(stateTotal, 10, "geography keeps every paid order");
  assert.ok(intel.states.some((row) => row.name === "Punjab"));
  assert.equal(intel.pickupOps.readyNow, 1);
  assert.equal(intel.pickupOps.collectedInRange, 1);
  assert.equal(intel.pickupOps.readyToCollectedSample, 1);
  assert.ok(!Number.isNaN(intel.methods.pickup.aovPaise));
});

test("pickup ops are empty-safe", () => {
  const ops = buildPickupOps([], new Date(0), new Date(), new Date(0), new Date(), new Date());
  assert.deepEqual([ops.readyNow, ops.collectedInRange, ops.medianPaidToReadyMs, ops.oldestReadyMs], [0, 0, null, null]);
});

test("telegram paid alert names the fulfilment method", () => {
  const base = { orderNo: "NIAS-N-1", sequence: 3, items: [{ name: "Indian Polity Notes", qty: 1 }], paidPaise: 299900, paidAt: "2026-10-05T06:00:00Z", todayCount: 1, totalCount: 42 };
  const pickup = formatNotesOrderAlertHtml({ ...base, customer: resolveNotesAlertCustomer({ customerName: "A Very Long Customer Name For Testing", orderPhone: "9876543210", city: "Mohali", fulfillment: "ACADEMY_PICKUP" }) });
  assert.match(pickup, /Fulfillment:<\/b> Academy Pickup — no courier booking/);
  assert.match(pickup, /City:<\/b> Mohali/);
  const delivery = formatNotesOrderAlertHtml({ ...base, customer: resolveNotesAlertCustomer({ customerName: "A", orderPhone: "9876543210", city: "Pune" }) });
  assert.match(delivery, /Fulfillment:<\/b> Delivery/);
  const noCity = formatNotesOrderAlertHtml({ ...base, customer: resolveNotesAlertCustomer({ customerName: "A", fulfillment: "ACADEMY_PICKUP" }) });
  assert.match(noCity, /City:<\/b> Not available/);
});

test("customer times are formatted identically on server and every browser (no Intl drift, IST)", () => {
  assert.equal(formatCustomerWhen("2026-10-06T06:10:00Z"), "6 Oct, 11:40 am");
  assert.equal(formatCustomerWhen("2026-10-05T18:45:00Z"), "6 Oct, 12:15 am");
  assert.equal(formatCustomerWhen("2026-12-31T06:30:00Z"), "31 Dec, 12:00 pm");
  assert.equal(formatCustomerWhen("nonsense"), null);
});
