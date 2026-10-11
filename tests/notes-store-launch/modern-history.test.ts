import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  calculateCartPricing,
  calculateStorePrice,
  productEligibleForOffer,
  type OfferForPricing,
  type PriceableProduct,
} from "../../lib/store/pricing.ts";
import { deriveOfferStatus, remainingRedemptions } from "../../lib/store/offers.ts";
import { presentStorePrice } from "../../lib/store/money.ts";
import {
  MODERN_HISTORY_LAUNCH_CAP,
  MODERN_HISTORY_LAUNCH_DISCOUNT_PAISE,
  MODERN_HISTORY_LAUNCH_PAISE,
  MODERN_HISTORY_OFFER_SLUG,
  MODERN_HISTORY_PRODUCT_ID,
  MODERN_HISTORY_SELLING_PAISE,
  MODERN_HISTORY_SEO_TITLE,
  isModernHistoryLaunchOffer,
  modernHistoryLaunchActive,
  modernHistoryLaunchBadge,
} from "../../lib/store/modernHistoryLaunch.ts";
import { getNotesCurriculum } from "../../lib/store/notesCurriculum.ts";
import {
  notesSampleForProduct,
  physicalNotesVideoForProduct,
} from "../../lib/store/notesProof.ts";
import { funnelKind } from "../../lib/marketing/funnelMath.ts";
import { aggregateNotesAnalytics, buildNotesCampaignUrl } from "../../lib/analytics/notesCommerce.ts";

const modern: PriceableProduct = {
  id: MODERN_HISTORY_PRODUCT_ID,
  kind: "single",
  category_id: "cat-modern-history",
  selling_price_paise: MODERN_HISTORY_SELLING_PAISE,
};

const polity: PriceableProduct = {
  id: "polity",
  kind: "single",
  category_id: "cat-polity",
  selling_price_paise: 299_900,
};

const launch: OfferForPricing = {
  id: "mh-offer",
  name: "Modern History Launch — First 50",
  slug: MODERN_HISTORY_OFFER_SLUG,
  discount_type: "fixed_amount",
  discount_value: MODERN_HISTORY_LAUNCH_DISCOUNT_PAISE,
  scope: "specific_products",
  product_ids: [MODERN_HISTORY_PRODUCT_ID],
  category_ids: [],
  badge_text: "NEW RELEASE",
};

const section = readFileSync(new URL("../../components/notes/NotesProofSection.tsx", import.meta.url), "utf8");
const video = readFileSync(new URL("../../components/notes/PhysicalNotesVideo.tsx", import.meta.url), "utf8");
const landing = readFileSync(new URL("../../app/(site)/notes/page.tsx", import.meta.url), "utf8");
const modal = readFileSync(new URL("../../components/admin/campaign-links/CreateLinkModal.tsx", import.meta.url), "utf8");
const destinations = readFileSync(new URL("../../app/api/admin/campaign-links/destinations/route.ts", import.meta.url), "utf8");

test("Modern History launch quotes ₹1,999 and leaves Polity at ₹2,999", () => {
  const mh = calculateStorePrice(modern, 1, launch);
  assert.equal(mh.base_paise, MODERN_HISTORY_SELLING_PAISE);
  assert.equal(mh.discount_paise, MODERN_HISTORY_LAUNCH_DISCOUNT_PAISE);
  assert.equal(mh.final_paise, MODERN_HISTORY_LAUNCH_PAISE);
  assert.equal(productEligibleForOffer(polity, launch), false);
  const mixed = calculateCartPricing(
    [
      { product: modern, qty: 1 },
      { product: polity, qty: 1 },
    ],
    launch,
  );
  assert.equal(mixed.subtotal_paise, MODERN_HISTORY_SELLING_PAISE + 299_900);
  assert.equal(mixed.discount_paise, MODERN_HISTORY_LAUNCH_DISCOUNT_PAISE);
  assert.equal(mixed.subtotal_paise - mixed.discount_paise, MODERN_HISTORY_LAUNCH_PAISE + 299_900);
  const view = presentStorePrice({
    mrpPaise: 374_900,
    finalPaise: mh.final_paise,
    offerDiscountPaise: mh.discount_paise,
    offerBasePaise: mh.base_paise,
    offerBadge: modernHistoryLaunchBadge(),
  });
  assert.equal(view.payablePaise, 199_900);
  assert.equal(view.comparePaise, 299_900);
  assert.equal(view.badge, "NEW RELEASE");
});

test("first-50 cap is server-derived and retries do not invent a second use", () => {
  const now = new Date("2026-10-11T12:00:00.000Z");
  const open = {
    enabled: true,
    starts_at: null,
    ends_at: null,
    max_redemptions: MODERN_HISTORY_LAUNCH_CAP,
    redemptions_used: 49,
  };
  assert.equal(deriveOfferStatus(open, now, 0), "ACTIVE");
  assert.equal(remainingRedemptions(open, 0), 1);
  assert.equal(deriveOfferStatus(open, now, 1), "ENDED");
  assert.equal(remainingRedemptions({ max_redemptions: 50, redemptions_used: 50 }, 0), 0);
  assert.equal(deriveOfferStatus({ ...open, redemptions_used: 50 }, now), "ENDED");
  const after = calculateStorePrice(modern, 1, null);
  assert.equal(after.final_paise, MODERN_HISTORY_SELLING_PAISE);
  assert.equal(isModernHistoryLaunchOffer(launch), true);
  assert.equal(modernHistoryLaunchActive({ ...modern, slug: "modern-history" }, launch, "ACTIVE"), true);
  assert.equal(modernHistoryLaunchActive({ ...modern, slug: "modern-history" }, launch, "ENDED"), false);
});

test("Modern History sales copy, proof assets and campaign destination are first-class", () => {
  const story = getNotesCurriculum("modern-history");
  assert.ok(story);
  assert.equal(story.seoTitle, MODERN_HISTORY_SEO_TITLE);
  assert.match(story.positioningTitle || "", /Modern History Is Not a Subject You Can Prepare Randomly/);
  assert.equal(story.whyPoints?.length, 6);
  assert.ok((story.prelimsItems || []).length >= 5);
  assert.ok((story.mainsItems || []).length >= 5);
  const sample = notesSampleForProduct("modern-history");
  assert.ok(sample);
  assert.match(sample.pdfSrc || "", /\/media\/store\/samples\/modern-history-sample\/sample\.pdf$/);
  const clip = physicalNotesVideoForProduct("modern-history");
  assert.ok(clip);
  assert.equal(clip.id, "physical-notes-modern-history");
  assert.ok(clip.height > clip.width);
  assert.match(clip.fullSrc, /\/media\/store\/videos\/physical-notes-modern-history\/full\.mp4$/);
  assert.equal(funnelKind("notes_product", "/notes/modern-history"), "notes");
  assert.match(buildNotesCampaignUrl({
    destination: "modern-history",
    source: "meta",
    medium: "paid_social",
    campaign: "mh_launch",
  }), /\/notes\/modern-history/);
  assert.match(landing, /ModernHistoryLaunch/);
  assert.match(modal, /notes_product/);
  assert.match(modal, /Notes Product/);
  assert.match(destinations, /notes_products/);
  assert.match(section, /Open Sample PDF/);
  assert.match(section, /Watch what you get/);
  assert.match(video, /preload="none"/);
  assert.doesNotMatch(video, /autoPlay|autoplay/);
  assert.match(video, /onError/);
});

test("Modern History analytics stay on their own subject, not Other", () => {
  const events = [
    {
      event_name: "notes_product_clicked",
      session_id: "s1",
      visitor_id: "v1",
      occurred_at: "2026-10-11T10:00:00.000Z",
      props: { subject: "modern-history", slug: "modern-history", product_id: MODERN_HISTORY_PRODUCT_ID },
    },
    {
      event_name: "notes_product_viewed",
      session_id: "s1",
      visitor_id: "v1",
      occurred_at: "2026-10-11T10:00:01.000Z",
      props: { subject: "modern-history", slug: "modern-history", product_id: MODERN_HISTORY_PRODUCT_ID },
    },
  ];
  const report = aggregateNotesAnalytics(events, [], []);
  assert.equal(report.subjects["modern-history"].clicks, 1);
  assert.equal(report.subjects["modern-history"].people, 1);
  assert.equal(report.products[0]?.label, "Modern History Notes");
});
