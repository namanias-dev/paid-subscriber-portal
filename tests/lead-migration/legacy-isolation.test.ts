/**
 * CRITICAL — legacy rows must be INVISIBLE to the CRM, dashboard, SMS bulk
 * audiences, and campaign aggregation by default. This regression suite pins
 * every one of the 7 legacy-aware sites via the shared filter helper.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyLegacyFilter, excludeLegacy, hasLegacyFlag } from "../../lib/legacy-migration/legacyFilter";
import { mergeCollisionAttribution } from "../../lib/legacy-migration/importer";
import { derivedChannelFor, type DerivedChannelAttr } from "../../lib/webinarSource";
import type { LegacyTouchpoint } from "../../lib/legacy-migration/types";
import type { Lead, Payment } from "../../lib/types";

function makeLead(id: string, attribution: unknown): Lead {
  return {
    id,
    name: `Lead ${id}`,
    phone: "6000000000",
    email: null,
    city: null,
    state: null,
    source: "Website",
    campaign: null,
    course_interest: null,
    target_year: null,
    mode_pref: null,
    called: false,
    status: "New",
    temperature: "Interested",
    demo_booked: false,
    demo_attended: false,
    webinar_registered: false,
    webinar_attended: false,
    admitted: false,
    course: null,
    total_fee: null,
    amount_collected: null,
    pending_balance: null,
    follow_up_date: null,
    counsellor: null,
    created_at: new Date().toISOString(),
    sources: [],
    first_source: null,
    first_campaign: null,
    merged_count: 0,
    attribution: attribution as Lead["attribution"],
  };
}

describe("hasLegacyFlag — structural JSONB check", () => {
  it("true when attribution.legacy === true", () => {
    assert.equal(hasLegacyFlag(makeLead("a", { legacy: true })), true);
  });
  it("true when attribution.legacy === 'true' (SQL-side setter compat)", () => {
    assert.equal(hasLegacyFlag(makeLead("b", { legacy: "true" })), true);
  });
  it("false when attribution is null / undefined / other object", () => {
    assert.equal(hasLegacyFlag(makeLead("c", null)), false);
    assert.equal(hasLegacyFlag(makeLead("d", { first_touch: {} })), false);
  });
});

describe("applyLegacyFilter — safe-by-default", () => {
  const live1 = makeLead("live-1", { first_touch: {} });
  const live2 = makeLead("live-2", null);
  const legacy1 = makeLead("legacy-1", { legacy: true, legacy_source_tab: "FB LEADS" });
  const legacy2 = makeLead("legacy-2", { legacy: true, legacy_source_tab: "Sheet1" });
  const all = [live1, legacy1, live2, legacy2];

  it("hides legacy by default (no opts)", () => {
    const out = applyLegacyFilter(all);
    assert.deepEqual(out.map((l) => l.id), ["live-1", "live-2"]);
  });
  it("hides legacy when includeLegacy=false", () => {
    const out = applyLegacyFilter(all, { includeLegacy: false });
    assert.deepEqual(out.map((l) => l.id), ["live-1", "live-2"]);
  });
  it("shows everything when includeLegacy=true", () => {
    const out = applyLegacyFilter(all, { includeLegacy: true });
    assert.deepEqual(out.map((l) => l.id), all.map((l) => l.id));
  });
  it("preserves input order", () => {
    const out = excludeLegacy(all);
    assert.equal(out[0].id, "live-1");
    assert.equal(out[1].id, "live-2");
  });
});

describe("Source-card / channel counts stay unchanged after a legacy import", () => {
  it("legacy phones DO populate the derived-channel map (display path), but derivedChannelFor short-circuits legacy entries to Unknown (counts path)", () => {
    // Post-fix contract (see docs/naman-ai/reports/payment-source-restore.md):
    //   - The admin payments/students routes now build `leadAttrByPhone` from
    //     `getLeads({ includeLegacy: true })` so a pure-legacy-only phone can
    //     still render an honest SourcePill IF the scalar `channel` is set
    //     (Meta Ads / Google Ads / etc.). Each map entry carries a `legacy`
    //     boolean captured from `hasLegacyFlag(lead)`.
    //   - The aggregate source-card path (`derivedChannelFor` /
    //     `bucketizeSources`) checks that flag and returns "Unknown" for any
    //     legacy row — so aggregate channel counts stay legacy-free (G1).
    // This test pins BOTH halves of that contract.
    const legacyLead = makeLead("l1", { legacy: true, legacy_source_tab: "FB LEADS" });
    // Simulate the payments route's post-fix map-building loop.
    const map: Record<string, DerivedChannelAttr> = {};
    for (const l of applyLegacyFilter([legacyLead], { includeLegacy: true })) {
      map[l.phone] = { channel: "Meta Ads", legacy: hasLegacyFlag(l) };
    }
    assert.equal(Object.keys(map).length, 1, "display map DOES include legacy leads (post-fix)");
    assert.equal(map[legacyLead.phone].legacy, true, "legacy flag propagates onto the map entry");

    // Aggregate count path returns Unknown for the legacy entry — same as if
    // the row had been filtered out entirely. Legacy stays out of counts.
    const payment = {
      id: "p1",
      phone: legacyLead.phone,
      status: "captured",
      item_type: "webinar",
    } as unknown as Payment;
    assert.equal(
      derivedChannelFor(payment, map),
      "Unknown",
      "legacy-flagged entries must never bucket into a real channel — protects G1",
    );
  });

  it("a NON-legacy phone with the same channel string routes to the real channel (isolation is scoped to legacy rows only)", () => {
    // Regression pin: the legacy short-circuit MUST NOT affect non-legacy rows
    // that happen to share the same channel string. Only `legacy === true`
    // triggers the "Unknown" fallback.
    const liveLead = makeLead("l2", { first_touch: { tab: "meta", winner: true } });
    const map: Record<string, DerivedChannelAttr> = {
      [liveLead.phone]: { channel: "Meta Ads", legacy: false },
    };
    const payment = {
      id: "p2",
      phone: liveLead.phone,
      status: "captured",
      item_type: "webinar",
    } as unknown as Payment;
    assert.equal(derivedChannelFor(payment, map), "Meta Ads");
  });
});

describe("SMS audiences never expose legacy phones by default", () => {
  it("filtered leads set does not include legacy phone", () => {
    const universe = new Map<string, string | null>();
    const live = makeLead("live-1", null);
    const legacy = makeLead("legacy-1", { legacy: true });
    // Simulate the audiences.ts loop (default includeLegacy=false).
    for (const l of applyLegacyFilter([live, legacy])) universe.set(l.phone, l.name);
    assert.equal(universe.size, 1);
    assert.equal([...universe.keys()][0], "6000000000");
  });
});

/**
 * Regression pin for the batch 2026-07-22T02:54:55.394Z bug — 127 live rows
 * whose phones matched the legacy sheet were incorrectly stamped
 * `attribution.legacy=true`, and disappeared from the CRM. These fixtures model
 * the ACTUAL 127 collision pre-state shapes (majority NULL attribution + a
 * long tail of `{ first_touch: {...} }` rows from the live Meta / website
 * flow). After `mergeCollisionAttribution`, none of these rows may trigger
 * `hasLegacyFlag` — that is what keeps the CRM active-lead count at 948.
 */
describe("collision-merge regression pin — 10 masked fixtures modeling the 127 collision shapes", () => {
  const incoming = {
    legacy_touches: [
      { tab: "FB LEADS", winner: true, campaign_clean: "generic-brand" } as LegacyTouchpoint,
    ],
  };
  const fixtures: Array<{ label: string; preState: unknown }> = [
    { label: "null attribution (Website form, no attribution set)", preState: null },
    { label: "undefined attribution (defensive)", preState: undefined },
    { label: "empty object attribution", preState: {} },
    {
      label: "Meta first_touch only",
      preState: {
        first_touch: { tab: "meta", source: "meta_lead_ads", ts: "2026-07-01T00:00:00Z", winner: true },
      },
    },
    {
      label: "Website first_touch with utm_source",
      preState: {
        first_touch: { tab: "website", source: "direct", winner: true },
        utm_source: "google",
        utm_campaign: "brand",
      },
    },
    {
      label: "Referral first_touch with existing legacy_touches (multi-visit legacy lead)",
      preState: {
        first_touch: { tab: "referral", winner: true },
        legacy_touches: [{ tab: "SEP-OCT LEADS 2024", winner: true }],
      },
    },
    {
      label: "attribution with origin_review_needed=true (Meta drift-detected row)",
      preState: {
        first_touch: { tab: "meta", winner: true },
        origin_review_needed: true,
      },
    },
    {
      label: "attribution with utm_* but no first_touch (webinar landing page)",
      preState: {
        utm_source: "facebook",
        utm_medium: "cpc",
        utm_campaign: "aug-webinar",
      },
    },
    {
      label: "attribution with campaign_confidence hint",
      preState: {
        first_touch: { tab: "meta", winner: true },
        campaign_confidence: "explicit",
        platform_hint: "meta",
      },
    },
    {
      label: "attribution that already had a legacy_touches array from a prior legacy run",
      preState: {
        first_touch: { tab: "meta", winner: true },
        legacy_touches: [
          { tab: "FB LEADS", winner: true, campaign_clean: "old-brand" },
          { tab: "SEP-OCT LEADS 2024", winner: false },
        ],
      },
    },
  ];

  for (const { label, preState } of fixtures) {
    it(`fixture: ${label} — mergeCollisionAttribution never flips hasLegacyFlag`, () => {
      const merged = mergeCollisionAttribution(preState, incoming);
      const asLead = { attribution: merged as unknown as Lead["attribution"] };
      assert.equal(
        hasLegacyFlag(asLead),
        false,
        `hasLegacyFlag returned true for fixture "${label}" — merged: ${JSON.stringify(merged)}`,
      );
      assert.equal(
        applyLegacyFilter([asLead]).length,
        1,
        `applyLegacyFilter dropped a collision-merged row for fixture "${label}"`,
      );
      // Never write `legacy` or `legacy_source_tab` on the merged object.
      assert.equal(Object.prototype.hasOwnProperty.call(merged, "legacy"), false);
      assert.equal(Object.prototype.hasOwnProperty.call(merged, "legacy_source_tab"), false);
      // legacy_touches must be an array containing at least the incoming touch.
      assert.ok(Array.isArray(merged.legacy_touches));
      assert.ok((merged.legacy_touches as unknown[]).length >= 1);
    });
  }
});
