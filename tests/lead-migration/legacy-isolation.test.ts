/**
 * CRITICAL — legacy rows must be INVISIBLE to the CRM, dashboard, SMS bulk
 * audiences, and campaign aggregation by default. This regression suite pins
 * every one of the 7 legacy-aware sites via the shared filter helper.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyLegacyFilter, excludeLegacy, hasLegacyFlag } from "../../lib/legacy-migration/legacyFilter";
import type { Lead } from "../../lib/types";

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
  it("bucketizing paid webinar registrations excludes legacy phones", async () => {
    // Simulate a paid Payment for a phone that has a legacy lead — the payment's
    // channel is derived from `leadAttrByPhone`, which is built from getLeads().
    // With legacy filter applied, the legacy lead is not in the map → derivedChannelFor
    // returns "Unknown" (honest), not the legacy tab's channel_legacy.
    // See lib/webinarSource.ts:derivedChannelFor.
    const legacyLead = makeLead("l1", { legacy: true, legacy_source_tab: "FB LEADS" });
    const map: Record<string, { channel: string | null }> = {};
    // Simulate the payments route's map-building loop that runs BEFORE bucketize.
    for (const l of applyLegacyFilter([legacyLead])) map[l.phone] = { channel: "Meta Ads" };
    assert.equal(Object.keys(map).length, 0, "no legacy leads should populate the derived-channel map");
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
