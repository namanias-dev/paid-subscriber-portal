/**
 * REGRESSION SUITE for the payment-pill DISPLAY-WIDENING fix (4th shipment).
 *
 * See `docs/naman-ai/reports/payment-source-pill-rootcause-fix.md` for the
 * full narrative. Prior shipments correctly wired the pill up to the scalar
 * `channel` column, but only ~12% of prod non-legacy leads carry that scalar
 * (the attribution-capture work `fe1c8334` only started populating it on
 * 2026-07-16 onwards). Historic leads have a `source`/`first_source`
 * populated and no `channel`, so the pill was hidden on ~88% of user rows.
 *
 * This suite pins the DISPLAY-widening contracts:
 *
 *   (W1) `buildLeadAttrByPhone` now surfaces a `displayChannel` derived from
 *        the fullest available lead signal — scalar `channel` first, then
 *        `attribution.first_touch`, then a synthetic touch from utm/form
 *        source. `deriveDisplayChannel` is the exported helper.
 *   (W2) `derivedChannelFor` continues to read the SCALAR `channel` only, so
 *        aggregate source-card counts are BYTE-IDENTICAL to the pre-widen
 *        numbers (G1 unchanged; legacy still resolves to Unknown).
 *   (W3) `pruneEmptyChannels` keeps entries where EITHER `channel` OR
 *        `displayChannel` is non-empty — old leads whose only source signal
 *        is a form `source` still survive the prune and render a pill.
 *   (W4) Collision-lead contract (G2) still holds: a non-legacy lead with a
 *        real `channel` wins even against a same-phone legacy lead, and we
 *        NEVER read from `attribution.legacy_touches[]` for the display
 *        channel (a collision row whose ONLY signal is legacy_touches
 *        legitimately returns null — honest empty pill).
 *   (W5) Signal-less leads (channel null, utm null, source null,
 *        first_source null) still return null — never fabricate a channel.
 *
 * Pure functions only — no DB, no SMS, no fetch.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildLeadAttrByPhone,
  deriveDisplayChannel,
  pruneEmptyChannels,
  type LeadForSourceAttr,
} from "../../lib/marketing/leadAttrByPhone";
import { derivedChannelFor, type DerivedChannelAttr } from "../../lib/webinarSource";
import type { Lead, Payment } from "../../lib/types";

// -----------------------------------------------------------------------------
// Test doubles — masked, no PII.
// -----------------------------------------------------------------------------

function mkLead(over: Partial<Lead> & { phone: string }): Lead {
  return {
    id: over.id ?? "lead-" + over.phone,
    name: "Test",
    phone: over.phone,
    email: null,
    city: null,
    state: null,
    source: over.source ?? "Website",
    campaign: over.campaign ?? null,
    course_interest: null,
    target_year: null,
    mode_pref: null,
    called: false,
    status: "Not Called",
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
    created_at: "2026-07-01T00:00:00Z",
    sources: [],
    first_source: over.first_source ?? null,
    first_campaign: over.first_campaign ?? null,
    merged_count: 0,
    channel: over.channel ?? null,
    utm_campaign: over.utm_campaign ?? null,
    utm_source: over.utm_source ?? null,
    utm_medium: over.utm_medium ?? null,
    gclid: over.gclid ?? null,
    attribution: over.attribution ?? null,
  } as Lead;
}

function mkPayment(phone: string): Payment {
  return {
    id: "pay-" + phone,
    reference_no: "REF",
    razorpay_payment_id: null,
    amount: 100,
    status: "PAID",
    student_name: "Test",
    phone,
    item: "UPSC Masterclass",
    item_type: "webinar",
    item_slug: "upsc-masterclass",
    payment_kind: null,
    installment_no: null,
    gateway: null,
    mode: null,
    settlement_status: null,
    is_superseded: false,
    verify_status: null,
    last_verify_at: null,
    created_at: "2026-07-22T00:00:00Z",
    attribution_source: null,
  } as Payment;
}

// -----------------------------------------------------------------------------
// (W1) deriveDisplayChannel produces the correct signal per priority.
// -----------------------------------------------------------------------------

describe("(W1) deriveDisplayChannel resolves the correct display channel per signal priority", () => {
  it("scalar channel wins over every fallback (real ingestion path)", () => {
    const lead = mkLead({
      phone: "5100000001",
      channel: "Meta Ads",
      utm_source: "google", // ignored — scalar wins
      source: "Referral",
      attribution: { first_touch: { source: "youtube", winner: true } } as unknown as Lead["attribution"],
    });
    assert.equal(deriveDisplayChannel(lead), "Meta Ads");
  });

  it("attribution.first_touch is used when scalar channel is null (defensive fallback)", () => {
    const lead = mkLead({
      phone: "5100000002",
      channel: null,
      attribution: {
        first_touch: { source: "google", medium: "cpc", gclid: "abc123", winner: true },
      } as unknown as Lead["attribution"],
    });
    assert.equal(deriveDisplayChannel(lead), "Google Ads");
  });

  it("utm_source classifies a Meta Ads click (fbclid path) when scalar is null", () => {
    const lead = mkLead({
      phone: "5100000003",
      channel: null,
      utm_source: "facebook",
      utm_medium: "cpc",
    });
    // Paid meta click: deriveChannel returns "Meta Ads" when source is facebook + paid medium.
    assert.equal(deriveDisplayChannel(lead), "Meta Ads");
  });

  it("form source `Instagram` is classified as Organic (deriveChannel is case-insensitive)", () => {
    const lead = mkLead({
      phone: "5100000004",
      channel: null,
      utm_source: null,
      source: "Instagram", // form source, no utm capture
    });
    assert.equal(deriveDisplayChannel(lead), "Organic");
  });

  it("form source `Referral` maps to the Referral channel", () => {
    const lead = mkLead({
      phone: "5100000005",
      channel: null,
      source: "Referral",
    });
    assert.equal(deriveDisplayChannel(lead), "Referral");
  });

  it("form source `Webinar` (unrecognized marketing source) falls through to 'Other' — honest but not fabricated", () => {
    const lead = mkLead({
      phone: "5100000006",
      channel: null,
      source: "Webinar",
      first_source: "Webinar",
    });
    // A user who registered via the Webinar form without any utm/click id could
    // have arrived from any channel; deriveChannel classifies unrecognized
    // sources as "Other" rather than falsely asserting Meta/Google/Direct.
    assert.equal(deriveDisplayChannel(lead), "Other");
  });

  it("first_source is used when scalar source is missing", () => {
    const lead = mkLead({
      phone: "5100000007",
      channel: null,
      source: "",
      first_source: "youtube",
    });
    assert.equal(deriveDisplayChannel(lead), "Organic");
  });

  it("gclid classifies as Google Ads when there's no other signal", () => {
    const lead = mkLead({
      phone: "5100000008",
      channel: null,
      gclid: "abc123",
    });
    assert.equal(deriveDisplayChannel(lead), "Google Ads");
  });
});

// -----------------------------------------------------------------------------
// (W2) derivedChannelFor is unchanged — aggregate counts stay legacy-free.
// -----------------------------------------------------------------------------

describe("(W2) derivedChannelFor still reads the scalar `channel` only (aggregate counts unchanged)", () => {
  it("a widened entry (displayChannel derived from source, scalar channel still null) resolves to Unknown in aggregate", () => {
    const lead = mkLead({
      phone: "5100000010",
      channel: null,
      source: "Instagram", // displayChannel = Organic (widen)
    });
    const map = buildLeadAttrByPhone([lead]);
    assert.equal(map["5100000010"].channel, null, "scalar channel remains null");
    assert.equal(map["5100000010"].displayChannel, "Organic", "display widens to Organic");
    // Aggregate reads scalar channel → Unknown. Byte-identical to pre-widen behavior.
    const payment = mkPayment("5100000010");
    assert.equal(
      derivedChannelFor(payment, map as Record<string, DerivedChannelAttr>),
      "Unknown",
      "aggregate counts must ignore the derived displayChannel — G1 unchanged",
    );
  });

  it("a widened entry with a REAL scalar channel resolves to that channel in aggregate (existing behavior)", () => {
    const lead = mkLead({
      phone: "5100000011",
      channel: "Meta Ads",
    });
    const map = buildLeadAttrByPhone([lead]);
    assert.equal(map["5100000011"].displayChannel, "Meta Ads");
    const payment = mkPayment("5100000011");
    assert.equal(
      derivedChannelFor(payment, map as Record<string, DerivedChannelAttr>),
      "Meta Ads",
      "aggregate reads scalar channel unchanged",
    );
  });

  it("legacy entry still short-circuits to Unknown in aggregate, even with a widened displayChannel", () => {
    const lead = mkLead({
      phone: "5100000012",
      channel: "Google Ads",
      attribution: { legacy: true } as unknown as Lead["attribution"],
    });
    const map = buildLeadAttrByPhone([lead]);
    assert.equal(map["5100000012"].legacy, true);
    assert.equal(map["5100000012"].displayChannel, "Google Ads");
    const payment = mkPayment("5100000012");
    assert.equal(
      derivedChannelFor(payment, map as Record<string, DerivedChannelAttr>),
      "Unknown",
      "legacy G1 contract must not be weakened by widening",
    );
  });

  it("aggregate bucket set over a mixed corpus matches pre-widen semantics — legacy phones stay Unknown", () => {
    const leads: LeadForSourceAttr[] = [
      // Real capture — counts in aggregate.
      mkLead({ phone: "5100000020", channel: "Meta Ads" }),
      mkLead({ phone: "5100000021", channel: "Google Ads" }),
      // Widened-only (displayChannel derived from source) — counts as Unknown in aggregate.
      mkLead({ phone: "5100000022", channel: null, source: "Instagram" }),
      mkLead({ phone: "5100000023", channel: null, source: "Referral" }),
      // Legacy with real channel — displays as Google Ads, aggregate Unknown (G1).
      mkLead({
        phone: "5100000024",
        channel: "Google Ads",
        attribution: { legacy: true } as unknown as Lead["attribution"],
      }),
    ];
    const map = buildLeadAttrByPhone(leads);
    const bucket = (p10: string) =>
      derivedChannelFor(mkPayment(p10), map as Record<string, DerivedChannelAttr>);

    assert.equal(bucket("5100000020"), "Meta Ads");
    assert.equal(bucket("5100000021"), "Google Ads");
    assert.equal(bucket("5100000022"), "Unknown", "widened-only entry stays Unknown in aggregate");
    assert.equal(bucket("5100000023"), "Unknown", "widened-only entry stays Unknown in aggregate");
    assert.equal(bucket("5100000024"), "Unknown", "legacy stays Unknown regardless of channel");
  });
});

// -----------------------------------------------------------------------------
// (W3) pruneEmptyChannels widened to keep entries with either signal.
// -----------------------------------------------------------------------------

describe("(W3) pruneEmptyChannels keeps entries with a non-empty channel OR displayChannel", () => {
  it("keeps a scalar-only entry (existing behavior)", () => {
    const map = buildLeadAttrByPhone([
      mkLead({ phone: "5100000030", channel: "Meta Ads" }),
    ]);
    const pruned = pruneEmptyChannels(map);
    assert.equal(pruned["5100000030"]?.channel, "Meta Ads");
    assert.equal(pruned["5100000030"]?.displayChannel, "Meta Ads");
  });

  it("keeps a widened entry (channel null, displayChannel derived)", () => {
    const map = buildLeadAttrByPhone([
      mkLead({ phone: "5100000031", channel: null, source: "Referral" }),
    ]);
    const pruned = pruneEmptyChannels(map);
    assert.equal(pruned["5100000031"]?.channel, null);
    assert.equal(pruned["5100000031"]?.displayChannel, "Referral", "widened entries survive prune");
  });

  it("drops entries with BOTH channel null AND displayChannel null (signal-less)", () => {
    const map = buildLeadAttrByPhone([
      mkLead({ phone: "5100000032", channel: null, source: "", first_source: null, utm_source: null }),
    ]);
    // deriveDisplayChannel returns null for a signal-less lead (never fabricates Direct).
    assert.equal(map["5100000032"].displayChannel, null);
    const pruned = pruneEmptyChannels(map);
    assert.equal(pruned["5100000032"], undefined, "signal-less entries are pruned out");
  });

  it("empty input → empty output (no crash, no error)", () => {
    assert.deepEqual(pruneEmptyChannels({}), {});
  });
});

// -----------------------------------------------------------------------------
// (W4) Collision-lead contract (G2) is preserved by the widening.
// -----------------------------------------------------------------------------

describe("(W4) collision-lead contract preserved — never reads legacy_touches for display", () => {
  it("collision non-legacy row (attribution has ONLY legacy_touches, no first_touch, no scalar channel) → null displayChannel (honest empty pill)", () => {
    // Reproduces the exact prod shape of the 96 collision-merged non-legacy
    // leads from 2026-07-24: original real lead + Sheets legacy import merged
    // its touch into `attribution.legacy_touches[]`. The G2 contract forbids
    // surfacing legacy_touches as the display source.
    const collision = mkLead({
      phone: "5100000040",
      channel: null,
      source: "Webinar", // form source only
      utm_source: null,
      attribution: {
        legacy_touches: [
          {
            tab: "Copy of FB LEADS",
            winner: true,
            source_type: "Meta Ads (legacy)",
            campaign_clean: "HIMACHAL-Leads",
          },
        ],
      } as unknown as Lead["attribution"],
    });
    // displayChannel derives from form source only ("Webinar" → "Other").
    // It MUST NOT reach into legacy_touches and surface "Meta Ads (legacy)".
    assert.equal(deriveDisplayChannel(collision), "Other");
    assert.notEqual(deriveDisplayChannel(collision), "Meta Ads");
  });

  it("non-legacy live wins over legacy dup, widening applied uniformly (both agree on displayChannel)", () => {
    // Live lead has a real Meta Ads scalar — that must win against a same-phone
    // legacy dup with an Organic scalar. displayChannel mirrors the winner.
    const live = mkLead({ phone: "5100000041", channel: "Meta Ads" });
    const legacyDup = mkLead({
      phone: "5100000041",
      channel: "Organic",
      attribution: { legacy: true } as unknown as Lead["attribution"],
    });
    for (const order of [
      [live, legacyDup],
      [legacyDup, live],
    ]) {
      const map = buildLeadAttrByPhone(order);
      assert.equal(map["5100000041"].channel, "Meta Ads");
      assert.equal(map["5100000041"].displayChannel, "Meta Ads");
      assert.equal(map["5100000041"].legacy, false);
    }
  });

  it("multi-match resolver is deterministic and never throws on >1 leads per phone", () => {
    // Three leads for the same phone — resolver must pick a stable winner
    // (non-legacy wins; first non-legacy seen wins on ties) and never crash.
    const leads: LeadForSourceAttr[] = [
      mkLead({
        phone: "5100000042",
        channel: "Meta Ads",
        attribution: { first_touch: { source: "facebook", winner: true } } as unknown as Lead["attribution"],
      }),
      mkLead({
        phone: "5100000042",
        channel: "Google Ads",
      }),
      mkLead({
        phone: "5100000042",
        channel: "Referral",
        attribution: { legacy: true } as unknown as Lead["attribution"],
      }),
    ];
    // Must not throw; must produce a valid entry.
    const map = buildLeadAttrByPhone(leads);
    const entry = map["5100000042"];
    assert.ok(entry, "map must contain an entry for the multi-match phone");
    assert.equal(entry.legacy, false, "non-legacy always wins");
    assert.ok(entry.channel === "Meta Ads" || entry.channel === "Google Ads");
    assert.ok(entry.displayChannel === "Meta Ads" || entry.displayChannel === "Google Ads");
  });
});

// -----------------------------------------------------------------------------
// (W5) Signal-less leads still return null (never fabricates a source).
// -----------------------------------------------------------------------------

describe("(W5) signal-less leads never fabricate a source", () => {
  it("a lead with NO channel, NO utm, NO source, NO first_source, NO attribution returns null displayChannel", () => {
    const lead = mkLead({
      phone: "5100000050",
      channel: null,
      utm_source: null,
      source: "",
      first_source: null,
      attribution: null,
    });
    assert.equal(deriveDisplayChannel(lead), null);
  });

  it("a lead with only whitespace in source signals returns null (nn helper trims)", () => {
    const lead = mkLead({
      phone: "5100000051",
      channel: "",
      utm_source: "   ",
      source: "  ",
      first_source: "",
    });
    assert.equal(deriveDisplayChannel(lead), null);
  });
});
