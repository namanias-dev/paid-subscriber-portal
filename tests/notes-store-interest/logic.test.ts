import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAvailability } from "../../lib/store/availability.ts";
import {
  aggregateInterestRows,
  hashInterestVoter,
  interestRateLimited,
  isInterestEligible,
  sanitizeInterestSource,
  sortInterestRows,
} from "../../lib/store/interest.ts";
import { computeBundleOffer } from "../../lib/store/bundleOffer.ts";
import {
  PUBLIC_DEMAND_MIN,
  buildPreferenceSubjects,
  combinations,
  computeCoSelections,
  publicDemandView,
  sanitizePreferenceSource,
} from "../../lib/store/preferenceLogic.ts";

test("interest is eligible only for coming soon and unavailable live titles", () => {
  assert.equal(isInterestEligible(resolveAvailability("coming_soon", 0, 5, true)), true);
  assert.equal(isInterestEligible(resolveAvailability("unavailable", 0, 5, true)), true);
  assert.equal(isInterestEligible(resolveAvailability("ready_stock", 12, 5, true)), false);
  assert.equal(isInterestEligible(resolveAvailability("on_demand", 0, 5, true)), false);
  assert.equal(isInterestEligible(resolveAvailability("coming_soon", 0, 5, false)), false);
});

test("voter hash is stable, hex, and does not echo the raw id", () => {
  const a = hashInterestVoter("11111111-1111-4111-8111-111111111111");
  const b = hashInterestVoter("11111111-1111-4111-8111-111111111111");
  const c = hashInterestVoter("22222222-2222-4222-8222-222222222222");
  assert.equal(a, b);
  assert.equal(a.length, 64);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, c);
  assert.equal(a.includes("11111111"), false);
});

test("unknown or hostile source values collapse to unknown", () => {
  assert.equal(sanitizeInterestSource("landing"), "landing");
  assert.equal(sanitizeInterestSource("pdp"), "pdp");
  assert.equal(sanitizeInterestSource("subject"), "subject");
  assert.equal(sanitizeInterestSource("admin"), "unknown");
  assert.equal(sanitizeInterestSource({ x: 1 }), "unknown");
});

test("rate-limit decision is server-authoritative on existing count", () => {
  assert.equal(interestRateLimited(11, 12), false);
  assert.equal(interestRateLimited(12, 12), true);
  assert.equal(interestRateLimited(13, 12), true);
});

test("aggregates expose real 7-day / 30-day / total counts only", () => {
  const now = Date.parse("2026-09-20T12:00:00.000Z");
  const rows = aggregateInterestRows(
    [
      { product_id: "geo", created_at: "2026-09-19T10:00:00.000Z" },
      { product_id: "geo", created_at: "2026-09-01T10:00:00.000Z" },
      { product_id: "ethics", created_at: "2026-08-01T10:00:00.000Z" },
    ],
    new Map([
      ["geo", { name: "Geography", subject: "Geography", slug: "geography", availability_mode: "coming_soon", availability_label: "coming_soon" }],
      ["ethics", { name: "Ethics", subject: "Ethics", slug: "ethics", availability_mode: "unavailable", availability_label: "unavailable" }],
    ]),
    now,
  );
  const geo = rows.find((r) => r.product_id === "geo")!;
  const ethics = rows.find((r) => r.product_id === "ethics")!;
  assert.equal(geo.total, 2);
  assert.equal(geo.last7, 1);
  assert.equal(geo.last30, 2);
  assert.equal(ethics.total, 1);
  assert.equal(ethics.last7, 0);
  assert.equal(ethics.last30, 0);
});

test("sort: most requested, recently requested, coming soon first", () => {
  const rows = [
    { product_id: "a", name: "A", subject: null, slug: "a", availability_mode: "unavailable", availability_label: "unavailable", total: 3, last7: 1, last30: 2, last_at: "2026-09-10T00:00:00.000Z" },
    { product_id: "b", name: "B", subject: null, slug: "b", availability_mode: "coming_soon", availability_label: "coming_soon", total: 2, last7: 2, last30: 2, last_at: "2026-09-19T00:00:00.000Z" },
  ];
  assert.equal(sortInterestRows(rows, "most")[0].product_id, "a");
  assert.equal(sortInterestRows(rows, "recent")[0].product_id, "b");
  assert.equal(sortInterestRows(rows, "coming_soon")[0].product_id, "b");
});

test("preference source sanitizes to the closed set", () => {
  assert.equal(sanitizePreferenceSource("voices"), "voices");
  assert.equal(sanitizePreferenceSource("landing"), "landing");
  assert.equal(sanitizePreferenceSource("admin"), "unknown");
});

test("public demand never invents counts below the real-data threshold", () => {
  assert.deepEqual(publicDemandView(0, 10), { share: 0, count: null, label: null });
  assert.equal(publicDemandView(1, 10).label, "Growing interest");
  assert.equal(publicDemandView(1, 10).count, null);
  assert.equal(publicDemandView(PUBLIC_DEMAND_MIN, PUBLIC_DEMAND_MIN).count, PUBLIC_DEMAND_MIN);
  assert.equal(publicDemandView(PUBLIC_DEMAND_MIN, PUBLIC_DEMAND_MIN).label, null);
  assert.equal(publicDemandView(8, 16).share, 0.5);
});

test("preference subjects take availability and relative demand from live catalogue data", () => {
  const rows = buildPreferenceSubjects(
    [
      { id: "polity", slug: "polity", name: "Polity", nav_label: "Polity", short_description: "GS II" },
      { id: "history", slug: "modern-history", name: "Modern History", nav_label: "Modern History", short_description: "GS I" },
    ],
    new Map([
      ["polity", true],
      ["history", false],
    ]),
    new Map([
      ["polity", 12],
      ["history", 3],
    ]),
    new Map([
      ["polity", "GS II"],
      ["history", "GS I"],
    ]),
  );
  assert.equal(rows[0].available, true);
  assert.equal(rows[0].href, "/notes/polity");
  assert.equal(rows[0].demand_count, 12);
  assert.equal(rows[1].available, false);
  assert.equal(rows[1].demand_count, null);
  assert.equal(rows[1].demand_label, "Growing interest");
  assert.equal(rows[1].demand_share, 3 / 12);
});

test("co-selection counts pairs and trios from a preference SET, not independent votes", () => {
  const co = computeCoSelections([
    ["polity", "history", "geography"],
    ["polity", "history"],
    ["polity", "economy"],
  ]);
  const polityHistory = co.pairs.find((p) => p.a === "history" && p.b === "polity") || co.pairs.find((p) => p.a === "polity" && p.b === "history");
  assert.ok(polityHistory);
  assert.equal(polityHistory!.count, 2);
  assert.equal(polityHistory!.pct_of_a === 67 || polityHistory!.pct_of_b === 67 || polityHistory!.pct_of_a === 100, true);
  assert.equal(co.trios[0].count, 1);
  assert.deepEqual(co.trios[0].ids, ["geography", "history", "polity"]);
  assert.equal(co.also_selected.polity[0].id, "history");
  assert.equal(combinations(["a", "b", "c"], 2).length, 3);
});

test("bundle offer only fires when the cart already covers every component and would save money", () => {
  const bundles = [
    {
      id: "gs2",
      slug: "gs-ii-bundle",
      name: "GS-II Bundle",
      selling_price_paise: 150000,
      components: [
        { product_id: "polity", qty: 1, selling_price_paise: 89900 },
        { product_id: "governance", qty: 1, selling_price_paise: 79900 },
      ],
    },
  ];
  assert.equal(computeBundleOffer([{ product_id: "polity", qty: 1, unit_paise: 89900 }], bundles), null);
  const offer = computeBundleOffer(
    [
      { product_id: "polity", qty: 1, unit_paise: 89900 },
      { product_id: "governance", qty: 1, unit_paise: 79900 },
    ],
    bundles,
  );
  assert.ok(offer);
  assert.equal(offer!.save_paise, 19800);
  assert.equal(computeBundleOffer([{ product_id: "gs2", qty: 1, unit_paise: 150000, kind: "bundle" }], bundles), null);
});
