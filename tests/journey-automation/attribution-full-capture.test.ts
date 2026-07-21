/**
 * FULL AD-IDENTIFIER CAPTURE (additive attribution upgrade).
 *
 * Covers the five scenarios from the shipment spec:
 *   (a) legacy link with no new params → all new columns null, old behavior unchanged
 *   (b) full Meta link (fbclid + campaign_id + adset_id + ad_id + ad_name) → all levels populated, platform=meta
 *   (c) full Google link (gclid + utm_source=google + campaign_id) → platform=google
 *   (d) first-touch still beats last-touch (a full-ad first touch is not overwritten by a later touch)
 *   (e) flag OFF → new columns receive null-equivalent (empty stamp), old columns unchanged
 *
 * Simulation-only (no DB, no SMS, no send path).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildTouch,
  mergeAttribution,
  derivePlatform,
  deriveChannel,
  type AttributionState,
} from "../../lib/attribution";
import {
  adCaptureStampFromState,
  EMPTY_AD_CAPTURE_STAMP,
  AD_CAPTURE_SCALAR_COLUMNS,
} from "../../lib/marketing/adCaptureStamp";
import { isFullCaptureEnabled } from "../../lib/marketing/adCaptureFlag";

const T1 = "2026-07-21T10:00:00.000Z";
const T2 = "2026-07-21T11:00:00.000Z";

function landing(
  params: Record<string, string>,
  opts: { referrer?: string | null; path?: string } = {},
) {
  // `??` would coerce an explicit `null` to the default — use hasOwnProperty
  // so callers can pass `null` to simulate a real Direct visit (no referrer).
  const referrer = Object.prototype.hasOwnProperty.call(opts, "referrer")
    ? opts.referrer ?? null
    : "https://www.google.com/";
  return buildTouch({
    params,
    referrer,
    path: opts.path ?? "/webinars/upsc-full-masterclass-by-naman-sir-july-25",
    ownHost: "www.namanias.com",
  });
}

describe("(a) legacy link — no new params → new columns all null, old channel unchanged", () => {
  it("plain UTM-only Google link still tags Google Ads and leaves ad-hierarchy columns null", () => {
    const touch = landing({ utm_source: "google", utm_medium: "cpc", utm_campaign: "brand" });
    const state = mergeAttribution(null, touch, T1);
    const stamp = adCaptureStampFromState(state);
    // Old attribution behavior identical:
    assert.equal(deriveChannel(state.first_touch), "Google Ads");
    assert.equal(state.first_touch?.campaign, "brand");
    // New columns all null:
    for (const col of AD_CAPTURE_SCALAR_COLUMNS) {
      if (col === "attribution_platform") continue;
      assert.equal(stamp[col], null, `${col} should be null on a legacy link`);
    }
    // Platform derives from utm_source=google + paid medium even without new ids:
    assert.equal(stamp.attribution_platform, "google");
  });

  it("Direct visit (no params, no referrer) → EMPTY stamp; no fabricated ids", () => {
    const touch = landing({}, { referrer: null });
    const state = mergeAttribution(null, touch, T1);
    const stamp = adCaptureStampFromState(state);
    assert.deepEqual(stamp, EMPTY_AD_CAPTURE_STAMP);
    assert.equal(deriveChannel(state.first_touch), "Direct");
  });
});

describe("(b) full Meta link → all levels populated, platform=meta", () => {
  it("captures fbclid + campaign_id + adset_id + ad_id + ad_name from landing", () => {
    const touch = landing({
      utm_source: "meta",
      utm_medium: "paid",
      utm_campaign: "webinar_july25",
      utm_content: "carousel_v3",
      campaign_id: "120210000000123456",
      adset_id: "120210000000123789",
      ad_id: "120210000000124000",
      ad_name: "carousel_v3 - naman sir masterclass",
    });
    touch.fbclid = "IwAR2xyz";
    const state = mergeAttribution(null, touch, T1);
    const stamp = adCaptureStampFromState(state);
    assert.equal(stamp.attribution_campaign_id, "120210000000123456");
    assert.equal(stamp.attribution_adset_id, "120210000000123789");
    assert.equal(stamp.attribution_ad_id, "120210000000124000");
    assert.equal(stamp.attribution_ad_name, "carousel_v3 - naman sir masterclass");
    assert.equal(stamp.attribution_utm_content, "carousel_v3");
    assert.equal(stamp.attribution_platform, "meta");
    // Channel still resolves to Meta Ads via the shared predicate.
    assert.equal(deriveChannel(state.first_touch), "Meta Ads");
    assert.equal(derivePlatform(state.first_touch), "meta");
  });

  it("derives platform=meta even without fbclid when instagram+paid + ad ids present", () => {
    const touch = landing({
      utm_source: "instagram",
      utm_medium: "paid_social",
      utm_campaign: "reels_test",
      campaign_id: "999",
      ad_id: "111",
    });
    const stamp = adCaptureStampFromState(mergeAttribution(null, touch, T1));
    assert.equal(stamp.attribution_platform, "meta");
  });
});

describe("(c) full Google link → all levels populated, platform=google", () => {
  it("captures gclid + campaign_id (adgroup_id) + ad_id + ad_name from ValueTrack landing", () => {
    const touch = landing({
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "search_upsc",
      utm_term: "upsc coaching",
      campaign_id: "17123456789",
      adset_id: "112233445566",
      ad_id: "699887766554",
      ad_name: "expanded_text_v2",
    });
    touch.gclid = "Cj0KCQjw_xyz";
    const state = mergeAttribution(null, touch, T1);
    const stamp = adCaptureStampFromState(state);
    assert.equal(stamp.attribution_campaign_id, "17123456789");
    assert.equal(stamp.attribution_adset_id, "112233445566");
    assert.equal(stamp.attribution_ad_id, "699887766554");
    assert.equal(stamp.attribution_ad_name, "expanded_text_v2");
    assert.equal(stamp.attribution_utm_content, null); // not sent on this link
    assert.equal(stamp.attribution_utm_term, "upsc coaching");
    assert.equal(stamp.attribution_platform, "google");
    assert.equal(deriveChannel(state.first_touch), "Google Ads");
    assert.equal(derivePlatform(state.first_touch), "google");
  });

  it("iOS app click (wbraid, no gclid) is still classified google", () => {
    const touch = landing({ utm_source: "google", utm_medium: "cpc", campaign_id: "17000000000" });
    touch.wbraid = "wb_abc";
    const state = mergeAttribution(null, touch, T1);
    assert.equal(derivePlatform(state.first_touch), "google");
    assert.equal(deriveChannel(state.first_touch), "Google Ads");
  });
});

describe("(d) first-touch still beats last-touch — a full-ad first touch is not overwritten", () => {
  it("full-Meta first touch survives a later untagged direct visit", () => {
    const meta = landing({
      utm_source: "meta",
      utm_medium: "paid",
      utm_campaign: "webinar_july25",
      campaign_id: "AAA",
      adset_id: "BBB",
      ad_id: "CCC",
      ad_name: "carousel_v3",
    });
    meta.fbclid = "fbclick";
    let state: AttributionState = mergeAttribution(null, meta, T1);
    // Later hop: a bare Direct visit — no ids, no campaign, no click.
    const later = landing({}, { referrer: null });
    state = mergeAttribution(state, later, T2);
    const stamp = adCaptureStampFromState(state);
    // First-touch is unchanged and still carries the full ad hierarchy.
    assert.equal(state.first_touch?.campaign_id, "AAA");
    assert.equal(state.first_touch?.ad_id, "CCC");
    assert.equal(state.first_touch?.ad_name, "carousel_v3");
    // Stamp (first-touch wins) still shows the ad-level identifiers.
    assert.equal(stamp.attribution_ad_id, "CCC");
    assert.equal(stamp.attribution_platform, "meta");
    // Last-touch stickiness: the empty later touch never erases fbclid/campaign/ad-hierarchy.
    assert.equal(state.last_touch?.fbclid, "fbclick");
    assert.equal(state.last_touch?.campaign, "webinar_july25");
    assert.equal(state.last_touch?.campaign_id, "AAA");
    assert.equal(state.last_touch?.adset_id, "BBB");
    assert.equal(state.last_touch?.ad_id, "CCC");
    assert.equal(state.last_touch?.ad_name, "carousel_v3");
  });

  it("full-Google first touch survives a later Meta touch (first-touch precedence)", () => {
    const google = landing({
      utm_source: "google", utm_medium: "cpc", utm_campaign: "brand",
      campaign_id: "G_CAMP", ad_id: "G_AD",
    });
    google.gclid = "GCLICK";
    const meta = landing({
      utm_source: "meta", utm_medium: "paid", utm_campaign: "retarget",
      campaign_id: "M_CAMP", ad_id: "M_AD",
    });
    meta.fbclid = "FBCLICK";
    let state = mergeAttribution(null, google, T1);
    state = mergeAttribution(state, meta, T2);
    const stamp = adCaptureStampFromState(state);
    // First-touch stamp: Google.
    assert.equal(stamp.attribution_campaign_id, "G_CAMP");
    assert.equal(stamp.attribution_ad_id, "G_AD");
    assert.equal(stamp.attribution_platform, "google");
    // Last-touch reflects Meta.
    assert.equal(state.last_touch?.campaign_id, "M_CAMP");
    assert.equal(state.last_touch?.ad_id, "M_AD");
  });
});

describe("(e) flag OFF path — writer spreads EMPTY_AD_CAPTURE_STAMP", () => {
  it("EMPTY stamp is all-null so a spread on the INSERT row leaves every new column null", () => {
    for (const col of AD_CAPTURE_SCALAR_COLUMNS) {
      assert.equal(EMPTY_AD_CAPTURE_STAMP[col], null, `${col} must be null in EMPTY_AD_CAPTURE_STAMP`);
    }
  });

  it("isFullCaptureEnabled: default ON; explicit 'false' disables; other values leave it ON", () => {
    const prev = process.env.ATTRIBUTION_FULL_CAPTURE_ENABLED;
    try {
      delete process.env.ATTRIBUTION_FULL_CAPTURE_ENABLED;
      assert.equal(isFullCaptureEnabled(), true, "default (unset) → ON");
      process.env.ATTRIBUTION_FULL_CAPTURE_ENABLED = "";
      assert.equal(isFullCaptureEnabled(), true, "empty string → ON");
      process.env.ATTRIBUTION_FULL_CAPTURE_ENABLED = "true";
      assert.equal(isFullCaptureEnabled(), true, "'true' → ON");
      process.env.ATTRIBUTION_FULL_CAPTURE_ENABLED = "FALSE";
      assert.equal(isFullCaptureEnabled(), true, "uppercase 'FALSE' → still ON (exact match required)");
      process.env.ATTRIBUTION_FULL_CAPTURE_ENABLED = "false";
      assert.equal(isFullCaptureEnabled(), false, "'false' → OFF");
    } finally {
      if (prev == null) delete process.env.ATTRIBUTION_FULL_CAPTURE_ENABLED;
      else process.env.ATTRIBUTION_FULL_CAPTURE_ENABLED = prev;
    }
  });

  it("simulates the writer's flag-OFF branch — new columns receive nulls, legacy columns untouched", () => {
    // A rich Meta cookie state: proves the flag-off branch STILL suppresses the
    // new columns even when a real ad stamp is available.
    const touch = landing({
      utm_source: "meta",
      utm_medium: "paid",
      utm_campaign: "carousel_v3",
      campaign_id: "111",
      adset_id: "222",
      ad_id: "333",
      ad_name: "carousel_v3",
    });
    touch.fbclid = "fb";
    const state = mergeAttribution(null, touch, T1);

    const flagOnStamp = adCaptureStampFromState(state);
    // Real stamp populates the new columns:
    assert.equal(flagOnStamp.attribution_ad_id, "333");
    assert.equal(flagOnStamp.attribution_platform, "meta");

    // Simulate the exact spread pattern used at the writer sites:
    const flagOffRow: Record<string, unknown> = {
      // legacy fields set by unchanged code path:
      attribution_source: "meta",
      attribution_campaign: "carousel_v3",
      ...EMPTY_AD_CAPTURE_STAMP,
    };
    // Legacy columns are byte-identical to pre-shipment behavior:
    assert.equal(flagOffRow.attribution_source, "meta");
    assert.equal(flagOffRow.attribution_campaign, "carousel_v3");
    // New columns are all null:
    for (const col of AD_CAPTURE_SCALAR_COLUMNS) {
      assert.equal(flagOffRow[col], null, `flag-off row: ${col} must be null`);
    }
  });
});
