/**
 * REGRESSION SUITE for the payment-source-restore fix.
 *
 * See `docs/naman-ai/reports/payment-source-restore.md` for the full
 * root-cause narrative. This file pins the four contracts called out in the
 * shipment brief:
 *
 *   (a) A normal (non-legacy) payment resolves to the correct SourcePill via
 *       the shared phone map — no regression on the happy path.
 *   (b) A collision-lead payment shows its ORIGINAL non-legacy source (the
 *       real `attribution.first_touch`, materialized on the scalar `channel`
 *       column at ingestion), NEVER the appended legacy touch — even when the
 *       collision row is the ONLY row for that phone in the current
 *       includeLegacy=true universe.
 *   (c) Legacy leads are excluded from the aggregate channel counts (source
 *       card / `derivedChannelFor`) so totals stay byte-identical to the
 *       pre-shipment legacy-free numbers.
 *   (d) A newly-ingested (post-fix) lead records its source attribution
 *       scalars via `newLeadAttributionColumns`, matching the pre-legacy
 *       behavior — the ingestion path itself never regressed.
 *
 * Pure functions only — no DB, no SMS, no send path.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildLeadAttrByPhone,
  type LeadForSourceAttr,
} from "../../lib/marketing/leadAttrByPhone";
import { derivedChannelFor, type DerivedChannelAttr } from "../../lib/webinarSource";
import {
  leadAttributionFromState,
  newLeadAttributionColumns,
  type LeadAttribution,
} from "../../lib/marketing/leadAttribution";
import type { AttributionState, AttributionTouch } from "../../lib/attribution";
import type { Lead, Payment } from "../../lib/types";

// -----------------------------------------------------------------------------
// Test doubles — masked, no PII.
// -----------------------------------------------------------------------------

/**
 * Build a masked lead fixture. Phones are 10-digit but populated with obvious
 * dummy prefixes so no real PII sneaks into the suite. Only the fields the
 * source-attr map builder reads are set.
 */
function mkLead(over: Partial<Lead> & { phone: string }): Lead {
  return {
    id: over.id ?? "lead-" + over.phone,
    name: over.name ?? "Test",
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
    created_at: over.created_at ?? "2026-07-01T00:00:00Z",
    sources: [],
    first_source: null,
    first_campaign: null,
    merged_count: 0,
    channel: over.channel ?? null,
    utm_campaign: over.utm_campaign ?? null,
    utm_source: over.utm_source ?? null,
    attribution: over.attribution ?? null,
  } as Lead;
}

function mkPayment(over: Partial<Payment> & { phone: string }): Payment {
  const base: Payment = {
    id: over.id ?? "pay-" + over.phone,
    reference_no: "REF",
    razorpay_payment_id: null,
    amount: 100,
    status: over.status ?? "captured",
    student_name: "Test",
    phone: over.phone,
    item: "UPSC Masterclass",
    item_type: over.item_type ?? "webinar",
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
  return { ...base, ...over };
}

// -----------------------------------------------------------------------------
// (a) Normal payment → correct SourcePill via the map.
// -----------------------------------------------------------------------------

describe("(a) normal payment resolves the correct SourcePill", () => {
  it("a plain non-legacy lead with a real Google Ads channel populates the map with legacy=false and the same channel string", () => {
    const lead = mkLead({
      phone: "5000000001",
      channel: "Google Ads",
      utm_campaign: "brand-test",
      utm_source: "google",
      attribution: { first_touch: { tab: "google", winner: true } } as unknown as Lead["attribution"],
    });
    const map = buildLeadAttrByPhone([lead]);
    assert.deepEqual(map["5000000001"], {
      channel: "Google Ads",
      utm_campaign: "brand-test",
      utm_source: "google",
      legacy: false,
    });
    // Payment for the same phone → source card buckets to the real channel.
    const payment = mkPayment({ phone: "+91 5000 000 001" });
    assert.equal(derivedChannelFor(payment, map), "Google Ads");
  });

  it("phone-normalization is last-10 tolerant on BOTH sides (payment phone with +91 prefix matches raw-10 lead phone)", () => {
    const lead = mkLead({ phone: "5000000002", channel: "Meta Ads" });
    const map = buildLeadAttrByPhone([lead]);
    const payment = mkPayment({ phone: "+91 50000 00002" });
    assert.equal(derivedChannelFor(payment, map), "Meta Ads");
  });

  it("a phone without any lead match resolves to Unknown (honest, never fabricated)", () => {
    const map = buildLeadAttrByPhone([mkLead({ phone: "5000000003", channel: "Organic" })]);
    const payment = mkPayment({ phone: "9999999999" });
    assert.equal(derivedChannelFor(payment, map), "Unknown");
  });
});

// -----------------------------------------------------------------------------
// (b) Collision-lead payment shows its ORIGINAL non-legacy source (G2).
// -----------------------------------------------------------------------------

describe("(b) collision-lead payment shows its ORIGINAL non-legacy source", () => {
  it("when both a NON-LEGACY and a LEGACY lead exist for the same phone, non-legacy wins regardless of iteration order (input order preserved)", () => {
    // Live lead came first (real first_touch=Meta Ads); legacy insert came
    // later and appended `legacy_touches[]`. The scalar `channel` on the live
    // row is the real first-touch — that's what should be surfaced.
    const live = mkLead({
      phone: "5000000010",
      channel: "Meta Ads",
      utm_campaign: "aug-webinar",
      attribution: {
        first_touch: { tab: "meta", winner: true },
        legacy_touches: [{ tab: "FB LEADS", winner: true }],
      } as unknown as Lead["attribution"],
    });
    const legacyDup = mkLead({
      phone: "5000000010",
      channel: null,
      attribution: { legacy: true, legacy_source_tab: "FB LEADS" } as unknown as Lead["attribution"],
    });
    // Try BOTH orders so the preference is order-independent.
    const map1 = buildLeadAttrByPhone([live, legacyDup]);
    assert.deepEqual(map1["5000000010"], {
      channel: "Meta Ads",
      utm_campaign: "aug-webinar",
      utm_source: null,
      legacy: false,
    });
    const map2 = buildLeadAttrByPhone([legacyDup, live]);
    assert.deepEqual(map2["5000000010"], {
      channel: "Meta Ads",
      utm_campaign: "aug-webinar",
      utm_source: null,
      legacy: false,
    });
  });

  it("a post-fix collision row (import_source=legacy_sheet, NO attribution.legacy=true) is treated as non-legacy — its real channel WINS the map even when it's the only row", () => {
    // c59c6ab9 fix: mergeCollisionAttribution never sets legacy:true, only
    // appends to legacy_touches[]. The scalar `channel` is the preserved
    // real first-touch. This row is NOT flagged legacy by hasLegacyFlag().
    const collision = mkLead({
      phone: "5000000011",
      channel: "Meta Ads",
      attribution: {
        first_touch: { tab: "meta", winner: true },
        legacy_touches: [{ tab: "FB LEADS", winner: true }],
      } as unknown as Lead["attribution"],
    });
    const map = buildLeadAttrByPhone([collision]);
    assert.equal(map["5000000011"].channel, "Meta Ads");
    assert.equal(map["5000000011"].legacy, false, "post-fix collision row is NOT legacy — its real channel counts");
    const payment = mkPayment({ phone: "5000000011" });
    assert.equal(derivedChannelFor(payment, map), "Meta Ads");
  });

  it("a residual BUGGY collision row (still carries attribution.legacy=true from the rolled-back batch) shows its real channel on the pill but is EXCLUDED from aggregate counts (still Unknown)", () => {
    // Small residual class: the rolled-back batch 2026-07-22T02:54:55.394Z
    // set `legacy:true` on a handful of live rows. `hasLegacyFlag` correctly
    // returns TRUE for them, so `derivedChannelFor` short-circuits them to
    // Unknown for the aggregate count — G1 stays intact. The pill still
    // renders the real channel string (display path is not gated on legacy).
    const residual = mkLead({
      phone: "5000000012",
      channel: "Meta Ads",
      attribution: { legacy: true, first_touch: { tab: "meta", winner: true } } as unknown as Lead["attribution"],
    });
    const map = buildLeadAttrByPhone([residual]);
    assert.equal(map["5000000012"].channel, "Meta Ads");
    assert.equal(map["5000000012"].legacy, true);
    const payment = mkPayment({ phone: "5000000012" });
    assert.equal(
      derivedChannelFor(payment, map),
      "Unknown",
      "residual legacy=true row must not inflate real-channel counts (G1)",
    );
  });
});

// -----------------------------------------------------------------------------
// (c) Legacy leads excluded from aggregate channel counts / source-card totals.
// -----------------------------------------------------------------------------

describe("(c) legacy leads stay OUT of aggregate channel counts (source card)", () => {
  it("pure legacy insert with a real (residual) channel populates the display map but derivedChannelFor returns Unknown", () => {
    const pureLegacy = mkLead({
      phone: "5000000020",
      channel: "Google Ads", // residual from buggy batch
      attribution: { legacy: true, legacy_source_tab: "FB LEADS" } as unknown as Lead["attribution"],
    });
    const map = buildLeadAttrByPhone([pureLegacy]);
    // Display map does have the entry (SourcePill will show the honest channel).
    assert.equal(map["5000000020"].channel, "Google Ads");
    assert.equal(map["5000000020"].legacy, true);
    // Aggregate count path drops it back to Unknown.
    const payment = mkPayment({ phone: "5000000020" });
    assert.equal(derivedChannelFor(payment, map), "Unknown");
  });

  it("pure legacy insert with NULL channel resolves to Unknown at both display and count paths (channel-null pill hides itself)", () => {
    const pureLegacy = mkLead({
      phone: "5000000021",
      channel: null,
      attribution: { legacy: true } as unknown as Lead["attribution"],
    });
    const map = buildLeadAttrByPhone([pureLegacy]);
    assert.equal(map["5000000021"].channel, null);
    // SourcePill contract: renders nothing when channel is null (see
    // components/admin/SourcePill.tsx). Simulated via the observable field.
    assert.equal(map["5000000021"].legacy, true);
    const payment = mkPayment({ phone: "5000000021" });
    assert.equal(derivedChannelFor(payment, map), "Unknown");
  });

  it("a set of 5 phones (2 live-only, 2 legacy-only, 1 collision) reconciles to expected count buckets — legacy phones stay Unknown", () => {
    const leads: LeadForSourceAttr[] = [
      mkLead({ phone: "5000000031", channel: "Meta Ads" }),
      mkLead({ phone: "5000000032", channel: "Google Ads" }),
      mkLead({
        phone: "5000000033",
        channel: "Meta Ads", // residual — legacy=true
        attribution: { legacy: true } as unknown as Lead["attribution"],
      }),
      mkLead({
        phone: "5000000034",
        channel: null,
        attribution: { legacy: true } as unknown as Lead["attribution"],
      }),
      // Collision (post-fix): appended legacy_touches, no legacy=true.
      mkLead({
        phone: "5000000035",
        channel: "Organic",
        attribution: {
          first_touch: { tab: "direct", winner: true },
          legacy_touches: [{ tab: "SEP-OCT LEADS 2024", winner: true }],
        } as unknown as Lead["attribution"],
      }),
    ];
    const map = buildLeadAttrByPhone(leads);
    const bucket = (p10: string) =>
      derivedChannelFor(mkPayment({ phone: p10 }), map as Record<string, DerivedChannelAttr>);

    assert.equal(bucket("5000000031"), "Meta Ads");
    assert.equal(bucket("5000000032"), "Google Ads");
    assert.equal(bucket("5000000033"), "Unknown"); // residual legacy — G1
    assert.equal(bucket("5000000034"), "Unknown"); // legacy null-channel
    assert.equal(bucket("5000000035"), "Organic"); // post-fix collision — G2
    assert.equal(bucket("9999999999"), "Unknown"); // no match
  });
});

// -----------------------------------------------------------------------------
// (d) Ingestion path — a newly captured lead records its source correctly.
// -----------------------------------------------------------------------------

describe("(d) ingestion path (leadAttributionFromState + newLeadAttributionColumns) records source scalars correctly", () => {
  function mkTouch(over: Partial<AttributionTouch>): AttributionTouch & { first_seen_at: string } {
    return {
      source: over.source ?? "direct",
      medium: over.medium ?? null,
      campaign: over.campaign ?? null,
      content: over.content ?? null,
      term: over.term ?? null,
      landing_path: over.landing_path ?? null,
      referrer: over.referrer ?? null,
      gclid: over.gclid ?? null,
      fbclid: over.fbclid ?? null,
      first_seen_at: "2026-07-15T00:00:00Z",
      ...over,
    };
  }

  it("Meta-ad click (fbclid) resolves to channel=Meta Ads and stores the scalar on the row", () => {
    const state: AttributionState = {
      first_touch: mkTouch({
        source: "facebook",
        medium: "cpc",
        campaign: "aug-launch",
        fbclid: "test-fbclid-1",
        landing_path: "/masterclass",
      }),
      last_touch: null,
    };
    const attr: LeadAttribution = leadAttributionFromState(state);
    assert.equal(attr.channel, "Meta Ads");
    const cols = newLeadAttributionColumns(attr);
    assert.equal(cols.channel, "Meta Ads");
    assert.equal(cols.utm_source, "facebook");
    assert.equal(cols.utm_campaign, "aug-launch");
  });

  it("Google-ad click (gclid) resolves to channel=Google Ads and stores gclid + scalars", () => {
    const state: AttributionState = {
      first_touch: mkTouch({
        source: "google",
        medium: "cpc",
        campaign: "brand-search",
        gclid: "test-gclid-1",
        landing_path: "/",
      }),
      last_touch: null,
    };
    const attr = leadAttributionFromState(state);
    assert.equal(attr.channel, "Google Ads");
    const cols = newLeadAttributionColumns(attr);
    assert.equal(cols.channel, "Google Ads");
    assert.equal(cols.gclid, "test-gclid-1");
  });

  it("newLeadAttributionColumns is additive — nulls are DROPPED, so a legacy insert (empty attribution) never writes a scalar `channel`", () => {
    const empty: LeadAttribution = {
      channel: null,
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      utm_term: null,
      gclid: null,
      landing_page_path: null,
      referrer: null,
      attribution: null,
    };
    const cols = newLeadAttributionColumns(empty);
    assert.equal(Object.keys(cols).length, 0, "empty stamp writes zero columns (never fabricates)");
  });
});
