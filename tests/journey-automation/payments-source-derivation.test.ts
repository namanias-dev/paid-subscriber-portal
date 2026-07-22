/**
 * PAYMENTS & FINANCE UI v2 — source derivation + definitions + filter URL round-trip.
 *
 * Covers the three test buckets called out in the shipment spec:
 *   (a) `derivedChannelFor(payment, leadAttrByPhone)` — the helper the source
 *       card + the new Source filter share. Phone matching is last-10-digit
 *       tolerant; missing lead → "Unknown" (never fabricated).
 *   (b) `SOURCE_DEFINITIONS` coverage — every derived channel value produced by
 *       `deriveChannel` PLUS the honest "Unknown" fallback has a plain-English
 *       definition. Iterating `MARKETING_CHANNELS` catches the "someone adds
 *       a new channel and forgets the definition" regression.
 *   (c) `Source` filter state → URL round-trip via encode/decode. Sorted +
 *       case-insensitive; unknown slugs drop silently so a bookmarked URL for
 *       an old channel name never breaks the page.
 *
 * Simulation-only (no DB, no SMS, no send path). Pure functions only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { derivedChannelFor, bucketizeSources, type DerivedChannelAttr } from "../../lib/webinarSource";
import {
  SOURCE_DEFINITIONS,
  SOURCE_DISPLAY_ORDER,
  UNKNOWN_SOURCE,
  sourceDefinition,
  type SourceDisplayKey,
} from "../../lib/marketing/sourceDefinitions";
import {
  decodeSourceFilter,
  encodeSourceFilter,
  displayToSlug,
} from "../../components/admin/payments/SourceFilter";
import { MARKETING_CHANNELS } from "../../lib/attribution";
import type { Payment } from "../../lib/types";

/** Minimal Payment factory — only the fields the source-card path actually reads. */
function mkPayment(over: Partial<Payment> = {}): Payment {
  return {
    id: over.id ?? "p1",
    reference_no: over.reference_no ?? "REF1",
    razorpay_payment_id: over.razorpay_payment_id ?? null,
    amount: over.amount ?? 100,
    status: over.status ?? "captured",
    student_name: over.student_name ?? "Test Student",
    phone: over.phone ?? "+91 98765 43210",
    item: over.item ?? "UPSC July 25 Masterclass",
    item_type: over.item_type ?? "webinar",
    item_slug: over.item_slug ?? "upsc-full-masterclass-by-naman-sir-july-25",
    payment_kind: over.payment_kind ?? null,
    installment_no: over.installment_no ?? null,
    gateway: over.gateway ?? null,
    mode: over.mode ?? null,
    settlement_status: over.settlement_status ?? null,
    is_superseded: over.is_superseded ?? false,
    verify_status: over.verify_status ?? null,
    last_verify_at: over.last_verify_at ?? null,
    created_at: over.created_at ?? "2026-07-21T10:00:00Z",
    attribution_source: over.attribution_source ?? null,
    // Rest are optional/nullable per lib/types.ts — spread anything left.
    ...over,
  } as Payment;
}

// -----------------------------------------------------------------------------
// (a) derivedChannelFor — the helper the source card + Source filter share.
// -----------------------------------------------------------------------------

describe("(a) derivedChannelFor — payment × leadAttrByPhone → derived CRM channel", () => {
  it("returns the exact lead channel string for a matching phone (last-10 loose)", () => {
    const byPhone: Record<string, DerivedChannelAttr> = {
      "9876543210": { channel: "Meta Ads" },
    };
    // Payment phone has +91 + spaces; helper strips non-digits and takes last-10.
    const ch = derivedChannelFor(mkPayment({ phone: "+91 98765 43210" }), byPhone);
    assert.equal(ch, "Meta Ads");
  });

  it("returns Unknown when no lead exists for that normalized phone", () => {
    const byPhone: Record<string, DerivedChannelAttr> = {
      "1111111111": { channel: "Google Ads" },
    };
    const ch = derivedChannelFor(mkPayment({ phone: "9999999999" }), byPhone);
    assert.equal(ch, UNKNOWN_SOURCE);
  });

  it("returns Unknown when the matching lead's channel is null/empty (never fabricates)", () => {
    const byPhone: Record<string, DerivedChannelAttr> = {
      "9876543210": { channel: null },
    };
    const ch = derivedChannelFor(mkPayment({ phone: "9876543210" }), byPhone);
    assert.equal(ch, UNKNOWN_SOURCE);
  });

  it("returns Unknown when the leadAttr map is undefined (v2 flag off case)", () => {
    const ch = derivedChannelFor(mkPayment({ phone: "9876543210" }), undefined);
    assert.equal(ch, UNKNOWN_SOURCE);
  });

  it("returns Unknown when the payment has no phone at all", () => {
    const byPhone: Record<string, DerivedChannelAttr> = {
      "9876543210": { channel: "Meta Ads" },
    };
    // `Payment.phone` is typed `string`, but the runtime handler must survive a
    // stored NULL — pre-fix payments rows exist without a phone. Cast to exercise
    // the null branch without weakening the shared Payment type.
    const ch = derivedChannelFor(mkPayment({ phone: null as unknown as string }), byPhone);
    assert.equal(ch, UNKNOWN_SOURCE);
  });
});

// -----------------------------------------------------------------------------
// bucketizeSources — the July 25 reconciliation the card uses.
// -----------------------------------------------------------------------------

describe("(a2) bucketizeSources — legacy vs derived paths reconcile the same total", () => {
  const always = () => true;
  // 4 paid webinar rows, all distinct phones so no dedup collision.
  const payments: Payment[] = [
    mkPayment({ id: "p1", phone: "1111111111", attribution_source: "instagram" }),
    mkPayment({ id: "p2", phone: "2222222222", attribution_source: "direct" }),
    mkPayment({ id: "p3", phone: "3333333333", attribution_source: "direct" }),
    mkPayment({ id: "p4", phone: "4444444444", attribution_source: "google" }),
  ];

  it("legacy (no map) buckets by the flat attribution_source column exactly as before", () => {
    const b = bucketizeSources(payments, "", always);
    assert.equal(b.total, 4);
    const byKey = Object.fromEntries(b.rows.map((r) => [r.key, r.count]));
    assert.equal(byKey["instagram"], 1);
    assert.equal(byKey["direct"], 2);
    assert.equal(byKey["google"], 1);
    assert.equal(byKey["unknown"], undefined);
  });

  it("derived path re-buckets via the CRM channel: paid-Meta 'direct' becomes 'Meta Ads', organic google stays Organic, unmatched → Unknown", () => {
    // Mirrors the July 25 production shape: some 'direct' rows are actually
    // Meta Ads (fbclid); 'google' with no gclid is Organic; some phones have
    // no matching lead → Unknown (honest, not fabricated).
    const byPhone: Record<string, DerivedChannelAttr> = {
      "1111111111": { channel: "Organic" },
      "2222222222": { channel: "Meta Ads" },
      "3333333333": { channel: null },
      "4444444444": { channel: "Organic" },
    };
    const b = bucketizeSources(payments, "", always, byPhone);
    assert.equal(b.total, 4, "total distinct registrations must be preserved");
    const byKey = Object.fromEntries(b.rows.map((r) => [r.key, r.count]));
    assert.equal(byKey["Organic"], 2);
    assert.equal(byKey["Meta Ads"], 1);
    assert.equal(byKey[UNKNOWN_SOURCE], 1);
    // Unknown must sort last so the marketer sees it as a residual bucket.
    assert.equal(b.rows[b.rows.length - 1].key, UNKNOWN_SOURCE);
  });
});

// -----------------------------------------------------------------------------
// (b) SOURCE_DEFINITIONS — coverage.
// -----------------------------------------------------------------------------

describe("(b) SOURCE_DEFINITIONS — every derived channel + Unknown has a definition", () => {
  it("every value in MARKETING_CHANNELS is defined in SOURCE_DEFINITIONS", () => {
    for (const ch of MARKETING_CHANNELS) {
      const def = SOURCE_DEFINITIONS[ch as SourceDisplayKey];
      assert.ok(def, `Missing SOURCE_DEFINITIONS entry for derived channel "${ch}"`);
      assert.equal(def.label, ch, `Definition label must match the channel string exactly`);
      assert.ok(def.definition.length >= 30, `Definition for "${ch}" is suspiciously short`);
      assert.match(def.color, /^#[0-9A-Fa-f]{6}$/, `Definition for "${ch}" needs a hex color`);
    }
  });

  it("the honest Unknown fallback is defined and marked as never-inferred", () => {
    const def = SOURCE_DEFINITIONS[UNKNOWN_SOURCE];
    assert.ok(def, "Unknown must have a definition");
    assert.match(def.definition, /never inferred|honestly/i, "Unknown definition must state it's never inferred");
  });

  it("SOURCE_DISPLAY_ORDER covers exactly the definition keys — no drift", () => {
    const ordered = new Set(SOURCE_DISPLAY_ORDER);
    const defined = new Set(Object.keys(SOURCE_DEFINITIONS));
    assert.equal(ordered.size, defined.size, "SOURCE_DISPLAY_ORDER and SOURCE_DEFINITIONS must have the same size");
    for (const k of defined) assert.ok(ordered.has(k as SourceDisplayKey), `SOURCE_DISPLAY_ORDER missing "${k}"`);
  });

  it("sourceDefinition(unknown|missing|empty) falls back to Unknown (never throws)", () => {
    assert.equal(sourceDefinition(null).label, UNKNOWN_SOURCE);
    assert.equal(sourceDefinition("").label, UNKNOWN_SOURCE);
    assert.equal(sourceDefinition("nonexistent").label, UNKNOWN_SOURCE);
  });
});

// -----------------------------------------------------------------------------
// (c) Source filter — URL round-trip.
// -----------------------------------------------------------------------------

describe("(c) Source filter — URL round-trip (encode/decode)", () => {
  it("empty set encodes to empty string (parent drops the query param entirely)", () => {
    assert.equal(encodeSourceFilter(new Set()), "");
    assert.equal(decodeSourceFilter("").size, 0);
    assert.equal(decodeSourceFilter(null).size, 0);
    assert.equal(decodeSourceFilter(undefined).size, 0);
  });

  it("single-value round-trip preserves the exact SourceDisplayKey", () => {
    const set = new Set<SourceDisplayKey>(["Meta Ads"]);
    const enc = encodeSourceFilter(set);
    assert.equal(enc, "meta_ads");
    const dec = decodeSourceFilter(enc);
    assert.equal(dec.size, 1);
    assert.ok(dec.has("Meta Ads"));
  });

  it("multi-value round-trip is stable + sorted (deterministic URLs)", () => {
    const set = new Set<SourceDisplayKey>(["Meta Ads", "Google Ads", "Organic"]);
    const enc = encodeSourceFilter(set);
    // Sorted alphabetically by slug: google_ads, meta_ads, organic.
    assert.equal(enc, "google_ads,meta_ads,organic");
    const dec = decodeSourceFilter(enc);
    assert.equal(dec.size, 3);
    for (const k of ["Meta Ads", "Google Ads", "Organic"] as SourceDisplayKey[]) {
      assert.ok(dec.has(k), `Round-trip lost "${k}"`);
    }
  });

  it("unknown slugs drop silently (backward compat for old bookmarked URLs)", () => {
    const dec = decodeSourceFilter("meta_ads,old_channel_name,google_ads");
    assert.equal(dec.size, 2);
    assert.ok(dec.has("Meta Ads"));
    assert.ok(dec.has("Google Ads"));
  });

  it("case-insensitive decode (URL may arrive with mixed case)", () => {
    const dec = decodeSourceFilter("META_ADS,Organic");
    assert.equal(dec.size, 2);
    assert.ok(dec.has("Meta Ads"));
    assert.ok(dec.has("Organic"));
  });

  it("displayToSlug is stable and reversible for every defined key", () => {
    for (const k of SOURCE_DISPLAY_ORDER) {
      const dec = decodeSourceFilter(displayToSlug(k));
      assert.ok(dec.has(k), `displayToSlug("${k}") did not round-trip through decodeSourceFilter`);
    }
  });
});
