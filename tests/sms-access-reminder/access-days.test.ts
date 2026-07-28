import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { istHour, istWeekday, istWholeDaysUntil } from "../../lib/sms/accessDays";
import { pickAccessTemplate } from "../../lib/sms/accessReminderService";
import type { LectureAccess } from "../../lib/entitlements";
import type { CourseAccessOverride } from "../../lib/types";

describe("istWholeDaysUntil", () => {
  test("same IST calendar day → 0", () => {
    // 2026-07-28 10:00 IST = 2026-07-28 04:30 UTC
    const now = Date.parse("2026-07-28T04:30:00.000Z");
    const grace = "2026-07-28T18:29:59.000Z"; // still 28 Jul IST
    assert.equal(istWholeDaysUntil(grace, now), 0);
  });

  test("next IST calendar day → 1 (cosmetic '1 days' case)", () => {
    const now = Date.parse("2026-07-28T04:30:00.000Z");
    const grace = "2026-07-29T06:30:00.000Z"; // 29 Jul IST
    assert.equal(istWholeDaysUntil(grace, now), 1);
  });

  test("past grace → negative", () => {
    const now = Date.parse("2026-07-30T04:30:00.000Z");
    const grace = "2026-07-28T06:30:00.000Z";
    assert.ok((istWholeDaysUntil(grace, now) ?? 0) < 0);
  });

  test("11:55 PM IST stays on the same weekday as midnight+5m would not", () => {
    // 2026-07-28 23:55 IST = 2026-07-28 18:25 UTC
    const late = Date.parse("2026-07-28T18:25:00.000Z");
    assert.equal(istWeekday(late), 2); // Tuesday
    // 2026-07-29 00:05 IST = 2026-07-28 18:35 UTC
    const early = Date.parse("2026-07-28T18:35:00.000Z");
    assert.equal(istWeekday(early), 3); // Wednesday
  });

  test("quiet-hours boundary hours", () => {
    // 8:59 IST → hour 8; 9:00 IST → hour 9; 20:00 IST → hour 20
    assert.equal(istHour(Date.parse("2026-07-28T03:29:00.000Z")), 8);
    assert.equal(istHour(Date.parse("2026-07-28T03:30:00.000Z")), 9);
    assert.equal(istHour(Date.parse("2026-07-28T14:30:00.000Z")), 20);
  });
});

describe("pickAccessTemplate", () => {
  const blocked: LectureAccess = { allowed: false, reason: "overdue", status: "blocked", graceEndsAt: "2026-07-01T00:00:00Z" };
  const grace: LectureAccess = { allowed: true, reason: "grace", status: "grace", graceEndsAt: "2026-08-01T00:00:00Z", daysLeft: 5 };
  const active: LectureAccess = { allowed: true, reason: "active", status: "active" };
  const grant: CourseAccessOverride = {
    id: "g1", phone: "9999999999", course_id: "c1", mode: "grant",
    expires_at: "2026-08-27T00:00:00Z", note: "test", created_by: "admin",
    created_at: "2026-07-28T00:00:00Z", updated_at: "2026-07-28T00:00:00Z",
  };

  test("blocked overdue, no grant → blocked template", () => {
    const p = pickAccessTemplate({ scheduleAccess: blocked, override: null, totalRemaining: 38000 });
    assert.ok("templateId" in p);
    assert.equal(p.templateId, "portal_access_blocked");
  });

  test("blocked + active grant → expiring with override end", () => {
    const p = pickAccessTemplate({ scheduleAccess: blocked, override: grant, totalRemaining: 38000 });
    assert.ok("templateId" in p);
    assert.equal(p.templateId, "portal_access_expiring");
    assert.equal(p.daysSource, "override");
    assert.equal(p.daysEndAt, grant.expires_at);
  });

  test("grace → expiring template", () => {
    const p = pickAccessTemplate({ scheduleAccess: grace, override: null, totalRemaining: 1000 });
    assert.ok("templateId" in p);
    assert.equal(p.templateId, "portal_access_expiring");
    assert.equal(p.daysSource, "grace");
  });

  test("nothing outstanding → access_restored", () => {
    const p = pickAccessTemplate({ scheduleAccess: blocked, override: null, totalRemaining: 0 });
    assert.ok("block" in p);
    assert.equal(p.block, "access_restored");
  });

  test("schedule active (not yet due) → not_access_risk", () => {
    const p = pickAccessTemplate({ scheduleAccess: active, override: null, totalRemaining: 1000 });
    assert.ok("block" in p);
    assert.equal(p.block, "not_access_risk");
  });

  test("override daysEndAt is the grant expiry (Aman case)", () => {
    const p = pickAccessTemplate({
      scheduleAccess: blocked,
      override: grant,
      totalRemaining: 38000,
      now: Date.parse("2026-07-28T12:00:00.000Z"),
    });
    assert.ok("templateId" in p);
    assert.equal(p.daysSource, "override");
    assert.equal(p.daysEndAt, "2026-08-27T00:00:00Z");
  });
});
