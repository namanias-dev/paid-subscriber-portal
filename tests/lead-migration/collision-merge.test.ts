/**
 * CRITICAL — the legacy importer's collision branch must NEVER flip a
 * pre-existing live lead into a legacy-flagged row.
 *
 * The buggy shape (batch 2026-07-22T02:54:55.394Z) merged
 * `{ legacy: true, legacy_source_tab: ... }` onto 127 collision rows, which the
 * default `applyLegacyFilter` then hid from the CRM / SMS / dashboard. This
 * suite pins the fixed shape so a regression cannot re-ship.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeCollisionAttribution } from "../../lib/legacy-migration/importer";
import { applyLegacyFilter, hasLegacyFlag } from "../../lib/legacy-migration/legacyFilter";
import type { Lead } from "../../lib/types";
import type { LegacyTouchpoint } from "../../lib/legacy-migration/types";

function leadWith(attribution: unknown): Pick<Lead, "attribution"> {
  return { attribution: attribution as Lead["attribution"] };
}

function touch(tab: string, extra: Partial<LegacyTouchpoint> = {}): LegacyTouchpoint {
  return { tab: tab as LegacyTouchpoint["tab"], winner: true, ...extra };
}

describe("mergeCollisionAttribution — never flip live rows to legacy", () => {
  it("preserves first_touch, appends to existing legacy_touches, no legacy flag", () => {
    const preState = {
      first_touch: { tab: "live-source", winner: true, a: 1 },
      legacy_touches: [{ tab: "FB LEADS", a: 1 }],
    };
    const incoming = { legacy_touches: [{ tab: "Sheet1", b: 2 }] as unknown as LegacyTouchpoint[] };
    const merged = mergeCollisionAttribution(preState, incoming);

    assert.deepEqual(merged.first_touch, preState.first_touch, "first_touch must be preserved verbatim");
    assert.deepEqual(merged.legacy_touches, [
      { tab: "FB LEADS", a: 1 },
      { tab: "Sheet1", b: 2 },
    ], "legacy_touches must be appended, not overwritten");
    assert.equal(Object.prototype.hasOwnProperty.call(merged, "legacy"), false, "no `legacy` key");
    assert.equal(Object.prototype.hasOwnProperty.call(merged, "legacy_source_tab"), false, "no `legacy_source_tab` key");
    assert.equal(hasLegacyFlag(leadWith(merged)), false);
    assert.deepEqual(applyLegacyFilter([leadWith(merged)]).length, 1, "merged row must remain visible under default filter");
  });

  it("null pre-state → legacy_touches only, no legacy flag", () => {
    const incoming = { legacy_touches: [{ tab: "Sheet1", b: 2 }] as unknown as LegacyTouchpoint[] };
    const merged = mergeCollisionAttribution(null, incoming);

    assert.deepEqual(merged, { legacy_touches: [{ tab: "Sheet1", b: 2 }] });
    assert.equal(Object.prototype.hasOwnProperty.call(merged, "legacy"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(merged, "legacy_source_tab"), false);
    assert.equal(hasLegacyFlag(leadWith(merged)), false);
    assert.deepEqual(applyLegacyFilter([leadWith(merged)]).length, 1);
  });

  it("pre-state with first_touch but no legacy_touches → first_touch preserved", () => {
    const preState = { first_touch: { tab: "live-source", winner: true, x: "y" } };
    const incoming = { legacy_touches: [{ tab: "Sheet1", b: 2 }] as unknown as LegacyTouchpoint[] };
    const merged = mergeCollisionAttribution(preState, incoming);

    assert.deepEqual(merged.first_touch, preState.first_touch);
    assert.deepEqual(merged.legacy_touches, [{ tab: "Sheet1", b: 2 }]);
    assert.equal(Object.prototype.hasOwnProperty.call(merged, "legacy"), false);
    assert.equal(hasLegacyFlag(leadWith(merged)), false);
    assert.deepEqual(applyLegacyFilter([leadWith(merged)]).length, 1);
  });

  it("undefined pre-state → empty base + incoming legacy_touches, no legacy flag", () => {
    const incoming = { legacy_touches: [{ tab: "FB LEADS", c: 3 }] as unknown as LegacyTouchpoint[] };
    const merged = mergeCollisionAttribution(undefined, incoming);
    assert.deepEqual(merged, { legacy_touches: [{ tab: "FB LEADS", c: 3 }] });
    assert.equal(hasLegacyFlag(leadWith(merged)), false);
  });

  it("array pre-state (defensive) → treated as empty object", () => {
    const incoming = { legacy_touches: [{ tab: "Sheet1", z: 9 }] as unknown as LegacyTouchpoint[] };
    const merged = mergeCollisionAttribution([1, 2, 3] as unknown, incoming);
    assert.deepEqual(merged, { legacy_touches: [{ tab: "Sheet1", z: 9 }] });
    assert.equal(hasLegacyFlag(leadWith(merged)), false);
  });

  it("preserves unrelated top-level keys (utm_source, origin_review_needed, campaign_confidence)", () => {
    const preState = {
      first_touch: { tab: "live-source", winner: true },
      utm_source: "google",
      utm_campaign: "brand",
      origin_review_needed: false,
      campaign_confidence: "explicit",
    };
    const incoming = { legacy_touches: [{ tab: "Sheet1" }] as unknown as LegacyTouchpoint[] };
    const merged = mergeCollisionAttribution(preState, incoming);

    assert.equal(merged.utm_source, "google");
    assert.equal(merged.utm_campaign, "brand");
    assert.equal(merged.origin_review_needed, false);
    assert.equal(merged.campaign_confidence, "explicit");
    assert.deepEqual(merged.first_touch, preState.first_touch);
    assert.equal(hasLegacyFlag(leadWith(merged)), false);
  });

  it("empty incoming legacy_touches keeps existing legacy_touches intact", () => {
    const preState = { legacy_touches: [{ tab: "Old", n: 1 }] };
    const incoming = { legacy_touches: [] as unknown as LegacyTouchpoint[] };
    const merged = mergeCollisionAttribution(preState, incoming);
    assert.deepEqual(merged.legacy_touches, [{ tab: "Old", n: 1 }]);
    assert.equal(hasLegacyFlag(leadWith(merged)), false);
  });

  it("missing incoming legacy_touches key (undefined) is tolerated", () => {
    const preState = { legacy_touches: [{ tab: "Old" }] };
    const merged = mergeCollisionAttribution(preState, {} as unknown as { legacy_touches: LegacyTouchpoint[] });
    assert.deepEqual(merged.legacy_touches, [{ tab: "Old" }]);
    assert.equal(hasLegacyFlag(leadWith(merged)), false);
  });
});
