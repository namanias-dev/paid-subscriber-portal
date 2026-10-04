/**
 * Notes analytics intelligence: subjects, cumulative sales, fulfillment events,
 * geography, booked shipping economics and rate anomalies.
 * Fixtures are synthetic. Screenshot numbers are never asserted.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { aggregateNotesAnalytics, notesRangeBounds } from "../../lib/analytics/notesCommerce";
import { buildNotesVisuals, type NotesDestination } from "../../lib/analytics/notesVisuals";
import {
  allocateByWeight,
  ANOMALY_RULE,
  buildNotesIntel,
  judgeRate,
  medianOf,
  rateDistribution,
  subjectLinesForOrder,
  weightBand,
  type IntelItem,
  type IntelOrder,
  type IntelProduct,
  type IntelShipment,
  type NotesIntel,
} from "../../lib/analytics/notesIntel";
import { cumulative, timelineSeries } from "../../lib/analytics/notesTimeline";
import { normalizeIndiaState, SHAPE_STATES } from "../../lib/analytics/indiaStates";
import { mergeStateRows, rankGeo } from "../../lib/analytics/notesGeo";
import { shippingRateStats } from "../../lib/store/orderOps";
import { INDIA_SHAPES } from "../../components/notes/admin/analytics/indiaShapes";

const NOW = new Date("2026-10-03T12:00:00.000Z"); // 17:30 IST
const RANGE = notesRangeBounds("30d", NOW);
const TODAY = notesRangeBounds("today", NOW);

const POLITY: IntelProduct = { id: "p-polity", name: "Indian Polity Notes", subject: "Polity", kind: "single", selling_price_paise: 259900, weight_grams: 500, length_mm: 300, width_mm: 220, height_mm: 30 };
const ECONOMY: IntelProduct = { id: "p-economy", name: "Indian Economy Notes", subject: "Economy", kind: "single", selling_price_paise: 257900, weight_grams: 500, length_mm: 300, width_mm: 220, height_mm: 30 };
const HISTORY: IntelProduct = { id: "p-history", name: "Modern History Notes", subject: "Modern History", kind: "single", selling_price_paise: 249900, weight_grams: 450 };
const PRODUCTS = [POLITY, ECONOMY, HISTORY];

function order(id: string, partial: Partial<IntelOrder> = {}): IntelOrder {
  return {
    id,
    order_no: `NIAS-N-${id.replace(/\D/g, "").padStart(5, "0")}`,
    status: "DELIVERED",
    total_paise: 259900,
    shipping_paise: 0,
    paid_at: "2026-09-28T06:00:00.000Z",
    ...partial,
  };
}

function line(orderId: string, product: IntelProduct, qty: number, total: number): IntelItem {
  return { order_id: orderId, product_id: product.id, name_snapshot: product.name, qty, line_total_paise: total };
}

function ship(orderId: string, partial: Partial<IntelShipment> & { rate?: number | null } = {}): IntelShipment {
  const { rate, ...rest } = partial;
  return {
    order_id: orderId,
    provider: "shiprocket",
    courier_name: "Xpressbees Surface",
    status: "delivered",
    awb: `AWB${orderId}${rest.created_at || ""}`,
    weight_grams: 500,
    provider_payload: rate == null ? {} : { booked_rate_paise: rate },
    created_at: "2026-09-28T08:00:00.000Z",
    ...rest,
  };
}

function dest(orderId: string, state: string | null, city: string | null = "City"): NotesDestination {
  return { orderId, state, city };
}

function build(input: { orders: IntelOrder[]; items?: IntelItem[]; shipments?: IntelShipment[]; destinations?: NotesDestination[]; products?: IntelProduct[] }): NotesIntel {
  return buildNotesIntel({
    orders: input.orders,
    items: input.items || [],
    products: input.products || PRODUCTS,
    shipments: input.shipments || [],
    destinations: input.destinations || [],
    start: RANGE.start,
    end: RANGE.end,
    todayStart: TODAY.start,
    todayEnd: TODAY.end,
    now: NOW,
  });
}

describe("cumulative sales (spec 91, 92, 20)", () => {
  it("running paid orders 1,0,2,3 → 1,1,3,6", () => {
    assert.deepEqual(cumulative([1, 0, 2, 3]), [1, 1, 3, 6]);
  });

  it("running revenue in paise never decreases", () => {
    const out = cumulative([200000, 0, 500000]);
    assert.deepEqual(out, [200000, 200000, 700000]);
    for (let i = 1; i < out.length; i++) assert.ok(out[i] >= out[i - 1]);
  });

  it("last cumulative value equals the KPI row for orders, revenue and units", () => {
    const orders = [
      { id: "a", status: "DELIVERED", total_paise: 259900, paid_at: "2026-09-10T05:00:00.000Z" },
      { id: "b", status: "IN_TRANSIT", total_paise: 509900, paid_at: "2026-09-20T05:00:00.000Z" },
      { id: "c", status: "PACKED", total_paise: 257900, paid_at: "2026-10-02T05:00:00.000Z" },
      { id: "x", status: "PAYMENT_FAILED", total_paise: 999900, paid_at: "2026-10-01T05:00:00.000Z" },
    ];
    const items = [
      { order_id: "a", product_id: "p-polity", name_snapshot: "Polity", qty: 1, line_total_paise: 259900 },
      { order_id: "b", product_id: "p-polity", name_snapshot: "Polity", qty: 1, line_total_paise: 255000 },
      { order_id: "b", product_id: "p-economy", name_snapshot: "Economy", qty: 1, line_total_paise: 254900 },
      { order_id: "c", product_id: "p-economy", name_snapshot: "Economy", qty: 2, line_total_paise: 257900 },
    ];
    const kpis = aggregateNotesAnalytics([], orders, items).kpis;
    const visuals = buildNotesVisuals({ events: [], orders, items, start: RANGE.start, end: RANGE.end, now: NOW, label: RANGE.label });
    const lastOf = (metric: "orders" | "revenue" | "units") => timelineSeries(visuals.points, null, metric, "cumulative").at(-1)!.valueRaw;
    assert.equal(lastOf("orders"), kpis.paidOrders);
    assert.equal(lastOf("revenue"), kpis.revenuePaise);
    assert.equal(lastOf("units"), visuals.totals.units);
    assert.equal(visuals.totals.units, 5);
    const daily = timelineSeries(visuals.points, null, "orders", "daily");
    assert.equal(daily.length, 30, "every day of the range is a bucket, zero days included");
    assert.equal(daily.filter((row) => row.valueRaw === 0).length, 27);
  });

  it("today uses hourly buckets and a running hourly total", () => {
    const today = notesRangeBounds("today", NOW);
    const visuals = buildNotesVisuals({
      events: [],
      orders: [{ id: "t", status: "PACKED", total_paise: 100, paid_at: "2026-10-03T04:10:00.000Z" }],
      start: today.start,
      end: today.end,
      now: NOW,
      label: today.label,
    });
    assert.equal(visuals.grain, "hour");
    const series = timelineSeries(visuals.points, null, "orders", "cumulative");
    assert.equal(series.at(-1)!.valueRaw, 1);
  });
});

describe("subject revenue (spec 14, 74, 94, 99)", () => {
  it("allocates an order discount by line value in integer paise and excludes shipping", () => {
    const mixed = order("m1", { total_paise: 459900, shipping_paise: 9900, discount_paise: 50000 });
    const lines = subjectLinesForOrder(mixed, [line("m1", POLITY, 1, 250000), line("m1", ECONOMY, 1, 250000)], new Map(PRODUCTS.map((p) => [p.id, p])), new Map());
    assert.deepEqual(lines.map((row) => [row.subjectLabel, row.netPaise]), [["Polity", 225000], ["Economy", 225000]]);
    assert.equal(lines.reduce((sum, row) => sum + row.netPaise, 0), 450000);
  });

  it("keeps line-level offer discounts already inside line totals", () => {
    const one = order("m2", { total_paise: 233910, shipping_paise: 0 });
    const lines = subjectLinesForOrder(one, [line("m2", POLITY, 1, 233910)], new Map(PRODUCTS.map((p) => [p.id, p])), new Map());
    assert.equal(lines[0].netPaise, 233910);
  });

  it("allocateByWeight always sums exactly and breaks ties by position", () => {
    assert.deepEqual(allocateByWeight(-100, [1, 1, 1]), [-34, -33, -33]);
    assert.deepEqual(allocateByWeight(10, [0, 0]), [5, 5]);
    for (const total of [1, 7, 99, 12345, -50001]) {
      const split = allocateByWeight(total, [259900, 257900, 1]);
      assert.equal(split.reduce((a, b) => a + b, 0), total);
    }
  });

  it("a Polity + Economy order is one state order, two units, +1 order for each subject", () => {
    const intel = build({
      orders: [order("o1", { total_paise: 509900, shipping_paise: 0 })],
      items: [line("o1", POLITY, 1, 255000), line("o1", ECONOMY, 1, 254900)],
      destinations: [dest("o1", "Maharashtra", "Pune")],
    });
    assert.equal(intel.states.length, 1);
    assert.equal(intel.states[0].orders, 1);
    assert.equal(intel.states[0].units, 2);
    assert.deepEqual(intel.subjects.map((row) => [row.label, row.orders, row.units]).sort(), [["Economy", 1, 1], ["Polity", 1, 1]]);
  });

  it("subject totals reconcile to captured merchandise, not to revenue with shipping", () => {
    const intel = build({
      orders: [
        order("o1", { total_paise: 459900, shipping_paise: 9900 }),
        order("o2", { total_paise: 267800, shipping_paise: 7900 }),
      ],
      items: [line("o1", POLITY, 1, 250000), line("o1", ECONOMY, 1, 250000), line("o2", ECONOMY, 1, 259900)],
      destinations: [dest("o1", "Odisha"), dest("o2", "Odisha")],
    });
    const subjectSum = intel.subjects.reduce((sum, row) => sum + row.netRevenuePaise, 0);
    assert.equal(subjectSum, intel.cohort.merchandisePaise);
    assert.equal(intel.cohort.merchandisePaise, 459900 - 9900 + 267800 - 7900);
    assert.notEqual(subjectSum, intel.cohort.revenuePaise);
  });

  it("new subjects appear from the catalogue without code changes", () => {
    const ethics: IntelProduct = { id: "p-ethics", name: "Ethics Notes", subject: "Ethics", kind: "single", selling_price_paise: 199900 };
    const intel = build({
      orders: [order("e1", { total_paise: 199900 })],
      items: [line("e1", ethics, 1, 199900)],
      products: [...PRODUCTS, ethics],
      destinations: [dest("e1", "Kerala")],
    });
    assert.deepEqual(intel.subjects.map((row) => row.label), ["Ethics"]);
  });

  it("splits a bundle across its component subjects by component price", () => {
    const bundle: IntelProduct = { id: "p-bundle", name: "Polity + Economy", kind: "bundle", selling_price_paise: 469900 };
    const lines = subjectLinesForOrder(
      order("b1", { total_paise: 469900 }),
      [line("b1", bundle, 1, 469900)],
      new Map([...PRODUCTS, bundle].map((p) => [p.id, p])),
      new Map([["p-bundle", [{ bundle_id: "p-bundle", component_id: "p-polity", qty: 1 }, { bundle_id: "p-bundle", component_id: "p-economy", qty: 1 }]]]),
    );
    assert.deepEqual(lines.map((row) => row.subjectLabel), ["Polity", "Economy"]);
    assert.equal(lines.reduce((sum, row) => sum + row.netPaise, 0), 469900);
    assert.equal(lines.reduce((sum, row) => sum + row.units, 0), 2);
  });
});

describe("geography (spec 28, 56–58, 73, 93)", () => {
  it("normalizes known aliases and keeps unknown input in its own bucket", () => {
    assert.equal(normalizeIndiaState("Orissa").code, "21");
    assert.equal(normalizeIndiaState(" odisha ").code, "21");
    assert.equal(normalizeIndiaState("NCT of Delhi").code, "07");
    assert.equal(normalizeIndiaState("Delhi").code, "07");
    assert.equal(normalizeIndiaState("Uttaranchal").code, "05");
    assert.equal(normalizeIndiaState("Jammu & Kashmir").code, "01");
    assert.equal(normalizeIndiaState("Ladakh").code, "38");
    assert.equal(normalizeIndiaState("MH").code, "27");
    assert.equal(normalizeIndiaState("Daman and Diu").code, "26");
    assert.equal(normalizeIndiaState("Maharastra").code, "unknown", "no fuzzy matching");
    assert.equal(normalizeIndiaState("Madhya").code, "unknown");
    assert.equal(normalizeIndiaState("").code, "unknown");
    assert.notEqual(normalizeIndiaState("Andhra Pradesh").code, normalizeIndiaState("Arunachal Pradesh").code);
  });

  it("orders count once per state; units, revenue and orders reconcile with Unknown included", () => {
    const orders = [
      order("a", { total_paise: 259900 }),
      order("b", { total_paise: 257900 }),
      order("c", { total_paise: 509900 }),
      order("d", { total_paise: 259900 }),
      order("qa", { total_paise: 100, attribution_source: "qa" }),
      order("u", { status: "PAYMENT_FAILED", total_paise: 999 }),
    ];
    const items = [
      line("a", POLITY, 1, 259900),
      line("b", ECONOMY, 1, 257900),
      line("c", POLITY, 1, 255000),
      line("c", ECONOMY, 1, 254900),
      line("d", POLITY, 1, 259900),
    ];
    const intel = build({ orders, items, destinations: [dest("a", "Odisha"), dest("b", "Orissa"), dest("c", "Maharashtra"), dest("d", "Atlantis")] });
    const by = new Map(intel.states.map((row) => [row.name, row]));
    assert.equal(by.get("Odisha")?.orders, 2);
    assert.equal(by.get("Maharashtra")?.orders, 1);
    assert.equal(by.get("Maharashtra")?.units, 2);
    assert.equal(by.get("Unknown")?.orders, 1);
    const kpis = aggregateNotesAnalytics([], orders, items).kpis;
    assert.equal(intel.states.reduce((s, r) => s + r.orders, 0), kpis.paidOrders);
    assert.equal(intel.states.reduce((s, r) => s + r.revenuePaise, 0), kpis.revenuePaise);
    assert.equal(intel.states.reduce((s, r) => s + r.units, 0), intel.cohort.units);
    assert.deepEqual(by.get("Maharashtra")?.subjectUnits, [{ label: "Economy", units: 1 }, { label: "Polity", units: 1 }]);
  });

  it("every map shape resolves to known state codes and every state has a shape", () => {
    const shapeIds = new Set(INDIA_SHAPES.map((shape) => shape.id));
    assert.deepEqual([...shapeIds].sort(), Object.keys(SHAPE_STATES).sort());
    const covered = new Set(Object.values(SHAPE_STATES).flat());
    for (const code of ["01", "07", "21", "26", "27", "36", "38"]) assert.ok(covered.has(code), code);
  });

  it("merging a two-state outline weights the average by rated shipments", () => {
    const base = { aovPaise: null, subjectUnits: [], topCourier: null, anomalies: 0, avgWeightGrams: null, medianPaise: null, units: 1, revenuePaise: 100 };
    const merged = mergeStateRows("J&K and Ladakh", [
      { ...base, code: "01", name: "Jammu and Kashmir", orders: 1, shipments: 1, count: 1, avgPaise: 10000, minPaise: 10000, maxPaise: 10000 },
      { ...base, code: "38", name: "Ladakh", orders: 3, shipments: 3, count: 3, avgPaise: 20000, minPaise: 15000, maxPaise: 25000 },
    ]);
    assert.equal(merged.orders, 4);
    assert.equal(merged.avgPaise, 17500);
    assert.equal(merged.minPaise, 10000);
    assert.equal(merged.maxPaise, 25000);
    assert.equal(rankGeo([merged, { ...merged, code: "x", avgPaise: null }], "shipping").length, 1);
  });
});

describe("booked shipping economics (spec 8, 9, 52, 72, 97, 98)", () => {
  it("cancelled shipments never count; the active booking's rate is the only one", () => {
    const intel = build({
      orders: [order("s1")],
      items: [line("s1", POLITY, 1, 259900)],
      destinations: [dest("s1", "Odisha")],
      shipments: [
        ship("s1", { status: "cancelled", courier_name: "Blue Dart Air", rate: 15600, created_at: "2026-09-28T07:00:00.000Z" }),
        ship("s1", { status: "in_transit", courier_name: "Xpressbees Surface", rate: 9400, created_at: "2026-09-28T09:00:00.000Z" }),
      ],
    });
    assert.equal(intel.shipping.count, 1);
    assert.equal(intel.shipping.avgPaise, 9400);
    assert.deepEqual(intel.shipping.byCourier.map((row) => row.courier), ["Xpressbees Surface"]);
  });

  it("a missing booked rate is a coverage gap, not ₹0, and the order still counts", () => {
    const intel = build({
      orders: [order("r1"), order("r2")],
      items: [line("r1", POLITY, 1, 259900), line("r2", POLITY, 1, 259900)],
      destinations: [dest("r1", "Kerala"), dest("r2", "Kerala")],
      shipments: [ship("r1", { rate: 9000 }), ship("r2", { rate: null })],
    });
    assert.equal(intel.cohort.orders, 2);
    assert.equal(intel.shipping.booked, 2);
    assert.equal(intel.shipping.count, 1);
    assert.equal(intel.shipping.avgPaise, 9000);
    assert.equal(intel.shipping.minPaise, 9000);
    assert.equal(intel.anomalies.length, 0);
  });

  it("never reads the customer's checkout shipping charge", () => {
    const intel = build({
      orders: [order("c1", { shipping_paise: 5900, total_paise: 265800 })],
      items: [line("c1", POLITY, 1, 259900)],
      destinations: [dest("c1", "Goa")],
      shipments: [ship("c1", { rate: null })],
    });
    assert.equal(intel.shipping.avgPaise, null);
    assert.equal(intel.shipping.count, 0);
  });

  it("state shipments-with-rate sum to global coverage, Unknown included", () => {
    const intel = build({
      orders: [order("g1"), order("g2"), order("g3")],
      items: [line("g1", POLITY, 1, 259900), line("g2", POLITY, 1, 259900), line("g3", POLITY, 1, 259900)],
      destinations: [dest("g1", "Bihar"), dest("g2", null), dest("g3", "Bihar")],
      shipments: [ship("g1", { rate: 8000 }), ship("g2", { rate: 9000 }), ship("g3", { rate: null })],
    });
    assert.equal(intel.states.reduce((sum, row) => sum + row.count, 0), intel.shipping.count);
    assert.equal(intel.states.reduce((sum, row) => sum + row.shipments, 0), intel.shipping.booked);
  });

  it("uses the same eligible population and rule as the Notes Orders tile", () => {
    const orders = [order("w1", { status: "PICKUP_SCHEDULED" }), order("w2", { status: "PROCESSING" }), order("w3", { status: "DELIVERED" })];
    const shipments = [ship("w1", { status: "manifested", rate: 7000 }), ship("w2", { status: "created", rate: 99999 }), ship("w3", { rate: 11000 })];
    const intel = build({ orders, items: orders.map((o) => line(o.id, POLITY, 1, 259900)), destinations: orders.map((o) => dest(o.id, "Assam")), shipments });
    const byOrder = new Map<string, IntelShipment[]>();
    for (const row of shipments) byOrder.set(row.order_id, [...(byOrder.get(row.order_id) || []), row]);
    const tile = shippingRateStats(orders, byOrder);
    assert.equal(intel.shipping.avgPaise, tile.avg_paise);
    assert.equal(intel.shipping.count, tile.count);
    assert.equal(intel.shipping.minPaise, tile.min_paise);
    assert.equal(intel.shipping.maxPaise, tile.max_paise);
  });

  it("buckets rates for the distribution and the ₹100 target", () => {
    const dist = rateDistribution([5000, 6000, 7999, 8000, 9999, 10000, 14999, 15000, 25000]);
    assert.deepEqual(dist.map((row) => row.count), [1, 2, 2, 2, 1, 1]);
    const intel = build({
      orders: [order("t1"), order("t2"), order("t3")],
      items: [line("t1", POLITY, 1, 259900), line("t2", POLITY, 1, 259900), line("t3", POLITY, 1, 259900)],
      destinations: [dest("t1", "Punjab"), dest("t2", "Punjab"), dest("t3", "Punjab")],
      shipments: [ship("t1", { rate: 9000 }), ship("t2", { rate: 10000 }), ship("t3", { rate: 10001 })],
    });
    assert.equal(intel.shipping.atOrUnder100, 2);
    assert.equal(intel.shipping.over100, 1);
    assert.equal(intel.shipping.medianPaise, 10000);
  });

  it("does not double count a duplicated AWB", () => {
    const intel = build({
      orders: [order("d1"), order("d2", { paid_at: "2026-09-29T06:00:00.000Z" })],
      items: [line("d1", POLITY, 1, 259900), line("d2", POLITY, 1, 259900)],
      destinations: [dest("d1", "Goa"), dest("d2", "Goa")],
      shipments: [ship("d1", { awb: "SAME1", rate: 8000 }), ship("d2", { awb: "same1", rate: 8000 })],
    });
    assert.equal(intel.shipping.count, 1);
    assert.equal(intel.shipping.duplicateAwbsSkipped, 1);
  });
});

describe("rate anomalies (spec 46–52, 95, 96)", () => {
  it("flags ₹245 against ₹90/₹95/₹92 in the same state and weight band", () => {
    const ids = ["a1", "a2", "a3", "a4"];
    const rates = [9000, 9500, 9200, 24500];
    const intel = build({
      orders: ids.map((id) => order(id)),
      items: ids.map((id) => line(id, POLITY, 1, 259900)),
      destinations: ids.map((id) => dest(id, "Odisha", "Bhubaneswar")),
      shipments: ids.map((id, i) => ship(id, { rate: rates[i], weight_grams: 500 })),
    });
    assert.equal(intel.anomalies.length, 1);
    const flag = intel.anomalies[0];
    assert.equal(flag.orderId, "a4");
    assert.equal(flag.peerMedianPaise, 9200);
    assert.equal(flag.comparison, "state");
    assert.equal(flag.differencePaise, 15300);
    assert.match(flag.reason, /above similar ≤600 g Odisha shipments/);
    assert.equal(intel.states.find((row) => row.name === "Odisha")?.anomalies, 1);
  });

  it("does not flag a heavier parcel against lighter peers", () => {
    const intel = build({
      orders: [order("h1"), order("h2"), order("h3")],
      items: [line("h1", POLITY, 1, 259900), line("h2", POLITY, 1, 259900), line("h3", POLITY, 2, 519800)],
      destinations: [dest("h1", "Odisha"), dest("h2", "Odisha"), dest("h3", "Odisha")],
      shipments: [ship("h1", { rate: 9500, weight_grams: 500 }), ship("h2", { rate: 9800, weight_grams: 500 }), ship("h3", { rate: 14500, weight_grams: 1000 })],
    });
    assert.equal(intel.anomalies.length, 0);
  });

  it("falls back to same-weight shipments nationally and says so", () => {
    const states = ["Goa", "Kerala", "Bihar", "Assam"];
    const rates = [9000, 9100, 9200, 20000];
    const ids = states.map((_, i) => `n${i}`);
    const intel = build({
      orders: ids.map((id) => order(id)),
      items: ids.map((id) => line(id, POLITY, 1, 259900)),
      destinations: ids.map((id, i) => dest(id, states[i])),
      shipments: ids.map((id, i) => ship(id, { rate: rates[i] })),
    });
    assert.equal(intel.anomalies.length, 1);
    assert.equal(intel.anomalies[0].comparison, "national");
    assert.match(intel.anomalies[0].reason, /nationally/);
    assert.doesNotMatch(intel.anomalies[0].reason, /Assam/);
  });

  it("needs three peers and both the ratio and the ₹40 floor", () => {
    const pool = [
      { orderId: "p1", stateCode: "21", band: "w600", ratePaise: 6000 },
      { orderId: "p2", stateCode: "21", band: "w600", ratePaise: 6000 },
    ];
    assert.equal(judgeRate({ orderId: "t", stateCode: "21", band: "w600", ratePaise: 30000 }, pool).flagged, false, "two peers are not enough");
    const three = [...pool, { orderId: "p3", stateCode: "21", band: "w600", ratePaise: 6000 }];
    assert.equal(judgeRate({ orderId: "t", stateCode: "21", band: "w600", ratePaise: 9500 }, three).flagged, false, "1.58× but only ₹35 above");
    assert.equal(judgeRate({ orderId: "t", stateCode: "21", band: "w600", ratePaise: 10000 }, three).flagged, true);
    assert.equal(judgeRate({ orderId: "t", stateCode: "21", band: null, ratePaise: 99999 }, three).flagged, false, "unknown weight is never flagged");
    assert.equal(medianOf([9000, 9200, 9500]), 9200);
    assert.equal(weightBand(600)?.id, "w600");
    assert.equal(weightBand(601)?.id, "w1100");
    assert.equal(weightBand(null), null);
    assert.match(ANOMALY_RULE, /1\.5× the peer median/);
  });
});

describe("fulfillment activity and snapshot (spec 21, 22, 84, 85)", () => {
  it("buckets pickup, shipped and delivered by their own timestamps, not paid date", () => {
    const old = order("f1", {
      status: "DELIVERED",
      paid_at: "2026-08-01T05:00:00.000Z",
      shipped_at: "2026-10-01T05:00:00.000Z",
      delivered_at: "2026-10-03T05:00:00.000Z",
    });
    const intel = build({
      orders: [old, order("f2", { status: "PACKED" }), order("f3", { status: "IN_TRANSIT" }), order("f4", { status: "OUT_FOR_DELIVERY" }), order("f5", { status: "PICKUP_SCHEDULED" })],
      shipments: [ship("f1", { picked_up_at: "2026-10-01T04:00:00.000Z", rate: 9000 })],
    });
    assert.equal(intel.cohort.orders, 4, "the August order is not in the sales cohort");
    assert.deepEqual(intel.fulfillmentTotals, { pickedUp: 1, shipped: 1, delivered: 1 });
    assert.deepEqual(intel.today, { pickedUp: 0, shipped: 0, delivered: 1 });
    assert.deepEqual(intel.now, { packed: 1, pickup: 1, inTransit: 1, outForDelivery: 1 });
    const delivered = timelineSeries(
      intel.fulfillment.map((point) => ({ ...point, orders: 0, units: 0, revenuePaise: 0, customers: 0, visitors: 0, productViewers: 0, addToCarts: 0, checkouts: 0, conversionPct: null, aovPaise: null })),
      intel.fulfillment,
      "delivered",
      "cumulative",
    );
    assert.equal(delivered.at(-1)!.valueRaw, 1);
  });
});

describe("privacy and bundle scope (spec 101, 102)", () => {
  it("returns no names, phones or street addresses", () => {
    const intel = build({
      orders: [order("p1", { phone_key: "9876543210" })],
      items: [line("p1", POLITY, 1, 259900)],
      destinations: [dest("p1", "Karnataka", "Bengaluru")],
      shipments: [ship("p1", { rate: 9000 })],
    });
    const json = JSON.stringify(intel);
    assert.equal(json.includes("9876543210"), false);
    assert.equal(/line1|customer_name|"phone"/.test(json), false);
  });

  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const walk = (dir: string): string[] =>
    readdirSync(new URL(`../../${dir}`, import.meta.url)).flatMap((name) => {
      const rel = join(dir, name);
      return statSync(new URL(`../../${rel}`, import.meta.url)).isDirectory() ? walk(rel) : [rel];
    });

  it("keeps the map asset lazy and admin-only", () => {
    const geo = read("components/notes/admin/analytics/GeoIntel.tsx");
    assert.match(geo, /dynamic\(\(\) => import\("\.\/IndiaMap"\)/);
    assert.equal(geo.includes("indiaShapes"), false);
    const shapes = read("components/notes/admin/analytics/indiaShapes.ts");
    assert.match(shapes, /CC BY 4\.0/);
    for (const file of [...walk("app/(site)"), ...walk("components/notes").filter((f) => !f.includes("/admin/"))]) {
      if (!/\.(tsx?|mjs)$/.test(file)) continue;
      const source = read(file);
      assert.equal(/indiaShapes|IndiaMap|notesIntel|GeoIntel|ShippingIntel/.test(source), false, file);
    }
  });

  it("analytics never writes", () => {
    for (const file of ["lib/analytics/notesIntel.ts", "lib/analytics/notesIntelLoad.ts", "components/notes/admin/analytics/ShippingIntel.tsx", "components/notes/admin/analytics/GeoIntel.tsx"]) {
      const source = read(file);
      assert.equal(/\.(insert|update|upsert|delete)\(/.test(source), false, file);
      assert.equal(/method:\s*"(POST|PATCH|PUT|DELETE)"/.test(source), false, file);
    }
  });
});
