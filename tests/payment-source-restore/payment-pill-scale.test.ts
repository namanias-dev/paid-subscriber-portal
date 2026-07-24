/**
 * REGRESSION SUITE for the payment-pill scale fix.
 *
 * See `docs/naman-ai/reports/payment-pill-deploystate-fix.md` for the full
 * root-cause narrative. The prior `a1a35519` shipment was logically correct
 * (all 4 contracts in payment-source-restore.test.ts still pass) but did not
 * survive at scale — `getLeads({ includeLegacy: true })` grew from ~1k rows
 * to ~179k rows after the legacy backfill, blowing past Vercel's serverless
 * response-body budget and silently blanking `leadAttrByPhone` on the client.
 *
 * This suite pins the two size / behavior contracts of the follow-up fix:
 *
 *   (S1) `pruneEmptyChannels` is BEHAVIORALLY a no-op for both consumers.
 *        The trimmed map produces identical output for `SourcePill` (which
 *        reads `attr.channel`) and `derivedChannelFor` (which returns
 *        `Unknown` when the entry is missing or has an empty channel).
 *
 *   (S2) `pruneEmptyChannels` is SIZE-EFFECTIVE — at prod-realistic ratios
 *        (98% of leads with no channel), the pruned map is <10% of the
 *        original. This is what keeps the JSON response under the serverless
 *        4.5 MB body budget at post-backfill scale.
 *
 * Pure functions only — no DB, no SMS, no fetch.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildLeadAttrByPhone,
  pruneEmptyChannels,
  type LeadAttrByPhoneEntry,
  type LeadForSourceAttr,
} from "../../lib/marketing/leadAttrByPhone";
import { derivedChannelFor, type DerivedChannelAttr } from "../../lib/webinarSource";
import type { Lead, Payment } from "../../lib/types";

/**
 * Signal-less by default so the prune-shrink assertion measures ONLY the
 * scalar-channel and derived-displayChannel dimensions. Individual tests
 * that need a form source or utm signal must set it explicitly.
 */
function mkLead(over: Partial<Lead> & { phone: string }): Lead {
  return {
    id: over.id ?? "lead-" + over.phone,
    name: "Test",
    phone: over.phone,
    email: null,
    city: null,
    state: null,
    source: over.source ?? "",
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
    status: "captured",
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

// ---------------------------------------------------------------------------
// (S1) pruneEmptyChannels is behaviorally a no-op for both consumers.
// ---------------------------------------------------------------------------

describe("(S1) pruneEmptyChannels is behaviorally a no-op for both consumers", () => {
  it("phones with a channel-carrying entry survive the prune with byte-identical values", () => {
    const leads: LeadForSourceAttr[] = [
      mkLead({ phone: "5000000001", channel: "Meta Ads", utm_campaign: "aug-webinar", utm_source: "meta" }),
      mkLead({ phone: "5000000002", channel: "Google Ads", utm_campaign: "brand-test" }),
      mkLead({
        phone: "5000000003",
        channel: "Organic",
        attribution: { legacy: true } as unknown as Lead["attribution"],
      }),
    ];
    const full = buildLeadAttrByPhone(leads);
    const pruned = pruneEmptyChannels(full);
    assert.equal(Object.keys(pruned).length, 3);
    // Each surviving entry is deeply equal to its full-map counterpart —
    // NOTHING else about the entry may drift when we prune.
    for (const phone of ["5000000001", "5000000002", "5000000003"]) {
      assert.deepEqual(pruned[phone], full[phone]);
    }
  });

  it("phones with null-channel or empty-channel entries are dropped from the pruned map", () => {
    const leads: LeadForSourceAttr[] = [
      // Non-legacy stub with no channel — the prior code would have kept this
      // entry (bloating the JSON). The new code drops it because SourcePill
      // renders nothing for null channels anyway and derivedChannelFor returns
      // Unknown for both "phone missing" AND "channel missing" cases.
      mkLead({ phone: "5000000010", channel: null }),
      // A pure legacy row without channel (~178k of these in prod today).
      mkLead({ phone: "5000000011", channel: null, attribution: { legacy: true } as unknown as Lead["attribution"] }),
      // An empty-string channel (defensive — real prod values are null or a real string).
      mkLead({ phone: "5000000012", channel: "" }),
      // A whitespace-only channel (also defensive; should still be pruned).
      mkLead({ phone: "5000000013", channel: "   " }),
    ];
    const full = buildLeadAttrByPhone(leads);
    // buildLeadAttrByPhone preserves nulls; entries exist in the FULL map.
    assert.equal(Object.keys(full).length, 4);
    const pruned = pruneEmptyChannels(full);
    assert.deepEqual(pruned, {}, "prune must drop every null / empty / whitespace channel entry");
  });

  it("consumer output is identical between the full map and the pruned map — SourcePill.render + derivedChannelFor.bucket", () => {
    const leads: LeadForSourceAttr[] = [
      mkLead({ phone: "5000000030", channel: "Meta Ads" }),
      mkLead({ phone: "5000000031", channel: null }), // pill hidden either way
      mkLead({
        phone: "5000000032",
        channel: "Google Ads",
        attribution: { legacy: true } as unknown as Lead["attribution"],
      }),
    ];
    const full = buildLeadAttrByPhone(leads);
    const pruned = pruneEmptyChannels(full);

    // SourcePill contract: `attr.channel` when the phone has a channel-carrying
    // entry, `null` otherwise. Both maps agree on every phone.
    const phonesToCheck = ["5000000030", "5000000031", "5000000032", "9999999999"];
    for (const p of phonesToCheck) {
      const chFull = full[p]?.channel ?? null;
      const chPruned = pruned[p]?.channel ?? null;
      assert.equal(chFull, chPruned, `SourcePill input differs for phone ${p}`);
    }

    // derivedChannelFor bucket: identical for every phone.
    for (const p of phonesToCheck) {
      const bFull = derivedChannelFor(mkPayment(p), full as Record<string, DerivedChannelAttr>);
      const bPruned = derivedChannelFor(mkPayment(p), pruned as Record<string, DerivedChannelAttr>);
      assert.equal(bFull, bPruned, `derivedChannelFor bucket differs for phone ${p}`);
    }
  });

  it("collision-preference contract (non-legacy wins) survives the prune", () => {
    // Phone has BOTH a legacy-with-channel row (which SHOULD lose) and a
    // non-legacy row (which SHOULD win). Both rows have a channel set so the
    // prune keeps whoever won `buildLeadAttrByPhone`. The winner MUST be the
    // non-legacy row per G2.
    const live = mkLead({
      phone: "5000000040",
      channel: "Meta Ads",
      attribution: { first_touch: { tab: "meta", winner: true } } as unknown as Lead["attribution"],
    });
    const legacy = mkLead({
      phone: "5000000040",
      channel: "Organic",
      attribution: { legacy: true } as unknown as Lead["attribution"],
    });
    // Try both insertion orders — result must be stable.
    for (const order of [
      [live, legacy],
      [legacy, live],
    ]) {
      const pruned = pruneEmptyChannels(buildLeadAttrByPhone(order));
      assert.equal(pruned["5000000040"].channel, "Meta Ads");
      assert.equal(pruned["5000000040"].legacy, false);
    }
  });

  it("collision case with non-legacy-null-channel + legacy-with-channel: pruned map correctly OMITS the phone", () => {
    // The G2 collision-preference rule ranks non-legacy above legacy even when
    // the non-legacy row has a null channel — so the non-legacy null wins and
    // the legacy entry never gets written. The pruned map drops that null
    // winner. The visible effect: no pill for this phone (same as the
    // full-map behavior under the deployed a1a35519 code).
    const liveNoChannel = mkLead({ phone: "5000000050", channel: null });
    const legacyWithChannel = mkLead({
      phone: "5000000050",
      channel: "Meta Ads",
      attribution: { legacy: true } as unknown as Lead["attribution"],
    });
    const full = buildLeadAttrByPhone([liveNoChannel, legacyWithChannel]);
    // The full map has an entry — with channel=null (non-legacy winner).
    assert.equal(full["5000000050"].channel, null);
    assert.equal(full["5000000050"].legacy, false);
    // Pruned drops it entirely — same visible behavior (no pill).
    const pruned = pruneEmptyChannels(full);
    assert.equal(pruned["5000000050"], undefined);
    // Both maps agree on derivedChannelFor output.
    const p = mkPayment("5000000050");
    assert.equal(derivedChannelFor(p, full as Record<string, DerivedChannelAttr>), "Unknown");
    assert.equal(derivedChannelFor(p, pruned as Record<string, DerivedChannelAttr>), "Unknown");
  });
});

// ---------------------------------------------------------------------------
// (S2) pruneEmptyChannels is size-effective at prod-realistic scale.
// ---------------------------------------------------------------------------

describe("(S2) pruneEmptyChannels shrinks the map at prod-realistic ratios", () => {
  /**
   * Prod-realistic mix as of 2026-07-24:
   *   - Non-legacy leads:                   1,310
   *      - with channel set:                  119
   *      - with channel = null:             1,191
   *   - Legacy leads:                     178,183
   *      - with channel set:                    4
   *      - with channel = null:           178,179
   *   TOTAL:                              179,493
   *   CHANNEL-CARRYING:                       123  (0.07%)
   *
   * The pruned map should therefore be <1% the size of the input under
   * prod-realistic ratios. We assert a much looser cap (<10%) to keep the
   * test robust against future capture-rate improvements.
   */
  it("with prod-realistic 98%+ null-channel leads, the pruned map is <10% of the built map", () => {
    const leads: LeadForSourceAttr[] = [];
    // 200 non-legacy channel-carrying (Meta / Google / Organic / Direct rotate).
    for (let i = 0; i < 200; i++) {
      const chan = ["Meta Ads", "Google Ads", "Organic", "Direct"][i % 4]!;
      leads.push(mkLead({ phone: "60000" + String(i).padStart(5, "0"), channel: chan }));
    }
    // 1800 non-legacy null-channel stubs.
    for (let i = 0; i < 1800; i++) {
      leads.push(mkLead({ phone: "61000" + String(i).padStart(5, "0"), channel: null }));
    }
    // 10 legacy channel-carrying (residual real capture).
    for (let i = 0; i < 10; i++) {
      leads.push(
        mkLead({
          phone: "62000" + String(i).padStart(5, "0"),
          channel: "Meta Ads",
          attribution: { legacy: true } as unknown as Lead["attribution"],
        }),
      );
    }
    // 8000 legacy null-channel (scaled-down slice of the 178k prod legacy set).
    for (let i = 0; i < 8000; i++) {
      leads.push(
        mkLead({
          phone: "63000" + String(i).padStart(5, "0"),
          channel: null,
          attribution: { legacy: true } as unknown as Lead["attribution"],
        }),
      );
    }
    const full = buildLeadAttrByPhone(leads);
    const pruned = pruneEmptyChannels(full);

    const fullSize = Object.keys(full).length;
    const prunedSize = Object.keys(pruned).length;
    // Exactly the 210 channel-carrying rows survive (200 non-legacy + 10 legacy).
    assert.equal(prunedSize, 210, `expected 210 channel-carrying entries, got ${prunedSize}`);
    assert.equal(fullSize, 10_010, `expected 10,010 total unique-phone entries, got ${fullSize}`);
    const ratio = prunedSize / fullSize;
    assert.ok(
      ratio < 0.10,
      `pruned/full ratio must be <10% at prod-realistic ratios (got ${(ratio * 100).toFixed(2)}%)`,
    );
  });

  it("empty input → empty output (no crash, no error)", () => {
    assert.deepEqual(pruneEmptyChannels({}), {});
  });

  it("all-channel-carrying input → identical output (pruning never accidentally drops a valid entry)", () => {
    const map: Record<string, LeadAttrByPhoneEntry> = {
      "5000000060": { channel: "Meta Ads", displayChannel: "Meta Ads", utm_campaign: null, utm_source: null, legacy: false },
      "5000000061": { channel: "Google Ads", displayChannel: "Google Ads", utm_campaign: "test", utm_source: "google", legacy: false },
      "5000000062": { channel: "Referral", displayChannel: "Referral", utm_campaign: null, utm_source: null, legacy: true },
    };
    assert.deepEqual(pruneEmptyChannels(map), map);
  });
});
