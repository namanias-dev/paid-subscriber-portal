import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { avgBookedShipping, kpiTiles } from "../../components/notes/admin/analytics/kpiTiles";
import { formatPaise } from "../../lib/store/money";

const ROOT = new URL("../..", import.meta.url).pathname;

function report(kpis: Record<string, number | null>) {
  return { kpis: { visitors: 0, productViewers: 0, addToCarts: 0, checkouts: 0, paidOrders: 0, conversionPct: 0, revenuePaise: 0, aovPaise: null, ...kpis }, visuals: null } as never;
}

function shipping(avgPaise: number | null, count: number, booked: number) {
  return { shipping: { avgPaise, count, booked, minPaise: avgPaise, maxPaise: avgPaise } } as never;
}

test("Avg booked shipping tile shows the canonical intel.shipping.avgPaise, never a second calculation", () => {
  for (const avg of [9260, 4274, 21272, 9329]) {
    const tiles = kpiTiles(report({}), shipping(avg, 12, 12));
    const tile = tiles.find((t) => t.id === "avgShipping")!;
    assert.equal(tile.value, formatPaise(avg), "same formatter and value as the Booked shipping detail");
    assert.equal(tile.note, "Rate on 12 of 12 booked");
  }
  // The detail panel reads the very same field.
  const src = readFileSync(`${ROOT}components/notes/admin/NotesAnalytics.tsx`, "utf8");
  assert.match(src, /\["Avg", ship\.avgPaise\]/);
  assert.doesNotMatch(readFileSync(`${ROOT}components/notes/admin/analytics/kpiTiles.ts`, "utf8"), /reduce\(|\/ ship\.count|\/ count/, "no average is computed in the tile");
});

test("no booked rates is '—' with a reason, never ₹0; missing intel is unavailable", () => {
  assert.deepEqual(avgBookedShipping(shipping(null, 0, 0)), { value: "—", note: "No booked rates" });
  assert.deepEqual(avgBookedShipping(shipping(null, 0, 3)), { value: "—", note: "No booked rates" });
  assert.deepEqual(avgBookedShipping(null), { value: "—", note: "Unavailable right now" });
});

test("empty states keep their distinct meanings", () => {
  const tiles = Object.fromEntries(kpiTiles(report({ conversionPct: 0, revenuePaise: 0, paidOrders: 0, aovPaise: null }), shipping(null, 0, 0)).map((t) => [t.id, t.value]));
  assert.equal(tiles.paidOrders, "0");
  assert.equal(tiles.conversion, "0%");
  assert.equal(tiles.revenue, "₹0");
  assert.equal(tiles.aov, "—");
  assert.equal(tiles.avgShipping, "—");
  const nullConversion = kpiTiles(report({ conversionPct: null }), null).find((t) => t.id === "conversion")!;
  assert.equal(nullConversion.value, "—");
});

test("funnel order and accessible labels; KPI grid has no horizontal rail", () => {
  const tiles = kpiTiles(report({ visitors: 121, revenuePaise: 9239200, aovPaise: 309400 }), shipping(9226, 19, 19));
  assert.deepEqual(tiles.map((t) => t.id), ["visitors", "productViewers", "addToCarts", "checkouts", "paidOrders", "conversion", "revenue", "aov", "avgShipping"]);
  assert.equal(tiles.find((t) => t.id === "revenue")!.ariaLabel, "Revenue ₹92,392");
  assert.equal(tiles.find((t) => t.id === "aov")!.ariaLabel, "AOV ₹3,094");
  const src = readFileSync(`${ROOT}components/notes/admin/NotesAnalytics.tsx`, "utf8");
  const grid = src.slice(src.indexOf("data-kpi-grid"), src.indexOf("data-kpi-grid") + 200);
  assert.match(grid, /grid-cols-2/);
  assert.doesNotMatch(grid, /overflow-x-auto|snap-x/);
});
