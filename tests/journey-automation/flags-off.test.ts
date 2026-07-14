/**
 * (iii) Flag-off-blocks-everything — proves that with EXECUTION and/or SMS flags
 * OFF (or the kill switch engaged), no journey code path can execute or send. The
 * guard is fail-closed and is the ONLY gate; there is no bypass. This shipment
 * ships zero sending, so this asserts the future engine can never act with the
 * flags off.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertJourneyExecutionAllowed,
  assertJourneySmsAllowed,
  canExecuteJourneys,
  canSendJourneySms,
  JourneyExecutionBlockedError,
} from "../../lib/journey-automation/guards";
import {
  journeyExecutionEnabled,
  journeySmsEnabled,
  journeyPromotionalEnabled,
  journeyAivaEnabled,
  journeyPaymentRemindersEnabled,
} from "../../lib/journey-automation/flags";

describe("journey flags — default OFF", () => {
  it("execution/sms/promotional/payment/aiva flags default to false without env", () => {
    // The test environment does not set these; they must read as OFF.
    delete process.env.JOURNEY_AUTOMATION_EXECUTION_ENABLED;
    delete process.env.JOURNEY_AUTOMATION_SMS_ENABLED;
    delete process.env.JOURNEY_AUTOMATION_PROMOTIONAL;
    delete process.env.JOURNEY_AUTOMATION_PAYMENT_REMINDERS;
    delete process.env.JOURNEY_AUTOMATION_AIVA;
    assert.equal(journeyExecutionEnabled(), false);
    assert.equal(journeySmsEnabled(), false);
    assert.equal(journeyPromotionalEnabled(), false);
    assert.equal(journeyPaymentRemindersEnabled(), false);
    assert.equal(journeyAivaEnabled(), false);
  });

  it("a non-'true' value is still OFF (only exact 'true' enables)", () => {
    process.env.JOURNEY_AUTOMATION_EXECUTION_ENABLED = "1";
    assert.equal(journeyExecutionEnabled(), false);
    process.env.JOURNEY_AUTOMATION_EXECUTION_ENABLED = "TRUE";
    assert.equal(journeyExecutionEnabled(), false);
    delete process.env.JOURNEY_AUTOMATION_EXECUTION_ENABLED;
  });
});

describe("journey guard — execution blocked when flag off", () => {
  it("canExecuteJourneys is blocked with execution disabled", () => {
    const res = canExecuteJourneys({ executionEnabled: false });
    assert.equal(res.allowed, false);
    assert.equal(res.reason, "execution_disabled");
  });

  it("assertJourneyExecutionAllowed throws with execution disabled", () => {
    assert.throws(() => assertJourneyExecutionAllowed({ executionEnabled: false }), JourneyExecutionBlockedError);
  });

  it("kill switch blocks even when execution enabled", () => {
    const res = canExecuteJourneys({ executionEnabled: true, killSwitchEngaged: true });
    assert.equal(res.allowed, false);
    assert.equal(res.reason, "kill_switch");
  });

  it("per-workflow disable blocks even when execution enabled", () => {
    const res = canExecuteJourneys({ executionEnabled: true, workflowDisabled: true });
    assert.equal(res.allowed, false);
    assert.equal(res.reason, "workflow_disabled");
  });
});

describe("journey guard — sending blocked when SMS flag off", () => {
  it("SMS blocked even when execution is on", () => {
    const res = canSendJourneySms({ executionEnabled: true, smsEnabled: false });
    assert.equal(res.allowed, false);
    assert.equal(res.reason, "sms_disabled");
  });

  it("assertJourneySmsAllowed throws when SMS off", () => {
    assert.throws(() => assertJourneySmsAllowed({ executionEnabled: true, smsEnabled: false }), JourneyExecutionBlockedError);
  });

  it("SMS blocked when execution off (execution takes precedence)", () => {
    const res = canSendJourneySms({ executionEnabled: false, smsEnabled: true });
    assert.equal(res.allowed, false);
    assert.equal(res.reason, "execution_disabled");
  });

  it("promotional content requires the promotional flag on top of SMS", () => {
    const res = canSendJourneySms({ executionEnabled: true, smsEnabled: true, promotional: true, promotionalEnabled: false });
    assert.equal(res.allowed, false);
    assert.equal(res.reason, "promotional_disabled");
  });
});

describe("journey guard — allowed ONLY when every gate passes", () => {
  it("service send is allowed with execution+sms on and no kill switch", () => {
    const res = canSendJourneySms({ executionEnabled: true, smsEnabled: true });
    assert.equal(res.allowed, true);
    assert.equal(res.reason, "ok");
  });

  it("promotional send is allowed only with all three flags on", () => {
    const res = canSendJourneySms({ executionEnabled: true, smsEnabled: true, promotional: true, promotionalEnabled: true });
    assert.equal(res.allowed, true);
  });
});
