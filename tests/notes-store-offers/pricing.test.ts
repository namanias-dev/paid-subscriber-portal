import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateCartPricing,
  calculateStorePrice,
  offerDiscountLabel,
  percentageDiscountPaise,
  productEligibleForOffer,
  type OfferForPricing,
  type PriceableProduct,
} from "../../lib/store/pricing.ts";
import { deriveOfferStatus, remainingRedemptions, validateOfferInput } from "../../lib/store/offers.ts";

const subject: PriceableProduct = {
  id: "polity",
  kind: "single",
  category_id: "cat-polity",
  selling_price_paise: 299900,
};

const bundle: PriceableProduct = {
  id: "bundle-1",
  kind: "bundle",
  category_id: null,
  selling_price_paise: 499900,
};

const launch: OfferForPricing = {
  id: "offer-1",
  name: "Launch Offer",
  slug: "launch-offer",
  discount_type: "percentage",
  discount_value: 20,
  scope: "individual_subjects",
  product_ids: [],
  category_ids: [],
};

test("20% of ₹2,999 is exact integer paise", () => {
  assert.equal(percentageDiscountPaise(299900, 20), 59980);
  const line = calculateStorePrice(subject, 1, launch);
  assert.equal(line.base_paise, 299900);
  assert.equal(line.discount_paise, 59980);
  assert.equal(line.final_paise, 239920);
  assert.equal(line.offer_id, "offer-1");
});

test("A. active offer applies to eligible subject notes", () => {
  const cart = calculateCartPricing([{ product: subject, qty: 2 }], launch);
  assert.equal(cart.subtotal_paise, 599800);
  assert.equal(cart.discount_paise, 119960);
  assert.equal(cart.offer_name, "Launch Offer");
});

test("E. product not eligible — bundles stay at regular price while scope is subjects", () => {
  assert.equal(productEligibleForOffer(bundle, launch), false);
  const line = calculateStorePrice(bundle, 1, launch);
  assert.equal(line.discount_paise, 0);
  assert.equal(line.final_paise, 499900);
  assert.equal(line.offer_id, null);
});

test("specific product and category scopes", () => {
  const byProduct: OfferForPricing = { ...launch, scope: "specific_products", product_ids: ["polity"] };
  const byCat: OfferForPricing = { ...launch, scope: "specific_categories", category_ids: ["cat-polity"] };
  assert.equal(productEligibleForOffer(subject, byProduct), true);
  assert.equal(productEligibleForOffer({ ...subject, id: "other" }, byProduct), false);
  assert.equal(productEligibleForOffer(subject, byCat), true);
  assert.equal(productEligibleForOffer({ ...subject, category_id: "other" }, byCat), false);
});

test("fixed amount discount never exceeds the line", () => {
  const offer: OfferForPricing = { ...launch, discount_type: "fixed_amount", discount_value: 500000 };
  const line = calculateStorePrice(subject, 1, offer);
  assert.equal(line.discount_paise, 299900);
  assert.equal(line.final_paise, 0);
});

test("B/C/D. derived status uses server clock, not a client countdown", () => {
  const now = new Date("2026-09-21T12:00:00.000Z");
  const base = {
    enabled: true,
    starts_at: "2026-09-14T00:00:00.000Z",
    ends_at: "2026-09-28T00:00:00.000Z",
    max_redemptions: 100,
    redemptions_used: 12,
  };
  assert.equal(deriveOfferStatus(base, now), "ACTIVE");
  assert.equal(deriveOfferStatus({ ...base, ends_at: "2026-09-20T00:00:00.000Z" }, now), "ENDED");
  assert.equal(deriveOfferStatus({ ...base, redemptions_used: 100 }, now), "ENDED");
  assert.equal(deriveOfferStatus({ ...base, enabled: false }, now), "PAUSED");
  assert.equal(deriveOfferStatus({ ...base, enabled: false, starts_at: "2026-09-22T00:00:00.000Z" }, now), "DRAFT");
  assert.equal(deriveOfferStatus({ ...base, starts_at: "2026-09-22T00:00:00.000Z" }, now), "SCHEDULED");
});

test("C. held checkouts count against remaining capacity", () => {
  const offer = { max_redemptions: 100, redemptions_used: 99 };
  assert.equal(remainingRedemptions(offer, 1), 0);
  assert.equal(deriveOfferStatus({ enabled: true, starts_at: null, ends_at: null, ...offer }, new Date(), 1), "ENDED");
});

test("F. no offer means regular price — checkout after expiry is a no-discount quote", () => {
  const line = calculateStorePrice(subject, 1, null);
  assert.equal(line.final_paise, 299900);
  assert.equal(line.discount_paise, 0);
});

test("admin validation rejects impossible campaigns", () => {
  const bad = validateOfferInput({
    name: "",
    enabled: true,
    discount_type: "percentage",
    discount_value: 140,
    starts_at: "2026-09-22T00:00:00.000Z",
    ends_at: "2026-09-21T00:00:00.000Z",
    max_redemptions: 0,
    scope: "specific_products",
    product_ids: [],
  });
  assert.ok(bad.some((e) => /name/i.test(e)));
  assert.ok(bad.some((e) => /100/.test(e)));
  assert.ok(bad.some((e) => /end time/i.test(e)));
  assert.ok(bad.some((e) => /order limit/i.test(e)));
  assert.ok(bad.some((e) => /product/i.test(e)));
});

test("offer label is merchandising copy, not a second price formula", () => {
  assert.equal(offerDiscountLabel(launch), "20% OFF");
  assert.equal(offerDiscountLabel({ discount_type: "fixed_amount", discount_value: 50000 }), "₹500 OFF");
});
