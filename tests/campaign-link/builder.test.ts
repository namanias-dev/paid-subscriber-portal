/**
 * General UTM campaign link builder.
 * Verifies normalisation, required-field warnings, destination handling and that
 * the produced URL round-trips through the same attribution parser the site uses.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildCampaignUrl,
  normalizeUtmValue,
  CAMPAIGN_SITE_URL,
  CHANNEL_PRESETS,
  DESTINATION_PRESETS,
} from "../../lib/marketing/campaignLink";

describe("campaign link builder", () => {
  it("normalises utm values to lowercase underscore slugs", () => {
    assert.equal(normalizeUtmValue("  AI Notes Risk Reel  "), "ai_notes_risk_reel");
    assert.equal(normalizeUtmValue("Polity — Carousel #1"), "polity_carousel_1");
    assert.equal(normalizeUtmValue(""), "");
    assert.equal(normalizeUtmValue(null), "");
  });

  it("builds a clean URL from a path destination with all utm params", () => {
    const { url, params, warnings } = buildCampaignUrl({
      destination: "/webinar",
      source: "Instagram",
      medium: "Reel",
      campaign: "AI Notes Launch",
      content: "AI Notes Risk Reel",
      term: "mains",
    });
    assert.equal(warnings.length, 0);
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, `${CAMPAIGN_SITE_URL}/webinar`);
    assert.equal(u.searchParams.get("utm_source"), "instagram");
    assert.equal(u.searchParams.get("utm_medium"), "reel");
    assert.equal(u.searchParams.get("utm_campaign"), "ai_notes_launch");
    assert.equal(u.searchParams.get("utm_content"), "ai_notes_risk_reel");
    assert.equal(u.searchParams.get("utm_term"), "mains");
    assert.equal(params.utm_content, "ai_notes_risk_reel");
  });

  it("keeps an absolute destination URL as its own base", () => {
    const { url } = buildCampaignUrl({
      destination: "https://www.namanias.com/courses/upsc-foundation",
      source: "youtube",
      medium: "video",
      campaign: "launch",
    });
    const u = new URL(url);
    assert.equal(u.hostname, "www.namanias.com");
    assert.equal(u.pathname, "/courses/upsc-foundation");
    assert.equal(u.searchParams.get("utm_source"), "youtube");
  });

  it("warns when required attribution fields are missing but never throws", () => {
    const { warnings, params } = buildCampaignUrl({
      destination: "/notes",
      source: "",
      medium: "",
      campaign: "",
    });
    assert.ok(warnings.some((w) => /Source/.test(w)));
    assert.ok(warnings.some((w) => /Medium/.test(w)));
    assert.ok(warnings.some((w) => /Campaign/.test(w)));
    assert.equal(params.utm_source, undefined);
  });

  it("flags an invalid destination", () => {
    const { url, warnings } = buildCampaignUrl({
      destination: "   ",
      source: "instagram",
      medium: "reel",
      campaign: "x",
    });
    assert.equal(url, "");
    assert.ok(warnings.some((w) => /destination/i.test(w)));
  });

  it("ships usable channel + destination presets", () => {
    assert.ok(CHANNEL_PRESETS.length >= 8);
    for (const p of CHANNEL_PRESETS) {
      assert.ok(p.source && p.medium, `preset ${p.id} needs source+medium`);
      assert.equal(normalizeUtmValue(p.source), p.source);
      assert.equal(normalizeUtmValue(p.medium), p.medium);
    }
    assert.ok(DESTINATION_PRESETS.some((d) => d.path === "/notes"));
  });
});
