import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCESS_BLOCKED_TEMPLATE_ID,
  ACCESS_EXPIRING_TEMPLATE_ID,
  ACCESS_AUTOMATION_DEFAULTS,
} from "../../lib/sms/accessReminderConstants";
import { accessInQuietHours, templateBreakdown } from "../../lib/sms/accessBulkGuards";
import { pickAccessTemplate } from "../../lib/sms/accessReminderService";
import { retryTargetsAreDisjoint, resolveRetryTargets } from "../../lib/sms/retryTargets";

const root = join(process.cwd());

describe("access bulk template truth", () => {
  test("amnesty / grant holder with schedule blocked gets Expiring, never Blocked", () => {
    const pick = pickAccessTemplate({
      scheduleAccess: { allowed: false, status: "blocked", reason: "overdue", graceEndsAt: "2026-07-01T00:00:00.000Z" },
      override: {
        id: "o1", phone: "9999999999", course_id: "c1", mode: "grant",
        expires_at: "2026-08-05T00:00:00.000Z", note: "amnesty", created_by: "System · amnesty",
        created_at: "", updated_at: "",
      },
      totalRemaining: 10000,
      now: Date.parse("2026-07-29T05:00:00.000Z"),
    });
    assert.ok(!("block" in pick));
    if ("block" in pick) return;
    assert.equal(pick.templateId, ACCESS_EXPIRING_TEMPLATE_ID);
    assert.equal(pick.daysSource, "override");
  });

  test("genuinely blocked without grant gets Blocked", () => {
    const pick = pickAccessTemplate({
      scheduleAccess: { allowed: false, status: "blocked", reason: "overdue", graceEndsAt: "2026-07-01T00:00:00.000Z" },
      override: null,
      totalRemaining: 10000,
    });
    assert.ok(!("block" in pick));
    if ("block" in pick) return;
    assert.equal(pick.templateId, ACCESS_BLOCKED_TEMPLATE_ID);
  });

  test("grace without grant gets Expiring", () => {
    const pick = pickAccessTemplate({
      scheduleAccess: { allowed: true, status: "grace", reason: "grace", graceEndsAt: "2026-08-01T00:00:00.000Z" },
      override: null,
      totalRemaining: 5000,
    });
    assert.ok(!("block" in pick));
    if ("block" in pick) return;
    assert.equal(pick.templateId, ACCESS_EXPIRING_TEMPLATE_ID);
    assert.equal(pick.daysSource, "grace");
  });
});

describe("access bulk guards helpers", () => {
  test("templateBreakdown counts sendable only", () => {
    const b = templateBreakdown([
      { sendable: true, templateId: ACCESS_EXPIRING_TEMPLATE_ID },
      { sendable: true, templateId: ACCESS_BLOCKED_TEMPLATE_ID },
      { sendable: false, templateId: ACCESS_BLOCKED_TEMPLATE_ID },
      { sendable: true, templateId: ACCESS_EXPIRING_TEMPLATE_ID },
    ]);
    assert.deepEqual(b, { expiring: 2, blocked: 1 });
  });

  test("quiet hours: 07 IST is quiet, 10 IST is not", () => {
    // 2026-07-29 07:00 IST = 2026-07-29 01:30 UTC
    assert.equal(accessInQuietHours(Date.parse("2026-07-29T01:30:00.000Z")), true);
    // 2026-07-29 10:00 IST = 2026-07-29 04:30 UTC
    assert.equal(accessInQuietHours(Date.parse("2026-07-29T04:30:00.000Z")), false);
  });

  test("defaults still safe for ship constants (DB overrides live settings)", () => {
    assert.equal(ACCESS_AUTOMATION_DEFAULTS.killSwitch, false);
    assert.equal(ACCESS_AUTOMATION_DEFAULTS.dryRun, true);
    assert.equal(ACCESS_AUTOMATION_DEFAULTS.enabled, false);
  });
});

describe("access bulk retry wiring (source)", () => {
  test("route uses retryOf + resolveRetryTargets like Payment At Risk", () => {
    const route = readFileSync(join(root, "app/api/admin/sms/access-reminder/bulk/route.ts"), "utf8");
    assert.match(route, /retryOf && clientIds\.length/);
    assert.match(route, /resolveRetryTargets/);
    assert.match(route, /retryTargetsAreDisjoint/);
    assert.match(route, /listLogsByCampaign\(jobId\)/);
  });

  test("client posts retryOf for retry-failed-only", () => {
    const ui = readFileSync(join(root, "components/admin/sms/BulkAccessReminder.tsx"), "utf8");
    assert.match(ui, /retryOf:\s*outcome!\.jobId/);
    assert.doesNotMatch(ui, /enrollmentIds: sendableRows\.map.*"retry"/s);
  });

  test("retry target invariant holds", () => {
    const t = resolveRetryTargets([
      { status: "FAILED", template_id: ACCESS_EXPIRING_TEMPLATE_ID, course_enrollment_id: "a", created_at: "2026-07-29T00:00:00Z" },
      { status: "SENT", template_id: ACCESS_EXPIRING_TEMPLATE_ID, course_enrollment_id: "b", created_at: "2026-07-29T00:00:00Z" },
    ]);
    assert.deepEqual(t.enrollmentIds, ["a"]);
    assert.ok(retryTargetsAreDisjoint(t));
  });
});

describe("access risk page selection (source)", () => {
  test("select-all uses useSelectableRows and disables non-remindEnabled checkboxes", () => {
    const page = readFileSync(join(root, "app/admin/access-risk/page.tsx"), "utf8");
    assert.match(page, /useSelectableRows/);
    assert.match(page, /disabled=\{!selectable\}/);
    assert.match(page, /r\.remindEnabled/);
    // needs_call: bulk unselectable, single Remind stays available
    assert.match(page, /!r\.remindEnabled && !r\.needsCall/);
  });

  test("kill switch disables sticky send", () => {
    const ui = readFileSync(join(root, "components/admin/sms/BulkAccessReminder.tsx"), "utf8");
    assert.match(ui, /killSwitch/);
    assert.match(ui, /Kill switch is ON/);
  });
});
