import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evaluateStoreEnabled, storePreviewOverrideAllowed } from "../../lib/store/flags";
import { assertActiveSellingPrice, normalizeStoreProductPrices } from "../../lib/store/productPrice";

const OFF = { enabled: false, killSwitch: false, scope: "off" };
const LIVE = { enabled: true, killSwitch: false, scope: "on" };
const KILLED = { enabled: true, killSwitch: true, scope: "on" };

describe("preview-only store enablement", () => {
  test("production never honours NOTES_STORE_PREVIEW_ENABLE", () => {
    assert.equal(
      storePreviewOverrideAllowed({ VERCEL_ENV: "production", NOTES_STORE_PREVIEW_ENABLE: "1" }),
      false,
    );
    assert.equal(evaluateStoreEnabled(OFF, { VERCEL_ENV: "production", NOTES_STORE_PREVIEW_ENABLE: "1" }), false);
    assert.equal(evaluateStoreEnabled(LIVE, { VERCEL_ENV: "production" }), true);
  });

  test("preview can enable without the shared database flag", () => {
    assert.equal(evaluateStoreEnabled(OFF, { VERCEL_ENV: "preview", NOTES_STORE_PREVIEW_ENABLE: "1" }), true);
    assert.equal(evaluateStoreEnabled(OFF, { VERCEL_ENV: "preview" }), false);
    assert.equal(evaluateStoreEnabled(OFF, { NOTES_STORE_PREVIEW_ENABLE: "1" }), true);
  });

  test("kill_switch still wins on preview", () => {
    assert.equal(evaluateStoreEnabled(KILLED, { VERCEL_ENV: "preview", NOTES_STORE_PREVIEW_ENABLE: "1" }), false);
  });
});

describe("₹1 SKU price normalisation", () => {
  test("MRP is raised to selling so the CHECK constraint cannot reject ₹1", () => {
    assert.deepEqual(normalizeStoreProductPrices({ mrp_paise: 0, selling_price_paise: 100 }), {
      mrp_paise: 100,
      selling_price_paise: 100,
    });
  });

  test("a live SKU cheaper than ₹1 is refused", () => {
    assert.throws(() => assertActiveSellingPrice(5, true));
    assert.doesNotThrow(() => assertActiveSellingPrice(5, false));
    assert.doesNotThrow(() => assertActiveSellingPrice(100, true));
  });
});
