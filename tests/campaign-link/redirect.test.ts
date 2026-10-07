/**
 * Campaign-link redirect composition + safety (open-redirect guard) and
 * short-code helpers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  composeRedirectUrl,
  isSafeDestination,
  normalizeShortCode,
  isValidShortCode,
  randomShortCode,
  CAMPAIGN_SITE_URL,
} from "../../lib/marketing/campaignLink";

describe("campaign-link redirect safety", () => {
  it("accepts same-origin paths and allowlisted hosts only", () => {
    assert.equal(isSafeDestination("/webinars/x"), true);
    assert.equal(isSafeDestination("https://www.namanias.com/notes"), true);
    assert.equal(isSafeDestination("https://namanias.com/courses/y"), true);
    // Open-redirect / unsafe schemes
    assert.equal(isSafeDestination("https://evil.com/phish"), false);
    assert.equal(isSafeDestination("//evil.com"), false);
    assert.equal(isSafeDestination("javascript:alert(1)"), false);
    assert.equal(isSafeDestination("data:text/html,x"), false);
    assert.equal(isSafeDestination("http://namanias.com/x"), false); // non-https absolute
    assert.equal(isSafeDestination(""), false);
  });

  it("rejects destinations that loop back into /go", () => {
    assert.equal(isSafeDestination("/go/other-code"), false);
    assert.equal(isSafeDestination("/go"), false);
    assert.equal(isSafeDestination("https://www.namanias.com/go/x"), false);
    assert.equal(isSafeDestination("/gopher"), true, "only the /go route, not lookalikes");
  });
});

describe("composeRedirectUrl", () => {
  it("appends canonical utm + clid to a relative destination and stays relative", () => {
    const url = composeRedirectUrl({
      destination: "/webinars/upsc-masterclass",
      utm: { source: "Meta", medium: "paid_social", campaign: "UPSC Oct", content: "reel v3" },
      clid: "officer-oct10",
    });
    assert.ok(url.startsWith("/webinars/upsc-masterclass?"));
    const u = new URL(url, CAMPAIGN_SITE_URL);
    assert.equal(u.searchParams.get("utm_source"), "meta");
    assert.equal(u.searchParams.get("utm_campaign"), "upsc_oct");
    assert.equal(u.searchParams.get("utm_content"), "reel_v3");
    assert.equal(u.searchParams.get("clid"), "officer-oct10");
  });

  it("preserves existing destination query and passthrough click ids", () => {
    const url = composeRedirectUrl({
      destination: "/notes?ref=abc",
      utm: { source: "instagram", medium: "reel", campaign: "notes" },
      clid: "notes-ig-r3",
      passthrough: new URLSearchParams("fbclid=XYZ&code=notes-ig-r3"),
    });
    const u = new URL(url, CAMPAIGN_SITE_URL);
    assert.equal(u.searchParams.get("ref"), "abc");
    assert.equal(u.searchParams.get("fbclid"), "XYZ");
    assert.equal(u.searchParams.get("clid"), "notes-ig-r3");
    assert.equal(u.searchParams.get("code"), null, "route param must not leak");
  });

  it("returns empty string for an unsafe destination", () => {
    assert.equal(composeRedirectUrl({ destination: "https://evil.com", utm: { source: "x" }, clid: "y" }), "");
    assert.equal(composeRedirectUrl({ destination: "/go/loop", utm: { source: "x" }, clid: "y" }), "");
  });
});

describe("short code helpers", () => {
  it("normalises and validates aliases", () => {
    assert.equal(normalizeShortCode("Officer Oct 10!!"), "officer-oct-10");
    assert.equal(isValidShortCode("ab"), false); // too short
    assert.equal(isValidShortCode("go"), false); // reserved
    assert.equal(isValidShortCode("officer-oct10"), true);
  });
  it("random codes avoid ambiguous chars and are the right length", () => {
    const c = randomShortCode(7);
    assert.equal(c.length, 7);
    assert.ok(!/[0o1li]/.test(c));
  });
});
