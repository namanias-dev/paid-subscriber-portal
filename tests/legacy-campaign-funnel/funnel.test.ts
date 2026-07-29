import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  assertFunnelReconciles,
  campaignLabel,
  collapseLongTail,
  enrichFunnelRow,
  exclusiveSum,
  formatPct,
  legacyWorklistCampaignHref,
  mapRpcRows,
  NO_CAMPAIGN_LABEL,
  sortFunnelRows,
  sumFunnelRows,
} from "../../lib/marketing/legacyCampaignFunnel";

describe("stage enrichment + reconciliation", () => {
  test("exclusive tiers sum to matched; cumulative nest holds", () => {
    const row = enrichFunnelRow({
      campaign: "INDIA-NCERT Batch",
      matched: 6,
      webinarReg: 0,
      seatCum: 5,
      paidCum: 4,
      exclNoSeat: 1,
      exclSeatOnly: 1,
      exclPaid: 4,
    });
    assert.equal(exclusiveSum(row), 6);
    assert.equal(assertFunnelReconciles(row), true);
    assert.equal(row.seatRate, 5 / 6);
    assert.equal(row.paidGivenSeatRate, 4 / 5);
    assert.equal(row.paidRate, 4 / 6);
  });

  test("blank campaign gets explicit label", () => {
    assert.equal(campaignLabel(""), NO_CAMPAIGN_LABEL);
    assert.equal(campaignLabel("  "), NO_CAMPAIGN_LABEL);
    assert.equal(campaignLabel("Sheet1"), "Sheet1");
  });

  test("empty dataset reconciles", () => {
    const totals = sumFunnelRows([]);
    assert.equal(totals.matched, 0);
    assert.equal(assertFunnelReconciles(totals), true);
    assert.equal(formatPct(totals.paidRate), "—");
  });

  test("low-sample flag when matched < 5", () => {
    const row = enrichFunnelRow({
      campaign: "Tiny",
      matched: 2,
      webinarReg: 0,
      seatCum: 1,
      paidCum: 1,
      exclNoSeat: 1,
      exclSeatOnly: 0,
      exclPaid: 1,
    });
    assert.equal(row.lowSample, true);
  });
});

describe("mapRpcRows + sort + long tail", () => {
  test("maps RPC snake_case and totals reconcile", () => {
    const rows = mapRpcRows([
      {
        campaign: "A",
        matched: 10,
        webinar_reg: 2,
        seat_cum: 8,
        paid_cum: 8,
        excl_no_seat: 2,
        excl_seat_only: 0,
        excl_paid: 8,
      },
      {
        campaign: "B",
        matched: 3,
        webinar_reg: 0,
        seat_cum: 2,
        paid_cum: 1,
        excl_no_seat: 1,
        excl_seat_only: 1,
        excl_paid: 1,
      },
    ]);
    assert.equal(rows[0].webinarReg, 2);
    const totals = sumFunnelRows(rows);
    assert.equal(totals.matched, 13);
    assert.equal(assertFunnelReconciles(totals), true);
  });

  test("sort by paid_rate prefers conversion over volume", () => {
    const rows = mapRpcRows([
      {
        campaign: "Volume",
        matched: 40,
        webinar_reg: 0,
        seat_cum: 20,
        paid_cum: 15,
        excl_no_seat: 20,
        excl_seat_only: 5,
        excl_paid: 15,
      },
      {
        campaign: "Convert",
        matched: 10,
        webinar_reg: 0,
        seat_cum: 8,
        paid_cum: 8,
        excl_no_seat: 2,
        excl_seat_only: 0,
        excl_paid: 8,
      },
    ]);
    const byPaid = sortFunnelRows(rows, "paid");
    assert.equal(byPaid[0].campaign, "Volume");
    const byRate = sortFunnelRows(rows, "paid_rate");
    assert.equal(byRate[0].campaign, "Convert");
  });

  test("long tail collapses into Other without breaking exclusive sum", () => {
    const rows = mapRpcRows(
      Array.from({ length: 12 }, (_, i) => ({
        campaign: `C${i}`,
        matched: 1,
        webinar_reg: 0,
        seat_cum: i % 2,
        paid_cum: i % 2,
        excl_no_seat: i % 2 ? 0 : 1,
        excl_seat_only: 0,
        excl_paid: i % 2,
      })),
    );
    const { head, other, hidden } = collapseLongTail(rows, 5);
    assert.equal(head.length, 5);
    assert.ok(other);
    assert.equal(hidden.length, 7);
    assert.equal(assertFunnelReconciles(other!), true);
    assert.equal(other!.matched, 7);
  });
});

describe("worklist href", () => {
  test("opens legacy scope with campaign search", () => {
    const href = legacyWorklistCampaignHref("INDIA-NCERT Batch");
    assert.ok(href.includes("scope=legacy"));
    assert.ok(href.includes("search=INDIA-NCERT"));
  });
});
