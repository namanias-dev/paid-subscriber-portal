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
