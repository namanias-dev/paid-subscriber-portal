/**
 * Stubbed gateway QA for Access At Risk bulk — ASSERT ZERO OUTBOUND.
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  ACCESS_BLOCKED_TEMPLATE_ID,
  ACCESS_EXPIRING_TEMPLATE_ID,
} from "../../lib/sms/accessReminderConstants";
import { pickAccessTemplate } from "../../lib/sms/accessReminderService";
import { templateBreakdown, accessInQuietHours } from "../../lib/sms/accessBulkGuards";

describe("ZERO outbound — stubbed bulk plan assertions", () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;

  before(() => {
    globalThis.fetch = (async (..._args: unknown[]) => {
      fetchCalls++;
      throw new Error("OUTBOUND_BLOCKED — gateway stub refused network");
    }) as typeof fetch;
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  test("mixed cohort resolves truthful templates without touching gateway", () => {
    const now = Date.parse("2026-07-29T05:00:00.000Z"); // 10:30 IST
    const blocked = pickAccessTemplate({
      scheduleAccess: { allowed: false, status: "blocked", reason: "overdue", graceEndsAt: "2026-07-10T00:00:00.000Z" },
      override: null,
      totalRemaining: 20000,
      now,
    });
    const grace = pickAccessTemplate({
      scheduleAccess: { allowed: true, status: "grace", reason: "grace", graceEndsAt: "2026-08-05T00:00:00.000Z" },
      override: null,
      totalRemaining: 10000,
      now,
    });
    const amnesty = pickAccessTemplate({
      scheduleAccess: { allowed: false, status: "blocked", reason: "overdue", graceEndsAt: "2026-07-10T00:00:00.000Z" },
      override: {
        id: "g", phone: "9", course_id: "c", mode: "grant",
        expires_at: "2026-08-05T02:00:00.000Z", note: "Legacy batch start backfill — 7-day amnesty",
        created_by: "System · amnesty", created_at: "", updated_at: "",
      },
      totalRemaining: 20000,
      now,
    });

    assert.ok(!("block" in blocked) && blocked.templateId === ACCESS_BLOCKED_TEMPLATE_ID);
    assert.ok(!("block" in grace) && grace.templateId === ACCESS_EXPIRING_TEMPLATE_ID);
    assert.ok(!("block" in amnesty) && amnesty.templateId === ACCESS_EXPIRING_TEMPLATE_ID);
    assert.notEqual(
      ("block" in amnesty) ? null : amnesty.templateId,
      ACCESS_BLOCKED_TEMPLATE_ID,
    );

    const breakdown = templateBreakdown([
      { sendable: true, templateId: ("block" in blocked) ? null : blocked.templateId },
      { sendable: true, templateId: ("block" in grace) ? null : grace.templateId },
      { sendable: true, templateId: ("block" in amnesty) ? null : amnesty.templateId },
    ]);
    assert.deepEqual(breakdown, { expiring: 2, blocked: 1 });
    assert.equal(fetchCalls, 0, "gateway must not be contacted during template plan QA");
  });

  test("quiet-hours helper is pure (no network)", () => {
    assert.equal(accessInQuietHours(Date.parse("2026-07-29T01:00:00.000Z")), true);
    assert.equal(fetchCalls, 0);
  });
});

describe("idempotency contract (source)", () => {
  test("jobId replay short-circuits before sendAccessReminderBatch", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const route = readFileSync(join(process.cwd(), "app/api/admin/sms/access-reminder/bulk/route.ts"), "utf8");
    const putStart = route.indexOf("export async function PUT");
    const putBody = route.slice(putStart);
    const replayIdx = putBody.indexOf("This job already ran");
    const sendIdx = putBody.indexOf("await sendAccessReminderBatch");
    assert.ok(replayIdx > 0 && sendIdx > replayIdx, "replay guard must run before send");
  });
});
