import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { buildCostHealthReport, REGISTERED_CRONS, registeredCronRunsPerDay } from "../../lib/cost/costHealth.ts";

const middleware = readFileSync(new URL("../../middleware.ts", import.meta.url), "utf8");
const orderQueue = readFileSync(new URL("../../components/notes/admin/OrderQueue.tsx", import.meta.url), "utf8");
const supportQueue = readFileSync(new URL("../../components/notes/admin/SupportQueue.tsx", import.meta.url), "utf8");
const ordersApi = readFileSync(new URL("../../app/api/admin/notes/orders/route.ts", import.meta.url), "utf8");
const costHealthRoute = readFileSync(new URL("../../app/api/ops/cost-health/route.ts", import.meta.url), "utf8");

describe("cost health + admin polling guards", () => {
  test("cost-health report is cheap and lists registered crons", () => {
    const report = buildCostHealthReport();
    assert.equal(report.ok, true);
    assert.equal(report.cronCount, REGISTERED_CRONS.length);
    assert.equal(report.cronRunsPerDay, registeredCronRunsPerDay());
    assert.ok(report.cronRunsPerDay >= 1600);
    assert.equal(report.densestCron.path, "/api/cron/telegram-dispatch");
    assert.match(costHealthRoute, /authorizeCron/);
    assert.match(costHealthReportSourceGuard(), /buildCostHealthReport/);
  });

  test("aggressive bots are short-circuited on Notes Store HTML", () => {
    assert.match(middleware, /pathname === "\/notes"/);
    assert.match(middleware, /"\/notes\/:path\*"/);
  });

  test("admin silent order refresh skips KPI count scans", () => {
    assert.match(orderQueue, /counts", "0"/);
    assert.match(ordersApi, /skipCounts/);
    assert.match(ordersApi, /counts"\) === "0"/);
  });

  test("support queue pauses refresh when the tab is hidden", () => {
    assert.match(supportQueue, /visibilityState !== "visible"/);
    assert.match(supportQueue, /visibilitychange/);
  });

  test("public notes catalogue is ISR and does not release offer holds while rendering", () => {
    const landing = readFileSync(new URL("../../app/(site)/notes/page.tsx", import.meta.url), "utf8");
    const subject = readFileSync(new URL("../../app/(site)/notes/[subject]/page.tsx", import.meta.url), "utf8");
    const offers = readFileSync(new URL("../../lib/store/offers.ts", import.meta.url), "utf8");
    for (const src of [landing, subject]) {
      assert.doesNotMatch(src, /force-dynamic/);
      assert.match(src, /NOTES_PUBLIC_REVALIDATE_SECONDS/);
      assert.match(src, /getPublicActiveOfferCached/);
    }
    assert.match(offers, /releaseHolds !== false/);
    assert.match(offers, /getPublicActiveOfferRead/);
    assert.match(offers, /getPublicActiveOfferCached/);
    assert.match(offers, /storePublicCacheDb/);
    assert.match(orderQueue, /REFRESH_MS = 180_000/);
  });

  test("legacy lead dump cannot return the full historical table from the list route", () => {
    const leads = readFileSync(new URL("../../app/api/admin/leads/route.ts", import.meta.url), "utf8");
    assert.match(leads, /getLeadsPaged/);
    assert.match(leads, /Math\.min\(100/);
    assert.match(leads, /includeLegacy: false/);
  });
});

function costHealthReportSourceGuard(): string {
  return readFileSync(new URL("../../lib/cost/costHealth.ts", import.meta.url), "utf8");
}
