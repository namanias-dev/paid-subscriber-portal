import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  actionRequiredReasons,
  defaultQuote,
  fulfillmentLabel,
  hasActiveShipment,
  nextPreparationStatus,
  orderIndexLabel,
  primaryAction,
  rankQuotes,
  sortAdminOrders,
} from "../../lib/store/adminConsole";

test("order index keeps the official number readable", () => {
  assert.equal(orderIndexLabel("NIAS-N-2026-001001"), "#1001");
  assert.equal(orderIndexLabel("NIAS-N-2026-900001"), "#900001");
});

test("pickup failure outranks booking and does not treat a cancelled AWB as active", () => {
  assert.equal(primaryAction({ status: "PICKUP_SCHEDULED", awb: "14112365007656", pickupFailed: true }), "resolve_pickup");
  assert.equal(primaryAction({ status: "PACKED", awb: null }), "compare");
  assert.equal(hasActiveShipment("cancelled", "67350910000044"), false);
  assert.equal(hasActiveShipment("created", "14112365007656"), true);
  assert.deepEqual(actionRequiredReasons({ status: "PICKUP_SCHEDULED", awb: "1", pickupFailed: true }), ["Pickup wasn't completed"]);
  assert.equal(fulfillmentLabel("PICKUP_SCHEDULED", true), "Pickup issue");
  assert.equal(nextPreparationStatus("PICKED_UP"), null);
});

test("cheapest quote is first and selected, fastest is labelled from returned ETAs", () => {
  const quotes = [
    { provider: "shiprocket", courier: "Amazon Surface", service: "Surface", ratePaise: 9872, etaText: "27 Sep", etaDays: 3, courierId: "1" },
    { provider: "shiprocket", courier: "Xpressbees Surface", service: "Surface", ratePaise: 9372, etaText: "25 Sep", etaDays: 1, courierId: "51" },
    { provider: "shiprocket", courier: "Ekart Surface", service: "Surface", ratePaise: 9500, etaText: "25 Sep", etaDays: 1, courierId: "2" },
  ];
  const ranked = rankQuotes(quotes, "price");
  assert.equal(ranked[0].courier, "Xpressbees Surface");
  assert.equal(ranked[0].lowest, true);
  assert.equal(ranked[0].fastest, true);
  assert.equal(defaultQuote(quotes)?.courierId, "51");
  const fastest = rankQuotes(quotes, "eta");
  assert.equal(fastest[0].etaDays, 1);
  assert.equal(fastest.find((q) => q.courier === "Ekart Surface")?.bestValue, false);
});

test("pickup scheduled orders stay in the default admin list", () => {
  const src = fs.readFileSync(new URL("../../app/api/admin/notes/orders/route.ts", import.meta.url), "utf8");
  const all = src.slice(src.indexOf("const ALL_STATUSES"), src.indexOf("export async function GET"));
  assert.match(all, /BUCKETS\.pickup/);
});

test("sort puts action required ahead when requested and keeps newest otherwise", () => {
  const rows = [
    { placed_at: "2026-09-20", total_paise: 100, action_required: false },
    { placed_at: "2026-09-24", total_paise: 50, action_required: true },
  ];
  assert.equal(sortAdminOrders(rows, "action")[0].action_required, true);
  assert.equal(sortAdminOrders(rows, "newest")[0].placed_at, "2026-09-24");
  assert.equal(sortAdminOrders(rows, "value_desc")[0].total_paise, 100);
});
