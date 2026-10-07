/**
 * clid (campaign-link id) persistence through the first/last-touch attribution
 * model. A /go/<code> click must become a first-touch acquisition and survive a
 * later direct visit; a later link click updates last-touch.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildTouch, mergeAttribution, type AttributionTouch } from "../../lib/attribution";

function touch(params: Record<string, string>, path = "/webinars/x"): AttributionTouch {
  return buildTouch({ params, referrer: null, path, ownHost: "www.namanias.com" });
}

describe("clid attribution", () => {
  it("captures clid off the landing params", () => {
    const t = touch({ utm_source: "meta", utm_campaign: "oct", clid: "officer-oct10" });
    assert.equal(t.clid, "officer-oct10");
  });

  it("records a campaign-link click as first-touch acquisition", () => {
    const s = mergeAttribution(null, touch({ utm_source: "instagram", clid: "notes-ig-r3" }), "2026-10-07T00:00:00Z");
    assert.equal(s.first_touch?.clid, "notes-ig-r3");
    assert.equal(s.last_touch?.clid, "notes-ig-r3");
  });

  it("does NOT overwrite the first-touch clid on a later direct visit", () => {
    const first = mergeAttribution(null, touch({ utm_source: "meta", clid: "officer-oct10" }), "2026-10-07T00:00:00Z");
    const direct = mergeAttribution(first, touch({}, "/portal"), "2026-10-09T00:00:00Z");
    assert.equal(direct.first_touch?.clid, "officer-oct10", "first-touch clid frozen");
    // last-touch carries the known clid forward (campaign-link stickiness)
    assert.equal(direct.last_touch?.clid, "officer-oct10");
  });

  it("updates last-touch to a newer campaign-link click", () => {
    const first = mergeAttribution(null, touch({ utm_source: "meta", clid: "link-a" }), "2026-10-01T00:00:00Z");
    const second = mergeAttribution(first, touch({ utm_source: "instagram", clid: "link-b" }), "2026-10-05T00:00:00Z");
    assert.equal(second.first_touch?.clid, "link-a", "first stays");
    assert.equal(second.last_touch?.clid, "link-b", "last rolls to newest link");
  });
});
