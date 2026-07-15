/**
 * First-party Google Ads / marketing attribution (all simulation-only; nothing sends).
 *
 * Part A  gclid rides the attribution touch; first-touch is frozen and the gclid
 *         is carried forward on later touches; channel tagging derives "Google Ads".
 * Part A  fold NEVER overwrites an existing first-touch channel/campaign/gclid.
 * Part C  the Campaign Performance aggregation counts leads → webinar reg → sign-up
 *         with correct rates and grouping.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildTouch, mergeAttribution, deriveChannel, googleIdentityFromState,
  type AttributionTouch, type AttributionState,
} from "../../lib/attribution";
import {
  leadAttributionFromState, fillMissingAttribution, newLeadAttributionColumns,
} from "../../lib/marketing/leadAttribution";
import { aggregateLeadCampaigns } from "../../lib/marketing/campaignReport";
import type { Lead } from "../../lib/types";

function touch(partial: Partial<AttributionTouch>): AttributionTouch {
  return {
    source: "direct", medium: null, campaign: null, content: null, term: null,
    landing_path: null, referrer: null, ...partial,
  };
}

describe("channel derivation (Part A)", () => {
  it("gclid → Google Ads even without utm", () => {
    assert.equal(deriveChannel(touch({ gclid: "abc123" })), "Google Ads");
  });
  it("utm_source=google + cpc → Google Ads", () => {
    assert.equal(deriveChannel(touch({ source: "google", medium: "cpc" })), "Google Ads");
  });
  it("google organic (no paid medium) → Organic", () => {
    assert.equal(deriveChannel(touch({ source: "google", medium: "organic" })), "Organic");
  });
  it("fbclid → Meta Ads", () => {
    assert.equal(deriveChannel(touch({ source: "facebook", fbclid: "fb.1" })), "Meta Ads");
  });
  it("instagram + paid → Meta Ads", () => {
    assert.equal(deriveChannel(touch({ source: "instagram", medium: "paid_social" })), "Meta Ads");
  });
  it("external referrer → Referral; direct → Direct; unknown utm → Other", () => {
    assert.equal(deriveChannel(touch({ source: "referral" })), "Referral");
    assert.equal(deriveChannel(touch({ source: "direct" })), "Direct");
    assert.equal(deriveChannel(touch({ source: "other", campaign: "x" })), "Other");
  });
});

describe("gclid capture + first-touch persistence (Part A)", () => {
  it("buildTouch parses utm params", () => {
    const t = buildTouch({ params: { utm_source: "google", utm_medium: "cpc", utm_campaign: "webinar_july" }, referrer: null, path: "/webinars", ownHost: "www.namanias.com" });
    assert.equal(t.source, "google");
    assert.equal(t.campaign, "webinar_july");
    assert.equal(t.landing_path, "/webinars");
  });

  it("first-touch is frozen; a later organic visit does not erase the Google Ads click", () => {
    const first = touch({ source: "google", medium: "cpc", campaign: "webinar_july", gclid: "g-1" });
    const s1 = mergeAttribution(null, first, "2026-07-01T00:00:00Z");
    // later: a direct visit with no marketing signal
    const s2 = mergeAttribution(s1, touch({ source: "direct" }), "2026-07-05T00:00:00Z");
    assert.equal(s2.first_touch?.gclid, "g-1");
    assert.equal(s2.first_touch?.campaign, "webinar_july");
    // gclid + campaign carried forward onto last-touch too
    assert.equal(googleIdentityFromState(s2).gclid, "g-1");
    assert.equal(s2.last_touch?.campaign, "webinar_july");
  });

  it("leadAttributionFromState prefers first-touch", () => {
    const state: AttributionState = {
      first_touch: { ...touch({ source: "google", medium: "cpc", campaign: "first_camp", gclid: "g-1" }), first_seen_at: "2026-07-01T00:00:00Z" },
      last_touch: { ...touch({ source: "instagram", campaign: "later_camp" }), last_seen_at: "2026-07-05T00:00:00Z" },
    };
    const a = leadAttributionFromState(state);
    assert.equal(a.channel, "Google Ads");
    assert.equal(a.utm_campaign, "first_camp");
    assert.equal(a.gclid, "g-1");
  });
});

describe("idempotent fold: never overwrite first-touch (Part A)", () => {
  it("fillMissingAttribution only fills blanks", () => {
    const existing = { channel: "Google Ads", utm_campaign: "first_camp", gclid: "g-1", utm_source: null, attribution: null };
    const incoming = leadAttributionFromState({
      first_touch: { ...touch({ source: "instagram", campaign: "later_camp" }), first_seen_at: "2026-07-05T00:00:00Z" },
      last_touch: null,
    });
    const patch = fillMissingAttribution(existing, incoming);
    // existing channel/campaign/gclid untouched
    assert.equal(patch.channel, undefined);
    assert.equal(patch.utm_campaign, undefined);
    assert.equal(patch.gclid, undefined);
    // a blank field gets filled
    assert.equal(patch.utm_source, "instagram");
  });

  it("newLeadAttributionColumns emits only present values + the jsonb state", () => {
    const a = leadAttributionFromState({
      first_touch: { ...touch({ source: "google", medium: "cpc", campaign: "c", gclid: "g" }), first_seen_at: "2026-07-01T00:00:00Z" },
      last_touch: null,
    });
    const cols = newLeadAttributionColumns(a);
    assert.equal(cols.channel, "Google Ads");
    assert.equal(cols.utm_campaign, "c");
    assert.equal(cols.gclid, "g");
    assert.ok(cols.attribution, "keeps full jsonb state");
    assert.ok(!("utm_term" in cols), "absent fields are omitted");
  });
});

describe("Campaign Performance aggregation (Part C)", () => {
  const L = (over: Partial<Lead>): Lead => ({
    id: Math.random().toString(36).slice(2), name: "x", phone: "9000000000", city: null, state: null,
    source: "Website", campaign: null, course_interest: null, target_year: null, mode_pref: null,
    called: false, status: "New", temperature: "Interested", demo_booked: false, demo_attended: false,
    webinar_registered: false, webinar_attended: false, admitted: false, course: null, total_fee: null,
    amount_collected: null, pending_balance: null, follow_up_date: null, counsellor: null,
    created_at: "2026-07-10T00:00:00Z", ...over,
  } as Lead);

  it("groups by campaign + channel with counts and rates", () => {
    const leads: Lead[] = [
      L({ utm_campaign: "webinar_july", channel: "Google Ads", webinar_registered: true, admitted: true }),
      L({ utm_campaign: "webinar_july", channel: "Google Ads", webinar_registered: true }),
      L({ utm_campaign: "webinar_july", channel: "Google Ads" }),
      L({ utm_campaign: "gs_foundation", channel: "Meta Ads", admitted: true }),
      L({ merged_into: "someone" }), // excluded
    ];
    const rep = aggregateLeadCampaigns(leads);

    const july = rep.byCampaign.find((r) => r.key === "webinar_july")!;
    assert.equal(july.leads, 3);
    assert.equal(july.webinarRegs, 2);
    assert.equal(july.signups, 1);
    assert.equal(july.webinarRate, 0.667);
    assert.equal(july.signupRate, 0.333);
    assert.equal(july.channel, "Google Ads");

    // totals exclude the merged lead
    assert.equal(rep.totals.leads, 4);
    assert.equal(rep.totals.signups, 2);

    // channel breakdown present
    assert.ok(rep.byChannel.find((r) => r.key === "Google Ads"));
    assert.ok(rep.byChannel.find((r) => r.key === "Meta Ads"));

    // sorted by leads desc → webinar_july first
    assert.equal(rep.byCampaign[0].key, "webinar_july");
  });
});
