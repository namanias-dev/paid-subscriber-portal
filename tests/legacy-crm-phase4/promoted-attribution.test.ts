/**
 * PHASE 4f — attribution has to survive promotion.
 *
 * The path being defended: a legacy lead is promoted, works through the live
 * pipeline, enrols, pays — and months later the Payments page renders a source
 * pill for that payment. The pill resolves from the PRESERVED
 * `first_touch` / `campaign_clean`, because promotion never rewrote them.
 *
 * Two ways this breaks, both silent, both tested here.
 *
 * The first is the one the design invites. A promoted lead is `is_legacy = true`
 * AND promoted, and the read path that feeds the pill map filters on
 * `is_legacy = false`. So the promoted lead falls out of the map entirely and
 * its payment renders no pill at all — which looks like a front-end bug and
 * gets chased there.
 *
 * The second is the opposite mistake: fixing the first by letting promoted
 * leads count toward aggregate channel totals. Those totals are historical
 * live-capture figures that have to stay byte-identical. Cohort is a dimension,
 * never a silent blend.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildLeadAttrByPhone, pruneEmptyChannels } from "../../lib/marketing/leadAttrByPhone";
import { derivedChannelFor } from "../../lib/webinarSource";
import type { Payment } from "../../lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const lead = (over: Record<string, unknown>) => ({
  id: "L", phone: "9876543210", channel: null, utm_campaign: null, utm_source: null,
  campaign_clean: null, source: null, is_legacy: false, attribution: null,
  ...over,
}) as any;

const payment = (phone: string) => ({ phone, amount: 1000 }) as unknown as Payment;

describe("Phase 4f — a promoted lead still resolves its source pill", () => {
  it("keeps its preserved first-touch attribution", () => {
    const promoted = lead({
      id: "PROMOTED",
      is_legacy: true,
      promoted_at: "2026-07-25T00:00:00.000Z",
      channel: "Offline",
      campaign_clean: "UPSC Foundation 2023",
      attribution: {
        legacy: true,
        first_touch: { channel: "Offline", campaign: "UPSC Foundation 2023" },
      },
    });

    const map = buildLeadAttrByPhone([promoted]);
    const entry = map["9876543210"];
    assert.ok(entry, "a promoted lead must appear in the pill map at all");
    assert.equal(entry.channel, "Offline", "resolved from the PRESERVED first touch");
    assert.equal(entry.legacy, true, "provenance is carried into the map");
  });

  it("survives pruning, so the pill actually renders", () => {
    const promoted = lead({
      is_legacy: true, promoted_at: "2026-07-25T00:00:00.000Z",
      channel: "Offline", campaign_clean: "UPSC Foundation 2023",
    });
    const pruned = pruneEmptyChannels(buildLeadAttrByPhone([promoted]));
    assert.ok(pruned["9876543210"], "pruning must not drop a lead that can render a pill");
  });

  it("does NOT count toward aggregate channel totals", () => {
    // `legacy === true` short-circuits to Unknown. That is what keeps the
    // historical live-capture channel counts byte-identical whether or not
    // anyone has been promoted.
    const promoted = lead({
      is_legacy: true, promoted_at: "2026-07-25T00:00:00.000Z", channel: "Offline",
    });
    const map = buildLeadAttrByPhone([promoted]);
    assert.equal(
      derivedChannelFor(payment("9876543210"), map), "Unknown",
      "promoting someone must not move a historical channel total",
    );
  });

  it("promoting nobody and promoting everybody give identical aggregate counts", () => {
    const live = lead({ id: "LIVE", phone: "9000000001", channel: "Google Ads" });
    const legacyUnpromoted = lead({ id: "LEG", phone: "9000000002", is_legacy: true, channel: "Offline" });
    const legacyPromoted = lead({
      ...legacyUnpromoted, id: "LEG", promoted_at: "2026-07-25T00:00:00.000Z",
    });

    const before = buildLeadAttrByPhone([live, legacyUnpromoted]);
    const after = buildLeadAttrByPhone([live, legacyPromoted]);

    for (const phone of ["9000000001", "9000000002"]) {
      assert.equal(
        derivedChannelFor(payment(phone), before),
        derivedChannelFor(payment(phone), after),
        `channel bucket for ${phone} moved because a lead was promoted`,
      );
    }
    assert.equal(derivedChannelFor(payment("9000000001"), after), "Google Ads");
    assert.equal(derivedChannelFor(payment("9000000002"), after), "Unknown");
  });
});

describe("Phase 4f — multi-match phones resolve deterministically", () => {
  const live = lead({ id: "LIVE", channel: "Google Ads" });
  const promoted = lead({
    id: "PROMOTED", is_legacy: true, promoted_at: "2026-07-25T00:00:00.000Z", channel: "Offline",
  });

  it("prefers the live lead regardless of input order", () => {
    for (const order of [[live, promoted], [promoted, live]]) {
      const map = buildLeadAttrByPhone(order);
      assert.equal(
        map["9876543210"]!.legacy, false,
        "the live lead must win — order of rows from the database is not guaranteed",
      );
      assert.equal(map["9876543210"]!.channel, "Google Ads");
    }
  });

  it("never throws on a malformed or missing phone", () => {
    const rows = [
      lead({ id: "A", phone: null }),
      lead({ id: "B", phone: "" }),
      lead({ id: "C", phone: "not a phone" }),
      lead({ id: "D", phone: "+91 98765 43210", channel: "Meta Ads" }),
    ];
    assert.doesNotThrow(() => buildLeadAttrByPhone(rows));
    const map = buildLeadAttrByPhone(rows);
    assert.equal(map["9876543210"]!.channel, "Meta Ads", "formatting variants still normalize");
    assert.equal(derivedChannelFor(payment("9999999999"), map), "Unknown", "no match is Unknown, not a throw");
  });
});

describe("Phase 4f — the read path includes promoted leads", () => {
  it("getLeadsForPillMap has an arm for them", () => {
    // Structural: arm (a) filters is_legacy=false and arm (b) requires a
    // channel, which imported sheet rows generally lack. Without a third arm a
    // promoted lead is simply absent from the map.
    const src = require("node:fs").readFileSync(
      require("node:path").join(import.meta.dirname, "..", "..", "lib", "dataProvider.ts"),
      "utf8",
    ) as string;
    const fn = src.slice(
      src.indexOf("export async function getLeadsForPillMap"),
      src.indexOf("export async function getAllLeadsRaw"),
    );
    assert.ok(
      /\.not\("promoted_at",\s*"is",\s*null\)/.test(fn),
      "getLeadsForPillMap must select promoted legacy leads explicitly",
    );
    assert.ok(
      /seen|Set</.test(fn),
      "arms (b) and (c) overlap on a promoted lead with a channel; dedupe required",
    );
  });
});
