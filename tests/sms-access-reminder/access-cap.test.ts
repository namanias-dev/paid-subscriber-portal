import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCESS_AUTO_CAP_PER_INSTALLMENT, ACCESS_AUTOMATION_DEFAULTS } from "../../lib/sms/accessReminderConstants";
import { accessCapEvents } from "../../lib/studentTimeline";

describe("access automation defaults (safe ship)", () => {
  test("kill switch off, dry-run on, enabled false", () => {
    assert.equal(ACCESS_AUTOMATION_DEFAULTS.killSwitch, false);
    assert.equal(ACCESS_AUTOMATION_DEFAULTS.dryRun, true);
    assert.equal(ACCESS_AUTOMATION_DEFAULTS.enabled, false);
  });

  test("cap is 5 per installment", () => {
    assert.equal(ACCESS_AUTO_CAP_PER_INSTALLMENT, 5);
  });
});

describe("accessCapEvents", () => {
  test("needs_call becomes a timeline event", () => {
    const events = accessCapEvents({
      id: "c1",
      course_enrollment_id: "e1",
      installment_no: 2,
      auto_sequences_used: 5,
      needs_call: true,
      needs_call_at: "2026-07-28T10:00:00.000Z",
      excluded_from_automation: false,
      excluded_reason: null,
      excluded_at: null,
      excluded_by: null,
      reset_at: null,
      reset_by: null,
      reset_reason: null,
    });
    assert.equal(events.length, 1);
    assert.equal(events[0]!.type, "access_cap");
    assert.match(events[0]!.title, /flagged for call/);
    assert.equal(events[0]!.actor.name, "System · automated");
  });
});
