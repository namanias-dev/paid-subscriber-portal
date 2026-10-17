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
});

function costHealthReportSourceGuard(): string {
  return readFileSync(new URL("../../lib/cost/costHealth.ts", import.meta.url), "utf8");
}
