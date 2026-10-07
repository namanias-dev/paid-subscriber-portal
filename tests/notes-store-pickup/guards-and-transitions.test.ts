import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { deliveryOnlyGuard, PICKUP_COURIER_REFUSAL } from "../../lib/store/fulfillmentGuard";
import { advanceFulfillment, markCollected } from "../../lib/store/collection";
import { fakeDb } from "./fakeDb";

const ROOT = new URL("../..", import.meta.url).pathname;

function order(extra: Record<string, unknown>) {
  return { id: "o1", order_no: "NIAS-N-2026-009001", status: "PRINTING", fulfillment_method: "ACADEMY_PICKUP", ...extra };
}

test("delivery-only guard: 409 for pickup, pass for delivery and history, fail closed on read error", async () => {
  const pickup = fakeDb({ store_orders: [order({})] });
  const refused = await deliveryOnlyGuard(pickup.client, "o1", "rates");
  assert.equal(refused?.status, 409);
  assert.equal((await refused!.json()).error, PICKUP_COURIER_REFUSAL);
  const delivery = fakeDb({ store_orders: [order({ fulfillment_method: "DELIVERY" })] });
  assert.equal(await deliveryOnlyGuard(delivery.client, "o1", "rates"), null);
  const historical = fakeDb({ store_orders: [{ id: "o1", status: "PACKED" }] });
  assert.equal(await deliveryOnlyGuard(historical.client, "o1", "rates"), null, "rows without the column are DELIVERY");
  const broken = fakeDb({ store_orders: [order({})] }, { failSelect: true });
  assert.equal((await deliveryOnlyGuard(broken.client, "o1", "rates"))?.status, 503);
});

/** Every server entry point that can quote, book, label, request courier pickup, track or change an address. */
const PROVIDER_CALLS = [
  "compareCourierRates(",
  "createProviderShipment(",
  "requestProviderPickup(",
  "cancelProviderShipment(",
  "requestReverseShipment(",
  "fetchExistingLabel(",
  "findShiprocketOrder(",
  "readShiprocketOrderPublic(",
  "trackShiprocketAwb(",
  "trackDelhiveryAwb(",
  "applyDeliveryAddressChange(",
  'from("store_shipments").insert(',
  'from("store_shipments").update(',
  "persistQuoteSession(",
  "startAttempt(",
];
/** Shipment-keyed entry points: they act only on existing shipment rows, which pickup orders can never have. */
const SHIPMENT_KEYED = new Set(["app/api/cron/notes-store-tracking/route.ts", "app/api/notes/courier/events/route.ts"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") ? [path] : [];
  });
}

test("courier entry-point inventory: every mutation route calls the guard before provider work", () => {
  const files = walk(join(ROOT, "app/api"));
  const found: string[] = [];
  for (const file of files) {
    const rel = file.slice(ROOT.length);
    const src = readFileSync(file, "utf8");
    const firstCall = Math.min(...PROVIDER_CALLS.map((call) => src.indexOf(call)).filter((index) => index >= 0));
    if (!Number.isFinite(firstCall)) continue;
    found.push(rel);
    if (SHIPMENT_KEYED.has(rel)) continue;
    const guard = src.indexOf("deliveryOnlyGuard(");
    assert.ok(guard >= 0, `${rel} has courier work but no deliveryOnlyGuard`);
    assert.ok(guard < firstCall, `${rel}: guard must run before the first provider/shipment call`);
  }
  assert.ok(found.length >= 13, `expected the known courier entry points, found ${found.length}: ${found.join(", ")}`);
  // The auto-fulfilment runner and the address library refuse pickup themselves.
  assert.match(readFileSync(join(ROOT, "lib/store/shipping/autoFulfillRun.ts"), "utf8"), /ACADEMY_PICKUP/);
  assert.match(readFileSync(join(ROOT, "lib/store/deliveryAddressApply.ts"), "utf8"), /isAcademyPickup\(order\)/);
  // Payment reconciliation stays open for pickup: it is not courier work.
  assert.doesNotMatch(readFileSync(join(ROOT, "app/api/admin/notes/orders/[id]/reconcile/route.ts"), "utf8"), /deliveryOnlyGuard/);
});

test("mark ready: pickup PRINTING → READY_FOR_COLLECTION with time and actor, once", async () => {
  const db = fakeDb({ store_orders: [order({})] });
  let hooks = 0;
  const actor = { id: "staff-1", name: "Abhishek" };
  const [a, b] = await Promise.all([
    advanceFulfillment(db.client, "o1", actor, { onReady: () => (hooks += 1) }),
    advanceFulfillment(db.client, "o1", { id: "staff-2", name: "Ravi" }, { onReady: () => (hooks += 1) }),
  ]);
  assert.equal([a, b].filter((r) => r.ok).length, 1, "exactly one transition wins");
  assert.equal([a, b].find((r) => !r.ok && r.code === "CONFLICT") ? 1 : 0, 1);
  const row = db.rows("store_orders")[0];
  assert.equal(row.status, "READY_FOR_COLLECTION");
  assert.ok(row.ready_for_collection_at);
  const events = db.rows("store_order_events").filter((e) => e.event === "ready_for_collection");
  assert.equal(events.length, 1);
  assert.equal(hooks, 1, "no duplicate notification hook");
  // Stale page clicks again: refused cleanly.
  const again = await advanceFulfillment(db.client, "o1", actor);
  assert.equal(again.ok, false);
  assert.match((again as { error: string }).error, /Mark collected/);
});

test("mark ready never creates courier rows; delivery PRINTING still goes to PACKED", async () => {
  const db = fakeDb({ store_orders: [order({})] });
  await advanceFulfillment(db.client, "o1", null);
  assert.equal(db.rows("store_shipments").length, 0);
  assert.equal(db.calls.some((c) => c.table.startsWith("store_courier") || c.table === "store_shipments"), false);
  const delivery = fakeDb({ store_orders: [order({ fulfillment_method: "DELIVERY" })] });
  const r = await advanceFulfillment(delivery.client, "o1", null);
  assert.equal(r.ok && r.status, "PACKED");
  assert.equal(delivery.rows("store_orders")[0].ready_for_collection_at, undefined);
});

test("mark collected: once, with actor and one stock commit; double click and two staff are safe", async () => {
  const db = fakeDb({ store_orders: [order({ status: "READY_FOR_COLLECTION", ready_for_collection_at: "2026-10-04T08:45:00Z" })] });
  let commits = 0;
  let notified = 0;
  const hooks = { commitStock: async () => { commits += 1; }, onCollected: () => { notified += 1; } };
  const results = await Promise.all([
    markCollected(db.client, "o1", { id: "staff-1", name: "Abhishek" }, hooks),
    markCollected(db.client, "o1", { id: "staff-2", name: "Ravi" }, hooks),
    markCollected(db.client, "o1", { id: "staff-1", name: "Abhishek" }, hooks),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(commits, 1, "exactly one reservation commit");
  assert.equal(notified, 1);
  const events = db.rows("store_order_events").filter((e) => e.event === "collected");
  assert.equal(events.length, 1);
  assert.ok(events[0].actor_name);
  const row = db.rows("store_orders")[0];
  assert.equal(row.status, "COLLECTED");
  assert.ok(row.collected_at);
  const after = await markCollected(db.client, "o1", null, hooks);
  assert.equal(after.ok, false);
  assert.equal((after as { code: string }).code, "ALREADY_COLLECTED");
});

test("mark collected refuses everything except a ready pickup order", async () => {
  for (const status of ["PRINTING", "PROCESSING", "CANCELLED", "REFUNDED", "PAYMENT_FAILED", "PAYMENT_PENDING", "REFUND_PENDING"]) {
    const db = fakeDb({ store_orders: [order({ status })] });
    const r = await markCollected(db.client, "o1", null);
    assert.equal(r.ok, false, status);
    assert.equal(db.rows("store_orders")[0].status, status, `${status} unchanged`);
    assert.equal(db.rows("store_order_events").length, 0);
  }
  const delivery = fakeDb({ store_orders: [order({ status: "DELIVERED", fulfillment_method: "DELIVERY" })] });
  const r = await markCollected(delivery.client, "o1", null);
  assert.equal((r as { code: string }).code, "NOT_PICKUP");
  const missing = await markCollected(fakeDb({}).client, "nope", null);
  assert.equal((missing as { code: string }).code, "NOT_FOUND");
});
