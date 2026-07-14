/**
 * Journey Automation feature flags. BACKEND-ONLY (never inline secrets/flags into
 * client bundles). Every flag defaults OFF and follows the codebase convention of
 * `X === "true"` (mirrors `smsEnvEnabled()` in lib/sms/config.ts).
 *
 * SAFETY: with EXECUTION and/or SMS off, no journey code path may execute or send
 * anything. This shipment ships ZERO execution/sending; these flags + the guard in
 * ./guards.ts exist so the engine (P3/P4) can only ever act behind an explicit,
 * fail-closed gate.
 */

function envTrue(key: string): boolean {
  const v = process.env[key];
  return typeof v === "string" && v.trim() === "true";
}

/**
 * Master switch: makes the builder/dashboard surface at all. Required prod value
 * is "true" (dashboard visible). Everything else stays OFF until explicitly
 * enabled in a future approved step.
 */
export function journeyAutomationEnabled(): boolean {
  return envTrue("JOURNEY_AUTOMATION_ENABLED");
}

/** Execution engine master gate. OFF => nothing enrolls, schedules, or runs. */
export function journeyExecutionEnabled(): boolean {
  return envTrue("JOURNEY_AUTOMATION_EXECUTION_ENABLED");
}

/** SMS action gate. OFF => no journey node may ever hand a send to the chokepoint. */
export function journeySmsEnabled(): boolean {
  return envTrue("JOURNEY_AUTOMATION_SMS_ENABLED");
}

/** Promotional-content gate (extra compliance guard on top of SMS). */
export function journeyPromotionalEnabled(): boolean {
  return envTrue("JOURNEY_AUTOMATION_PROMOTIONAL");
}

/** Payment-reminder journeys gate. */
export function journeyPaymentRemindersEnabled(): boolean {
  return envTrue("JOURNEY_AUTOMATION_PAYMENT_REMINDERS");
}

/** AIVA (AI assistant) control gate. */
export function journeyAivaEnabled(): boolean {
  return envTrue("JOURNEY_AUTOMATION_AIVA");
}

export interface JourneyFlagSnapshot {
  enabled: boolean;
  executionEnabled: boolean;
  smsEnabled: boolean;
  promotionalEnabled: boolean;
  paymentRemindersEnabled: boolean;
  aivaEnabled: boolean;
}

/** Non-secret snapshot of all six flags (safe to show in an admin status panel). */
export function journeyFlagSnapshot(): JourneyFlagSnapshot {
  return {
    enabled: journeyAutomationEnabled(),
    executionEnabled: journeyExecutionEnabled(),
    smsEnabled: journeySmsEnabled(),
    promotionalEnabled: journeyPromotionalEnabled(),
    paymentRemindersEnabled: journeyPaymentRemindersEnabled(),
    aivaEnabled: journeyAivaEnabled(),
  };
}
