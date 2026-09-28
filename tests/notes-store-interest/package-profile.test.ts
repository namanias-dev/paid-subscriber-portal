import assert from "node:assert/strict";
import test from "node:test";
import { freezePackageSnapshot, formatPackageSummary, packageFromProduct, packageProfileReady, STANDARD_NOTES_PRICE_PAISE, validateProductPackage } from "../../lib/store/packageProfile";
import { resolveAutoPackage } from "../../lib/store/shipping/autoFulfill";

test("standard notes price stays separate from a historical captured total", () => {
  const catalog = STANDARD_NOTES_PRICE_PAISE;
  const historical = { unit_price_paise: 299900, discount_paise: 59980, shipping_paise: 5900, total_paise: 245820 };
  assert.equal(catalog, 299900);
  assert.equal(historical.total_paise, 245820);
  assert.notEqual(historical.total_paise, catalog);
});

test("a single configured product auto-loads and a missing profile does not guess", () => {
  const polity = packageFromProduct({ weightGrams: 500, lengthMm: 300, widthMm: 250, heightMm: 30 });
  assert.equal(formatPackageSummary(polity), "500 g · 30 × 25 × 3 cm");
  const loaded = resolveAutoPackage([{ qty: 1, weightGrams: 500, lengthMm: 300, widthMm: 250, heightMm: 30 }]);
  assert.equal(loaded.ok, true);
  const economy = resolveAutoPackage([{ qty: 1, weightGrams: null, lengthMm: null, widthMm: null, heightMm: null }]);
  assert.equal(economy.ok, false);
  if (!economy.ok) assert.equal(economy.reason, "PACKAGE_CONFIRMATION_REQUIRED");
  const history = resolveAutoPackage([{ qty: 1, weightGrams: 750, lengthMm: 300, widthMm: 250, heightMm: 50 }]);
  assert.equal(history.ok, true);
});

test("an order snapshot does not follow a later product profile change", () => {
  const used = freezePackageSnapshot({ weightGrams: 500, lengthCm: 30, widthCm: 25, heightCm: 3 }, "PRODUCT_PROFILE");
  const later = packageFromProduct({ weightGrams: 550, lengthMm: 310, widthMm: 250, heightMm: 30 });
  assert.equal(used.weightGrams, 500);
  assert.equal(used.lengthCm, 30);
  assert.equal(later?.weightGrams, 550);
  assert.equal(packageProfileReady({ weightGrams: null, lengthMm: null, widthMm: null, heightMm: null }), false);
  assert.equal(validateProductPackage({ weightGrams: 500, lengthMm: null, widthMm: 250, heightMm: 30 }), "Enter weight, length, width and height together.");
  assert.match(validateProductPackage({ weightGrams: 500, lengthMm: 50000, widthMm: 250, heightMm: 30 }) || "", /Length/);
});
