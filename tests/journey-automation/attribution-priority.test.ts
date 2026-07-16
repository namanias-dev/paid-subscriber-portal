/**
 * Attribution priority + self-referral + payments source lookup
 * — root-cause fix for the "testing11" case where a lead arrived via a
 *   Google Ads URL (?gclid=test123&utm_source=google&utm_medium=cpc) yet was
 *   attributed to CHANNEL=Referral. Evidence from the stored row:
 *
 *   first_touch = { source: "referral",
 *                   referrer: "https://www.namanias.com/", landing_path: "/" }   ← stale self-referral
 *   last_touch  = { source: "google", medium: "cpc", campaign: "masterclass_test", gclid: "test123" }
 *
 *   Two independent bugs made this possible:
 *    (1) normalizeSource compared bare host ("namanias.com") against a
 *        non-normalized ownHost ("www.namanias.com") → self-referral leaked
 *        through as EXTERNAL "referral";
 *    (2) mergeAttribution only upgraded a "direct" first-touch, so this
 *        referral first-touch blocked the real Google Ads acquisition.
 *
 * This suite locks in the fix and pins the priority contract going forward.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildTouch,
  deriveChannel,
  mergeAttribution,
  normalizeSource,
  touchHasAcquisitionSignal,
  GOOGLE_ADS_CHANNEL,
} from "../../lib/attribution";

describe("normalizeSource — self-referrals are DIRECT (root cause 1)", () => {
  it('namanias.com → namanias.com is "direct" when ownHost="www.namanias.com" (was "referral")', () => {
    const r = normalizeSource(null, "https://www.namanias.com/", "www.namanias.com");
    assert.equal(r.source, "direct", "self-referral must be direct");
    assert.equal(r.raw, null);
  });

  it('bare-host referrer namanias.com/ against ownHost www.namanias.com is DIRECT', () => {
    const r = normalizeSource(null, "https://namanias.com/some-page", "www.namanias.com");
    assert.equal(r.source, "direct");
  });

  it("subdomains of our own host (e.g. app.namanias.com) are DIRECT", () => {
    const r = normalizeSource(null, "https://app.namanias.com/x", "www.namanias.com");
    assert.equal(r.source, "direct");
  });

  it("truly external referrer stays REFERRAL (raw kept)", () => {
    const r = normalizeSource(null, "https://external-blog.com/x", "www.namanias.com");
    assert.equal(r.source, "referral");
    assert.equal(r.raw, "external-blog.com");
  });

  it("utm_source=google always wins over any referrer", () => {
    const r = normalizeSource("google", "https://external-blog.com/x", "www.namanias.com");
    assert.equal(r.source, "google");
  });
});

describe("deriveChannel — gclid / utm_source=google (paid) → Google Ads (priority contract)", () => {
  it("gclid alone → Google Ads even without utm_source", () => {
    const t = buildTouch({
      params: {},
      referrer: "https://www.namanias.com/",
      path: "/webinars/x",
      ownHost: "www.namanias.com",
    });
    t.gclid = "test123";
    assert.equal(deriveChannel(t), GOOGLE_ADS_CHANNEL);
  });

  it("utm_source=google + utm_medium=cpc → Google Ads (regardless of referrer)", () => {
    const t = buildTouch({
      params: { utm_source: "google", utm_medium: "cpc", utm_campaign: "masterclass_test" },
      referrer: "https://external-blog.com/",
      path: "/webinars/x",
      ownHost: "www.namanias.com",
    });
    assert.equal(deriveChannel(t), GOOGLE_ADS_CHANNEL);
    assert.equal(t.campaign, "masterclass_test");
  });

  it("gclid still wins over utm_source=google without a paid medium", () => {
    const t = buildTouch({
      params: { utm_source: "google" },
      referrer: null,
      path: "/",
      ownHost: "www.namanias.com",
    });
    t.gclid = "test123";
    assert.equal(deriveChannel(t), GOOGLE_ADS_CHANNEL);
  });
});

describe("mergeAttribution — paid ad click upgrades an ambient first-touch (root cause 2)", () => {
  const NOW = "2026-07-16T15:50:17.671Z";
  const EARLIER = "2026-07-16T02:03:28.764Z";

  it("REPRO: referral first-touch → later Google Ads landing UPGRADES first-touch", () => {
    // Pre-fix state that broke testing11: first_touch already frozen as an
    // (ambient) self-referral without any acquisition signal.
    const prior = {
      first_touch: {
        source: "referral",
        medium: null,
        campaign: null,
        content: null,
        term: null,
        landing_path: "/",
        referrer: "https://www.namanias.com/",
        raw: "namanias.com",
        first_seen_at: EARLIER,
      },
      last_touch: null,
    };
    // The actual ad click landing 13h later.
    const adClick = buildTouch({
      params: { utm_source: "google", utm_medium: "cpc", utm_campaign: "masterclass_test" },
      referrer: null,
      path: "/webinars/upsc-full-masterclass-by-naman-sir-july-25",
      ownHost: "www.namanias.com",
    });
    adClick.gclid = "test123";

    const merged = mergeAttribution(prior, adClick, NOW);

    assert.equal(deriveChannel(merged.first_touch), GOOGLE_ADS_CHANNEL, "first-touch must upgrade to Google Ads");
    assert.equal(merged.first_touch!.campaign, "masterclass_test");
    assert.equal(merged.first_touch!.gclid, "test123");
    assert.equal(deriveChannel(merged.last_touch), GOOGLE_ADS_CHANNEL);
  });

  it("first-touch that ALREADY has an acquisition signal is NEVER overwritten", () => {
    const priorAd = {
      first_touch: {
        source: "google",
        medium: "cpc",
        campaign: "brand_awareness",
        content: null,
        term: null,
        landing_path: "/",
        referrer: null,
        gclid: "ORIGINAL",
        first_seen_at: EARLIER,
      },
      last_touch: null,
    };
    const laterCampaign = buildTouch({
      params: { utm_source: "google", utm_medium: "cpc", utm_campaign: "different_campaign" },
      referrer: null,
      path: "/",
      ownHost: "www.namanias.com",
    });
    laterCampaign.gclid = "DIFFERENT";
    const merged = mergeAttribution(priorAd, laterCampaign, NOW);

    assert.equal(merged.first_touch!.campaign, "brand_awareness", "existing acquisition first-touch preserved");
    assert.equal(merged.first_touch!.gclid, "ORIGINAL");
    // Last-touch rolls forward as expected.
    assert.equal(merged.last_touch!.campaign, "different_campaign");
    assert.equal(merged.last_touch!.gclid, "DIFFERENT");
  });

  it("an ambient referral WITHOUT a following ad click is NOT overwritten by another ambient touch", () => {
    const priorRef = {
      first_touch: {
        source: "referral",
        medium: null,
        campaign: null,
        content: null,
        term: null,
        landing_path: "/",
        referrer: "https://aggregator.com/",
        raw: "aggregator.com",
        first_seen_at: EARLIER,
      },
      last_touch: null,
    };
    const anotherRef = buildTouch({
      params: {},
      referrer: "https://different-blog.com/",
      path: "/x",
      ownHost: "www.namanias.com",
    });
    const merged = mergeAttribution(priorRef, anotherRef, NOW);
    // first-touch: preserved (no acquisition signal in the new touch either).
    assert.equal(merged.first_touch!.raw, "aggregator.com");
    assert.equal(merged.first_touch!.first_seen_at, EARLIER);
  });

  it("touchHasAcquisitionSignal recognises gclid, fbclid, and campaign only", () => {
    assert.equal(
      touchHasAcquisitionSignal({ source: "referral", medium: null, campaign: null, content: null, term: null, landing_path: null, referrer: null }),
      false,
    );
    assert.equal(
      touchHasAcquisitionSignal({ source: "google", medium: "cpc", campaign: "x", content: null, term: null, landing_path: null, referrer: null }),
      true,
    );
    assert.equal(
      touchHasAcquisitionSignal({ source: "direct", medium: null, campaign: null, content: null, term: null, landing_path: null, referrer: null, gclid: "g" }),
      true,
    );
    assert.equal(
      touchHasAcquisitionSignal({ source: "direct", medium: null, campaign: null, content: null, term: null, landing_path: null, referrer: null, fbclid: "f" }),
      true,
    );
  });
});

describe("end-to-end scenario — tagged masterclass landing on a fresh session", () => {
  it("first visit carrying gclid+utm on the masterclass URL → Google Ads first-touch", () => {
    const touch = buildTouch({
      params: { utm_source: "google", utm_medium: "cpc", utm_campaign: "masterclass_test" },
      referrer: null,
      path: "/webinars/upsc-full-masterclass-by-naman-sir-july-25",
      ownHost: "www.namanias.com",
    });
    touch.gclid = "test123";
    const merged = mergeAttribution(null, touch, "2026-07-16T15:50:17Z");
    assert.equal(deriveChannel(merged.first_touch), GOOGLE_ADS_CHANNEL);
    assert.equal(merged.first_touch!.campaign, "masterclass_test");
    assert.equal(merged.first_touch!.gclid, "test123");
    assert.equal(merged.first_touch!.landing_path, "/webinars/upsc-full-masterclass-by-naman-sir-july-25");
  });
});
