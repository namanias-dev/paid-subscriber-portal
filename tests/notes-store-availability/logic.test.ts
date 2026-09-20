import { test } from "node:test";
import assert from "node:assert/strict";
import {
  maxPurchasableQty,
  resolveAvailability,
} from "../../lib/store/availability.ts";
import { aggregatePreparation, type PrepProduct } from "../../lib/store/preparation.ts";

test("ready_stock: purchasable, low-stock and out-of-stock states", () => {
  const inStock = resolveAvailability("ready_stock", 20, 5, true);
  assert.equal(inStock.purchasable, true);
  assert.equal(inStock.state, "in_stock");

  const low = resolveAvailability("ready_stock", 4, 5, true);
  assert.equal(low.state, "low_stock");
  assert.equal(low.lowStock, true);
  assert.match(low.label, /Only 4 left/);

  const oos = resolveAvailability("ready_stock", 0, 5, true);
  assert.equal(oos.purchasable, false);
  assert.equal(oos.state, "out_of_stock");
});

test("on_demand is always purchasable when live, regardless of stock", () => {
  const av = resolveAvailability("on_demand", 0, 5, true);
  assert.equal(av.purchasable, true);
  assert.equal(av.state, "on_demand");
});

test("coming_soon and unavailable are never purchasable", () => {
  assert.equal(resolveAvailability("coming_soon", 99, 5, true).purchasable, false);
  assert.equal(resolveAvailability("unavailable", 99, 5, true).purchasable, false);
});

test("a draft (inactive) product is never purchasable in any mode", () => {
  for (const mode of ["ready_stock", "on_demand", "coming_soon", "unavailable"] as const) {
    assert.equal(resolveAvailability(mode, 50, 5, false).purchasable, false);
  }
});

test("maxPurchasableQty caps ready_stock by stock and on_demand by per-order max only", () => {
  assert.equal(maxPurchasableQty("ready_stock", 3, 5), 3); // stock is the ceiling
  assert.equal(maxPurchasableQty("ready_stock", 9, 5), 5); // per-order max is the ceiling
  assert.equal(maxPurchasableQty("on_demand", 0, 5), 5); // no stock ceiling
  assert.equal(maxPurchasableQty("coming_soon", 9, 5), 0);
});

function product(partial: Partial<PrepProduct> & { id: string }): PrepProduct {
  return {
    name: partial.id,
    sku: partial.id.toUpperCase(),
    subject: null,
    kind: "single",
    availability_mode: "ready_stock",
    sellable: 0,
    ...partial,
  };
}

test("preparation demand: ready_stock nets off available stock; on_demand needs all", () => {
  const products = new Map<string, PrepProduct>([
    ["polity", product({ id: "polity", availability_mode: "ready_stock", sellable: 12 })],
    ["geo", product({ id: "geo", availability_mode: "on_demand", sellable: 0 })],
  ]);
  const rows = aggregatePreparation(
    [
      { order_id: "o1", product_id: "polity", qty: 10 },
      { order_id: "o2", product_id: "polity", qty: 8 }, // total polity demand 18
      { order_id: "o3", product_id: "geo", qty: 9 },
    ],
    products,
    new Map(),
  );
  const polity = rows.find((r) => r.product_id === "polity")!;
  const geo = rows.find((r) => r.product_id === "geo")!;
  assert.equal(polity.demand, 18);
  assert.equal(polity.orders, 2);
  assert.equal(polity.ready_stock, 12);
  assert.equal(polity.additional_required, 6); // 18 - 12
  assert.equal(geo.demand, 9);
  assert.equal(geo.ready_stock, null);
  assert.equal(geo.additional_required, 9);
});

test("preparation demand explodes bundles into component demand without double counting", () => {
  const products = new Map<string, PrepProduct>([
    ["gs", product({ id: "gs", kind: "bundle", availability_mode: "on_demand" })],
    ["polity", product({ id: "polity", availability_mode: "on_demand" })],
    ["history", product({ id: "history", availability_mode: "ready_stock", sellable: 1 })],
  ]);
  const bundles = new Map([["gs", [{ component_id: "polity", qty: 1 }, { component_id: "history", qty: 2 }]]]);
  const rows = aggregatePreparation(
    [{ order_id: "o1", product_id: "gs", qty: 3 }],
    products,
    bundles,
  );
  // Bundle itself is not a preparable copy.
  assert.equal(rows.find((r) => r.product_id === "gs"), undefined);
  const polity = rows.find((r) => r.product_id === "polity")!;
  const history = rows.find((r) => r.product_id === "history")!;
  assert.equal(polity.demand, 3); // 3 bundles * 1
  assert.equal(history.demand, 6); // 3 bundles * 2
  assert.equal(history.additional_required, 5); // 6 - 1 ready
});
