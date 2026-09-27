import assert from "node:assert/strict";
import test from "node:test";
import { applyProductContentFields, productEditorSaveBlocker, publicProductSaveError } from "../../lib/store/productAdmin";
import { normalizeStoreProductPrices } from "../../lib/store/productPrice";
import { calculateStorePrice } from "../../lib/store/pricing";
import { discountPercent, presentStorePrice } from "../../lib/store/money";

const polityPackage = { weightGrams: 500, lengthMm: 300, widthMm: 250, heightMm: 30 };

test("a normal product update with an empty package is accepted", () => {
  const patch: Record<string, unknown> = {};
  applyProductContentFields(patch, {
    name: "Indian Economy Notes",
    page_count: 280,
    booklets: 1,
    physical_format: "A4",
    binding_type: "Spiral bound",
    weight_grams: null,
    length_mm: null,
    width_mm: null,
    height_mm: null,
    cover_image_key: "https://signed.example/expired",
  });
  assert.equal(patch.page_count, 280);
  assert.equal(patch.booklets, 1);
  assert.equal(patch.physical_format, "A4");
  assert.equal(patch.binding_type, "Spiral bound");
  assert.equal(patch.weight_grams, null);
  assert.equal("cover_image_key" in patch, false);
  assert.equal(
    productEditorSaveBlocker({
      mrpPaise: 374900,
      sellingPaise: 299900,
      isActive: true,
      weightGrams: null,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
    }),
    null,
  );
});

test("a partial shipping profile blocks the save with a reason", () => {
  assert.throws(
    () =>
      applyProductContentFields(
        {},
        { weight_grams: 500, length_mm: null, width_mm: null, height_mm: null },
      ),
    /Enter weight, length, width and height together/,
  );
  assert.match(
    productEditorSaveBlocker({
      mrpPaise: 374900,
      sellingPaise: 299900,
      isActive: true,
      weightGrams: 500,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
    }) || "",
    /together/,
  );
});

test("₹3,749 MRP and ₹2,999 selling price stay exact and show 20% off", () => {
  const prices = normalizeStoreProductPrices({ mrp_paise: 374900, selling_price_paise: 299900 });
  assert.deepEqual(prices, { mrp_paise: 374900, selling_price_paise: 299900 });
  assert.equal(discountPercent(prices.mrp_paise, prices.selling_price_paise), 20);
  assert.notEqual(Math.round(374900 * 0.8), 299900);

  const charged = calculateStorePrice(
    { id: "economy", kind: "single", category_id: null, selling_price_paise: prices.selling_price_paise },
    1,
    null,
  );
  assert.equal(charged.final_paise, 299900);
  assert.equal(charged.discount_paise, 0);

  const shown = presentStorePrice({ mrpPaise: prices.mrp_paise, finalPaise: charged.final_paise });
  assert.equal(shown.payablePaise, 299900);
  assert.equal(shown.comparePaise, 374900);
  assert.equal(shown.percentOff, 20);
  assert.equal(shown.badge, "20% OFF");
  assert.equal(shown.savePaise, 75000);
});

test("a complete Polity package persists and a bad weight is named", () => {
  const patch: Record<string, unknown> = {};
  applyProductContentFields(patch, {
    weight_grams: polityPackage.weightGrams,
    length_mm: polityPackage.lengthMm,
    width_mm: polityPackage.widthMm,
    height_mm: polityPackage.heightMm,
    page_count: 384,
  });
  assert.equal(patch.weight_grams, 500);
  assert.equal(patch.length_mm, 300);
  assert.equal(patch.width_mm, 250);
  assert.equal(patch.height_mm, 30);
  assert.equal(patch.page_count, 384);
  assert.match(
    productEditorSaveBlocker({
      mrpPaise: 374900,
      sellingPaise: 299900,
      isActive: true,
      weightGrams: 10,
      lengthMm: 300,
      widthMm: 250,
      heightMm: 30,
    }) || "",
    /Invalid shipping weight/,
  );
});

test("a database failure becomes an actionable admin error", () => {
  assert.equal(
    publicProductSaveError(new Error('new row violates check constraint "store_products_price_not_above_mrp"')),
    "Selling price cannot exceed MRP.",
  );
  assert.equal(publicProductSaveError(new Error("duplicate key value violates unique constraint")), "Product update failed");
  assert.equal(publicProductSaveError(new Error("Enter weight, length, width and height together.")), "Enter weight, length, width and height together.");
});

test("non-finite prices are refused before they can blank a product", () => {
  assert.equal(
    productEditorSaveBlocker({
      mrpPaise: Number.NaN,
      sellingPaise: 299900,
      isActive: true,
      weightGrams: 500,
      lengthMm: 300,
      widthMm: 250,
      heightMm: 30,
    }),
    "Could not save pricing",
  );
});
