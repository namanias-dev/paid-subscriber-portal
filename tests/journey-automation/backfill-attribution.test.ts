/**
 * Backfill for legacy mis-tagged lead attribution — pure logic tests.
 *
 * Guarantees this suite locks in:
 *   1. Never fabricates: rows with NO stored acquisition signal are proposed
 *      to stay unchanged (channel derived from an existing touch only).
 *   2. Preserves first-touch integrity: rows whose first_touch ALREADY carries
 *      an acquisition signal are not rewritten.
 *   3. Fixes the "testing11" pattern: an ambient first_touch (Referral/Direct
 *      with no click id/campaign) IS upgraded when last_touch carries gclid,
 *      fbclid, or an explicit campaign.
 *   4. Idempotent: running the recompute twice produces no further changes.
 *   5. Reversible: buildBackup captures the exact old values for every row
 *      the execute step would rewrite.
 *   6. Scope-safe: the emitted patch touches ONLY the four attribution scalars.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AttributionState } from "../../lib/attribution";
import {
  BACKFILL_SCALARS,
  buildBackup,
  computeDryRunReport,
  computeRowDiff,
  patchFromDiff,
  type LegacyLeadRow,
} from "../../lib/marketing/backfillAttribution";

// ── fixtures modeled after the ACTUAL DB rows discovered in production ──────
const NOW = "2026-07-16T15:50:17.671Z";
const EARLIER = "2026-07-16T02:03:28.764Z";

/** testing11 pattern: stale self-referral first-touch, real Google Ads last-touch. */
const rowTesting11: LegacyLeadRow = {
  id: "35d45753-2bd4-417e-888e-4fd4104ba6fc",
  phone: "8548266654",
  channel: "Referral",
  utm_source: "referral",
  utm_medium: null,
  utm_campaign: null,
  attribution: {
    first_touch: {
      source: "referral",
      medium: null, campaign: null, content: null, term: null,
      landing_path: "/", referrer: "https://www.namanias.com/", raw: "namanias.com",
      first_seen_at: EARLIER,
    },
    last_touch: {
      source: "google", medium: "cpc", campaign: "masterclass_test",
      content: null, term: null, landing_path: "/webinars/x", referrer: null,
      gclid: "test123",
      last_seen_at: NOW,
    },
  } as AttributionState,
};

/** Direct-then-ad pattern (phone 8765432354 in prod). */
const rowDirectThenAd: LegacyLeadRow = {
  id: "8a175a3a-a978-44b3-ad30-2eed527f5440",
  phone: "8765432354",
  channel: "Direct",
  utm_source: "direct",
  utm_medium: null,
  utm_campaign: null,
  attribution: {
    first_touch: {
      source: "direct", medium: null, campaign: null, content: null, term: null,
      landing_path: "/", referrer: null,
      first_seen_at: EARLIER,
    },
    last_touch: {
      source: "google", medium: "cpc", campaign: "webinar_test",
      content: null, term: null, landing_path: "/", referrer: null,
      gclid: "test123",
      last_seen_at: NOW,
    },
  } as AttributionState,
};

/** Referral both touches, no signal anywhere — MUST stay Referral. */
const rowReferralNoSignal: LegacyLeadRow = {
  id: "f5bc9fbe-5b13-40c8-9d01-11817bc14565",
  phone: "9733115530",
  channel: "Referral",
  utm_source: "referral",
  utm_medium: null,
  utm_campaign: null,
  attribution: {
    first_touch: {
      source: "referral", medium: null, campaign: null, content: null, term: null,
      landing_path: "/", referrer: "https://external.blog/",
      first_seen_at: EARLIER,
    },
    last_touch: {
      source: "referral", medium: null, campaign: null, content: null, term: null,
      landing_path: "/", referrer: "https://external.blog/",
      last_seen_at: NOW,
    },
  } as AttributionState,
};

/** Real first-touch Google Ads — MUST NOT be rewritten. */
const rowRealFirstAd: LegacyLeadRow = {
  id: "4d5429e7-fbb6-490a-996b-331cf2419a3e",
  phone: "8749998755",
  channel: "Google Ads",
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "masterclass_test",
  attribution: {
    first_touch: {
      source: "google", medium: "cpc", campaign: "masterclass_test",
      content: null, term: null, landing_path: "/webinars/x", referrer: null,
      gclid: "test-verify-1",
      first_seen_at: EARLIER,
    },
    last_touch: {
      source: "google", medium: "cpc", campaign: "masterclass_test",
      content: null, term: null, landing_path: "/webinars/x", referrer: null,
      gclid: "test-verify-1",
      last_seen_at: NOW,
    },
  } as AttributionState,
};

/** Organic Instagram — MUST stay Organic (no click id, no campaign anywhere). */
const rowOrganicInstagram: LegacyLeadRow = {
  id: "943c55c2-9029-46d3-bc23-305274c964e1",
  phone: "8493972354",
  channel: "Organic",
  utm_source: "instagram",
  utm_medium: null,
  utm_campaign: null,
  attribution: {
    first_touch: {
      source: "instagram", medium: null, campaign: null, content: null, term: null,
      landing_path: "/", referrer: "https://instagram.com/",
      first_seen_at: EARLIER,
    },
    last_touch: null,
  } as AttributionState,
};

describe("computeRowDiff — never fabricates a source", () => {
  it("no attribution JSONB → returns null (row is untouchable)", () => {
    const row: LegacyLeadRow = {
      id: "empty", phone: "9000000001",
      channel: null, utm_source: null, utm_medium: null, utm_campaign: null,
      attribution: null,
    };
    assert.equal(computeRowDiff(row), null);
  });

  it("attribution present but NO acquisition signal → proposed === current (no change)", () => {
    const d = computeRowDiff(rowReferralNoSignal);
    assert.ok(d);
    assert.equal(d!.changes, false);
    assert.equal(d!.proposed.channel, "Referral");
    assert.equal(d!.old.channel, "Referral");
  });
});

describe("computeRowDiff — first-touch integrity preserved", () => {
  it("real Google Ads first-touch is NEVER rewritten", () => {
    const d = computeRowDiff(rowRealFirstAd);
    assert.ok(d);
    assert.equal(d!.source_touch, "first_touch");
    assert.equal(d!.changes, false);
    assert.equal(d!.proposed.channel, "Google Ads");
    assert.equal(d!.proposed.utm_campaign, "masterclass_test");
  });

  it("Organic instagram first-touch (no click id, no campaign) stays Organic", () => {
    const d = computeRowDiff(rowOrganicInstagram);
    assert.ok(d);
    assert.equal(d!.changes, false);
    assert.equal(d!.proposed.channel, "Organic");
  });
});

describe("computeRowDiff — ambient first-touch upgraded by paid last-touch", () => {
  it("testing11: Referral first-touch → Google Ads (from last_touch gclid)", () => {
    const d = computeRowDiff(rowTesting11);
    assert.ok(d);
    assert.equal(d!.source_touch, "last_touch");
    assert.equal(d!.changes, true);
    assert.equal(d!.proposed.channel, "Google Ads");
    assert.equal(d!.proposed.utm_campaign, "masterclass_test");
    assert.equal(d!.proposed.utm_source, "google");
    assert.equal(d!.proposed.utm_medium, "cpc");
  });

  it("Direct first-touch → Google Ads (from last_touch gclid)", () => {
    const d = computeRowDiff(rowDirectThenAd);
    assert.ok(d);
    assert.equal(d!.source_touch, "last_touch");
    assert.equal(d!.changes, true);
    assert.equal(d!.proposed.channel, "Google Ads");
    assert.equal(d!.proposed.utm_campaign, "webinar_test");
  });
});

describe("computeRowDiff — idempotency", () => {
  it("running the recompute a second time (after applying) yields no change", () => {
    const d1 = computeRowDiff(rowTesting11);
    assert.ok(d1);
    assert.equal(d1!.changes, true);
    // Simulate applying the patch by copying proposed → row scalars.
    const rewritten: LegacyLeadRow = { ...rowTesting11, ...d1!.proposed };
    const d2 = computeRowDiff(rewritten);
    assert.ok(d2);
    assert.equal(d2!.changes, false, "second pass must be a no-op");
  });
});

describe("patchFromDiff — scope-safe", () => {
  it("emits ONLY the four backfill scalar keys", () => {
    const d = computeRowDiff(rowTesting11)!;
    const patch = patchFromDiff(d);
    for (const key of Object.keys(patch)) {
      assert.ok(
        (BACKFILL_SCALARS as readonly string[]).includes(key),
        `patch must not contain key ${key}`,
      );
    }
  });

  it("no-change diff emits an empty patch", () => {
    const d = computeRowDiff(rowRealFirstAd)!;
    assert.deepEqual(patchFromDiff(d), {});
  });
});

describe("computeDryRunReport — aggregate over the real fixture set", () => {
  const rows: LegacyLeadRow[] = [
    rowTesting11,
    rowDirectThenAd,
    rowReferralNoSignal,
    rowRealFirstAd,
    rowOrganicInstagram,
  ];

  it("would_change equals exactly the two ambient→ad-click rows", () => {
    const rep = computeDryRunReport(rows);
    assert.equal(rep.scanned_total, 5);
    assert.equal(rep.would_change, 2);
    // Both Referral(no-signal) AND Organic(instagram, no click id / campaign) fall
    // into "no_signal_stays_unchanged" — the honest denominator covers both.
    assert.equal(rep.no_signal_stays_unchanged, 2);
    assert.equal(rep.already_correct, 1); // real Google Ads first-touch
    assert.equal(rep.matches_current, 0);
    assert.equal(rep.by_proposed_channel["Google Ads"], 2);
  });

  it("does NOT propose changes to Organic or real-first Google Ads rows", () => {
    const rep = computeDryRunReport(rows);
    const changed = rep.diffs.filter((d) => d.changes).map((d) => d.id);
    assert.ok(changed.includes(rowTesting11.id));
    assert.ok(changed.includes(rowDirectThenAd.id));
    assert.ok(!changed.includes(rowRealFirstAd.id));
    assert.ok(!changed.includes(rowOrganicInstagram.id));
    assert.ok(!changed.includes(rowReferralNoSignal.id));
  });
});

describe("buildBackup — reversible & audit-worthy", () => {
  it("captures old values for exactly the rows an execute would rewrite", () => {
    const rep = computeDryRunReport([rowTesting11, rowDirectThenAd, rowRealFirstAd, rowOrganicInstagram, rowReferralNoSignal]);
    const backup = buildBackup(rep.diffs, "test-sha");
    assert.equal(backup.rows.length, 2);
    const ids = backup.rows.map((r) => r.id);
    assert.ok(ids.includes(rowTesting11.id));
    assert.ok(ids.includes(rowDirectThenAd.id));
    // Backup preserves the OLD values (rollback restores these).
    const t11 = backup.rows.find((r) => r.id === rowTesting11.id)!;
    assert.equal(t11.old.channel, "Referral");
    assert.equal(t11.old.utm_source, "referral");
    assert.equal(t11.old.utm_campaign, null);
    assert.equal(backup.master_sha, "test-sha");
  });
});
