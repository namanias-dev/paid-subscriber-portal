import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aov,
  campaignCode,
  dedupePaidKeys,
  funnelKind,
  funnelSteps,
  pct,
  sumDaily,
  type RollupTotals,
} from "../../lib/marketing/funnelMath";

const zero = (): RollupTotals => ({
  clicks: 0, visitors: 0, productViews: 0, addToCartUsers: 0, addToCartEvents: 0,
  checkoutUsers: 0, registrations: 0, leads: 0, ordersCreated: 0, paidOrders: 0,
  units: 0, revenuePaise: 0, paidAdmissions: 0, paidWebinars: 0, admissionsRevenue: 0,
});

describe("campaign rollup funnel", () => {
  it("classifies notes, webinar and course destinations", () => {
    assert.equal(funnelKind("notes", "/notes/polity"), "notes");
    assert.equal(funnelKind("custom", "https://www.namanias.com/notes"), "notes");
    assert.equal(funnelKind("webinar", "/webinar/demo"), "webinar");
    assert.equal(funnelKind("course", "/courses/gs"), "course");
    assert.equal(funnelKind("landing", "/"), "general");
  });

  it("notes funnel is visitors → cart → checkout → paid, without webinar registrations", () => {
    const m = zero();
    m.visitors = 100;
    m.addToCartUsers = 20;
    m.checkoutUsers = 10;
    m.paidOrders = 4;
    m.registrations = 50;
    const labels = funnelSteps("notes", m).map((s) => s.label);
    assert.deepEqual(labels, ["Visitors", "Product views", "Added to cart", "Checkout started", "Paid orders"]);
    assert.equal(labels.includes("Registrations"), false);
  });

  it("computes notes conversion rates, revenue per visitor and AOV", () => {
    assert.equal(pct(20, 100), 20);
    assert.equal(pct(0, 0), null);
    assert.equal(aov(8000, 4), 2000);
    assert.equal(aov(0, 0), null);
    const day = zero();
    day.paidOrders = 2;
    day.revenuePaise = 500000;
    const summed = sumDaily([day, { ...day }]);
    assert.equal(summed.paidOrders, 4);
    assert.equal(summed.revenuePaise, 1000000);
    assert.equal(aov(Math.round(summed.revenuePaise / 100), summed.paidOrders), 2500);
  });

  it("keeps the first-touch campaign code when a later visit has no clid", () => {
    assert.equal(campaignCode("notes-reel", ""), "notes-reel");
    assert.equal(campaignCode("notes-reel", "other"), "notes-reel");
    assert.equal(campaignCode("", "last-only"), "last-only");
    assert.equal(campaignCode(null, null), null);
  });

  it("does not double-count a retried identical payment", () => {
    const once = dedupePaidKeys([
      { key: "999|polity|full|-1|2500", amount: 2500, at: 2 },
      { key: "999|polity|full|-1|2500", amount: 2500, at: 1 },
    ]);
    assert.equal(once.count, 1);
    assert.equal(once.revenue, 2500);
    const two = dedupePaidKeys([
      { key: "999|polity|full|-1|2500", amount: 2500, at: 1 },
      { key: "888|economy|full|-1|2500", amount: 2500, at: 1 },
    ]);
    assert.equal(two.count, 2);
    assert.equal(two.revenue, 5000);
  });

  it("webinar steps stay registration → lead → admission", () => {
    const labels = funnelSteps("webinar", zero()).map((s) => s.label);
    assert.deepEqual(labels, ["Visitors", "Registrations", "Leads", "Paid admissions"]);
    assert.equal(labels.includes("Added to cart"), false);
  });
});
