/**
 * Captured-sales timeline, city ranking, and previous-period comparison.
 * Payment attempts, QA rows, and gateway card fees stay out of the charts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { aggregateNotesAnalytics, notesRangeBounds, type NotesEventRow, type NotesItemFact, type NotesOrderFact } from "../../lib/analytics/notesCommerce";
import {
  buildNotesVisuals,
  comparisonWindow,
  destinationForOrder,
  istDayKey,
  istHour,
  normalizeCity,
  periodDelta,
  rankCities,
  salesTooltipModel,
  sparklinePath,
} from "../../lib/analytics/notesVisuals";

const NOW = new Date("2026-09-28T10:00:00.000Z"); // 15:30 IST

function order(partial: Partial<NotesOrderFact> & Pick<NotesOrderFact, "id" | "status" | "total_paise">): NotesOrderFact {
  return { paid_at: "2026-09-27T08:00:00.000Z", ...partial };
}

function item(orderId: string, productId: string, qty: number, line: number): NotesItemFact {
  return { order_id: orderId, product_id: productId, name_snapshot: productId, qty, line_total_paise: line };
}

describe("captured sales visuals", () => {
  const orders: NotesOrderFact[] = [
    order({ id: "a", status: "PRINTING", total_paise: 205900, phone_key: "9000000001" }),
    order({ id: "b", status: "PROCESSING", total_paise: 205900, phone_key: "9000000002" }),
    order({ id: "c", status: "PACKED", total_paise: 405900, phone_key: "9000000001" }),
    order({ id: "failed", status: "PAYMENT_FAILED", total_paise: 205900, paid_at: "2026-09-27T09:00:00.000Z" }),
    order({ id: "expired", status: "PAYMENT_EXPIRED", total_paise: 205900 }),
    order({ id: "pending", status: "PAYMENT_PENDING", total_paise: 205900, paid_at: null }),
    order({ id: "cancelled", status: "CANCELLED", total_paise: 205900 }),
    order({ id: "qa", status: "PRINTING", total_paise: 100, attribution_source: "qa" }),
    order({ id: "validation", status: "PRINTING", total_paise: 100, promo_code: "notes_analytics_validation" }),
  ];
  const items = [
    item("a", "polity", 1, 205900),
    item("b", "economy", 1, 205900),
    item("c", "polity", 1, 200000),
    item("c", "economy", 1, 205900),
    item("failed", "polity", 1, 205900),
  ];
  const destinations = [
    { orderId: "a", city: "Panchkula", state: "Haryana" },
    { orderId: "b", city: "Chandigarh", state: "Chandigarh" },
    { orderId: "c", city: "panchkula", state: "HARYANA" },
    { orderId: "failed", city: "Panchkula", state: "Haryana" },
  ];

  function visualsFor(extraOrders: NotesOrderFact[] = [], now = NOW) {
    const bounds = notesRangeBounds("7d", now);
    return buildNotesVisuals({
      events: [],
      orders: [...orders, ...extraOrders],
      items,
      destinations,
      start: bounds.start,
      end: bounds.end,
      now,
      label: bounds.label,
      compare: true,
      previousKpis: { visitors: 0, productViewers: 0, addToCarts: 0, checkouts: 0, paymentAttempts: 0, paidOrders: 0, conversionPct: null, revenuePaise: 0, aovPaise: null },
    });
  }

  it("counts captured orders, units, and revenue once per order", () => {
    const visuals = visualsFor();
    assert.equal(visuals.totals.orders, 3);
    assert.equal(visuals.totals.units, 4);
    assert.equal(visuals.totals.revenuePaise, 205900 + 205900 + 405900);
    assert.equal(visuals.points.reduce((sum, point) => sum + point.orders, 0), visuals.totals.orders);
    assert.equal(visuals.points.reduce((sum, point) => sum + point.units, 0), visuals.totals.units);
    assert.equal(visuals.points.reduce((sum, point) => sum + point.revenuePaise, 0), visuals.totals.revenuePaise);
    assert.equal(visuals.cities?.reduce((sum, row) => sum + row.orders, 0), 3);
    const panchkula = visuals.cities?.find((row) => row.city === "Panchkula");
    const chandigarh = visuals.cities?.find((row) => row.city === "Chandigarh");
    assert.equal(panchkula?.orders, 2);
    assert.equal(panchkula?.units, 3);
    assert.equal(panchkula?.state, "Haryana");
    assert.equal(chandigarh?.orders, 1);
    assert.equal(visuals.cities?.[0]?.city, "Panchkula");
    assert.equal(JSON.stringify(visuals).includes("9000000001"), false);
  });

  it("keeps a zero bucket for every day in the range and stops at today", () => {
    const visuals = visualsFor();
    assert.equal(visuals.grain, "day");
    assert.equal(visuals.points.length, 7);
    assert.equal(visuals.points.filter((point) => point.orders === 0).length, 6);
    assert.equal(visuals.subtitle, "Last 7 days · daily");
    const month = buildNotesVisuals({
      events: [],
      orders: [],
      start: notesRangeBounds("month", NOW).start,
      end: notesRangeBounds("month", NOW).end,
      now: NOW,
      label: "This month",
    });
    assert.equal(month.points.at(-1)?.key, "2026-09-28");
    assert.equal(month.points.some((point) => point.key === "2026-09-29"), false);
    assert.equal(month.subtitle, "Sep 2026 · daily");
    assert.equal(month.cities?.length, 0);
  });

  it("uses hourly buckets for today through the current hour", () => {
    const bounds = notesRangeBounds("today", NOW);
    const visuals = buildNotesVisuals({
      events: [],
      orders: [order({ id: "today", status: "PRINTING", total_paise: 205900, paid_at: "2026-09-28T04:30:00.000Z" })],
      items: [item("today", "polity", 1, 205900)],
      destinations: [{ orderId: "today", city: "Delhi", state: "Delhi" }],
      start: bounds.start,
      end: bounds.end,
      now: NOW,
      label: bounds.label,
    });
    assert.equal(visuals.grain, "hour");
    assert.equal(visuals.points.length, 16);
    assert.equal(visuals.points.some((point) => point.key.endsWith("T16")), false);
    assert.equal(visuals.totals.orders, 1);
    assert.equal(visuals.cities?.[0]?.city, "Delhi");
    assert.equal(visuals.points.filter((point) => point.axis).map((point) => point.axis).includes("12am"), true);
    assert.equal(visuals.points.filter((point) => point.axis).map((point) => point.axis).includes("4pm"), false);
  });

  it("splits 23:59 IST and 00:01 IST onto different reporting days", () => {
    const start = new Date("2026-09-26T18:30:00.000Z");
    const end = new Date("2026-09-28T18:30:00.000Z");
    assert.equal(istDayKey(new Date("2026-09-27T18:29:00.000Z")), "2026-09-27");
    assert.equal(istHour(new Date("2026-09-27T18:29:00.000Z")), 23);
    assert.equal(istDayKey(new Date("2026-09-27T18:31:00.000Z")), "2026-09-28");
    assert.equal(istHour(new Date("2026-09-27T18:31:00.000Z")), 0);
    const visuals = buildNotesVisuals({
      events: [],
      orders: [
        order({ id: "late", status: "PRINTING", total_paise: 100, paid_at: "2026-09-27T18:29:00.000Z" }),
        order({ id: "early", status: "PRINTING", total_paise: 100, paid_at: "2026-09-27T18:31:00.000Z" }),
      ],
      start,
      end,
      now: end,
      label: "Custom",
    });
    assert.equal(visuals.grain, "day");
    assert.equal(visuals.points.find((point) => point.key === "2026-09-27")?.orders, 1);
    assert.equal(visuals.points.find((point) => point.key === "2026-09-28")?.orders, 1);
  });

  it("uses the captured total, including a discount, and ignores a gateway fee", () => {
    const discounted = order({ id: "deal", status: "PRINTING", total_paise: 180000 });
    (discounted as NotesOrderFact & { gateway_fee_paise?: number; mrp_paise?: number }).gateway_fee_paise = 1977;
    (discounted as NotesOrderFact & { mrp_paise?: number }).mrp_paise = 205900;
    const bounds = notesRangeBounds("7d", NOW);
    const visuals = buildNotesVisuals({
      events: [],
      orders: [discounted],
      items: [item("deal", "polity", 2, 180000)],
      destinations: [{ orderId: "deal", city: "Mohali", state: "Punjab" }],
      start: bounds.start,
      end: bounds.end,
      now: NOW,
      label: bounds.label,
    });
    assert.equal(visuals.totals.revenuePaise, 180000);
    assert.equal(visuals.totals.units, 2);
    assert.equal(visuals.totals.orders, 1);
  });

  it("keeps an unspecified destination and separates the same city in two states", () => {
    const bounds = notesRangeBounds("7d", NOW);
    const visuals = buildNotesVisuals({
      events: [],
      orders: [
        order({ id: "unknown", status: "PRINTING", total_paise: 100 }),
        order({ id: "h", status: "PRINTING", total_paise: 100 }),
        order({ id: "p", status: "PRINTING", total_paise: 300 }),
      ],
      destinations: [
        { orderId: "h", city: "Panchkula", state: "Haryana" },
        { orderId: "p", city: "Panchkula", state: "Punjab" },
      ],
      start: bounds.start,
      end: bounds.end,
      now: NOW,
      label: bounds.label,
    });
    assert.equal(visuals.cities?.length, 3);
    assert.equal(visuals.cities?.reduce((sum, row) => sum + row.orders, 0), 3);
    assert.equal(visuals.cities?.some((row) => row.city === "Unspecified"), true);
    assert.equal(visuals.cities?.filter((row) => row.city === "Panchkula").length, 2);
    assert.equal(rankCities(visuals.cities || [], "revenue")[0]?.state, "Punjab");
  });

  it("normalizes casing and a trailing City without merging distinct cities", () => {
    assert.equal(normalizeCity("PANCHKULA", "haryana").key, normalizeCity("panchkula", "Haryana").key);
    assert.equal(normalizeCity("Panchkula City", "Haryana").city, "Panchkula");
    assert.equal(normalizeCity("Panchkula.", "Haryana").key, normalizeCity("Panchkula", "Haryana").key);
    assert.notEqual(normalizeCity("Panchkula", "Haryana").key, normalizeCity("Chandigarh", "Chandigarh").key);
    assert.notEqual(normalizeCity("New Delhi", "Delhi").key, normalizeCity("Delhi", "Delhi").key);
  });

  it("prefers the invoice delivery snapshot over a later address and ignores courier fields", () => {
    const chosen = destinationForOrder(
      "a",
      { city: "Panchkula", state: "Haryana" },
      { city: "Zirakpur", state: "Punjab" },
    );
    assert.equal(chosen.city, "Panchkula");
    assert.equal(chosen.state, "Haryana");
    const fallback = destinationForOrder("b", { city: "", state: "" }, { city: "Chandigarh", state: "Chandigarh" });
    assert.equal(fallback.city, "Chandigarh");
  });

  it("compares the previous period without dividing by zero", () => {
    assert.deepEqual(periodDelta(3, 0), { delta: "New", tone: "new" });
    assert.deepEqual(periodDelta(0, 0), { delta: "—", tone: "none" });
    assert.deepEqual(periodDelta(0, null), { delta: "—", tone: "none" });
    assert.equal(periodDelta(3, 2).delta, "+50%");
    assert.equal(periodDelta(1, 2).delta, "−50%");
    assert.equal(periodDelta(Number.NaN, 2).delta, "—");
    const bounds = notesRangeBounds("7d", NOW);
    const sameSession = "s-same";
    const events: NotesEventRow[] = [
      { event_name: "notes_store_viewed", session_id: sameSession, occurred_at: "2026-09-27T08:00:00.000Z" },
      { event_name: "notes_store_viewed", session_id: sameSession, occurred_at: "2026-09-26T08:00:00.000Z" },
      { event_name: "notes_store_viewed", session_id: "qa", occurred_at: "2026-09-27T08:00:00.000Z", props: { is_test: true } },
    ];
    const visuals = buildNotesVisuals({
      events,
      orders: orders.slice(0, 3),
      items,
      destinations,
      start: bounds.start,
      end: bounds.end,
      now: NOW,
      label: bounds.label,
      compare: true,
      previousKpis: { visitors: 1, productViewers: 0, addToCarts: 0, checkouts: 0, paymentAttempts: 0, paidOrders: 2, conversionPct: null, revenuePaise: 100, aovPaise: 50 },
    });
    assert.equal(visuals.trends.visitors.points.reduce((sum, value) => sum + (value || 0), 0), 2);
    assert.equal(visuals.trends.visitors.delta, "0%");
    assert.equal(aggregateNotesAnalytics(events, orders.slice(0, 3), items).kpis.visitors, 1);
    assert.equal(visuals.trends.paidOrders.delta, "+50%");
    const unknown = buildNotesVisuals({
      events: [],
      orders: orders.slice(0, 3),
      items,
      start: bounds.start,
      end: bounds.end,
      now: NOW,
      label: bounds.label,
      compare: false,
    });
    assert.equal(unknown.trends.paidOrders.delta, "—");
    assert.equal(unknown.trends.paidOrders.tone, "none");
  });

  it("uses a same-clock previous day for today and the previous week for seven days", () => {
    const today = notesRangeBounds("today", NOW);
    const priorToday = comparisonWindow(today, NOW);
    assert.equal(priorToday?.start.toISOString(), new Date(today.start.getTime() - 86400000).toISOString());
    assert.equal(priorToday?.end.toISOString(), new Date(NOW.getTime() - 86400000).toISOString());
    const week = notesRangeBounds("7d", NOW);
    const priorWeek = comparisonWindow(week, NOW);
    assert.equal(priorWeek?.end.toISOString(), week.start.toISOString());
    assert.equal((priorWeek!.end.getTime() - priorWeek!.start.getTime()), week.end.getTime() - week.start.getTime());
  });

  it("follows a custom range and can subset one product without double-counting the city", () => {
    const bounds = notesRangeBounds("custom", NOW, { from: "2026-09-26", to: "2026-09-27" });
    const visuals = buildNotesVisuals({
      events: [],
      orders,
      items,
      destinations,
      start: bounds.start,
      end: bounds.end,
      now: NOW,
      label: bounds.label,
      productId: "polity",
    });
    assert.equal(visuals.subtitle, "26 Sep–27 Sep · daily");
    assert.equal(visuals.points.length, 2);
    assert.equal(visuals.totals.orders, 2);
    assert.equal(visuals.totals.units, 2);
    assert.equal(visuals.totals.revenuePaise, 205900 + 200000);
    assert.equal(visuals.cities?.find((row) => row.city === "Panchkula")?.orders, 2);
    assert.equal(visuals.cities?.some((row) => row.city === "Chandigarh"), false);
  });

  it("formats a compact tooltip from the bucket", () => {
    const rows = salesTooltipModel({
      label: "28 Sep",
      orders: 4,
      units: 5,
      revenuePaise: 1011800,
      aovPaise: 252950,
      customers: 3,
    });
    assert.deepEqual(rows.map((row) => row.value), ["4", "5", "₹10,118", "₹2,529.50", "3"]);
    assert.equal(salesTooltipModel({ label: "28 Sep", orders: 0, units: 0, revenuePaise: 0, aovPaise: null, customers: 0 })[3]?.value, "—");
  });

  it("draws a straight sparkline and skips a one-point series", () => {
    assert.equal(sparklinePath([1]), "");
    const path = sparklinePath([1, null, 3]);
    assert.equal(path.includes("C"), false);
    assert.equal(path.split("M").length - 1, 2);
  });
});

describe("analytics visual ui contract", () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

  it("keeps charts on the admin analytics route and out of the public store", () => {
    const page = read("components/notes/admin/NotesAnalytics.tsx");
    const slot = read("components/notes/admin/analytics/SalesChartSlot.tsx");
    const timeline = read("components/notes/admin/analytics/SalesTimeline.tsx");
    const spark = read("components/notes/admin/analytics/Sparkline.tsx");
    const city = read("components/notes/admin/analytics/CityRanking.tsx");
    const report = read("lib/analytics/notesReport.ts");
    assert.equal(page.includes("recharts"), false);
    assert.equal(page.includes("SalesChartSlot"), true);
    assert.equal(timeline.includes("Sales over time"), true);
    assert.equal(slot.includes("ssr: false"), true);
    assert.equal(timeline.includes("Paid orders"), true);
    assert.equal(timeline.includes("Revenue"), true);
    assert.equal(timeline.includes("Units"), true);
    assert.equal(timeline.includes("useReducedMotion"), true);
    assert.equal(timeline.includes("<a "), false);
    assert.equal(spark.includes("useReducedMotion"), true);
    assert.equal(spark.includes("duration: 0"), true);
    assert.equal(city.includes("Paid orders by city"), true);
    assert.equal(city.includes("View all"), true);
    assert.equal(city.includes("hidden md:block"), true);
    assert.equal(page.includes("Sales timeline is unavailable right now."), true);
    assert.equal(page.includes("City breakdown is unavailable right now.") || city.includes("City breakdown is unavailable right now."), true);
    assert.equal(report.includes("store_shipments"), false);
    assert.equal(report.includes("line1"), false);
    assert.equal(report.includes("shipping_snapshot"), true);
    assert.equal(report.includes("store_addresses"), true);
    for (const file of ["components/notes/NotesHero.tsx", "components/notes/OrderStatus.tsx", "app/(site)/notes/page.tsx"]) {
      const source = read(file);
      assert.equal(source.includes("recharts"), false);
      assert.equal(source.includes("SalesTimeline"), false);
    }
  });
});
