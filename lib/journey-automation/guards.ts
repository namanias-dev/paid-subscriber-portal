/**
 * Fail-closed execution/send guard for Journey Automation.
 *
 * This is the SINGLE gate the future execution engine (P3) and SMS action (P4)
 * MUST pass before doing anything. It is pure and deterministic so it can be unit
 * tested: with EXECUTION and/or SMS flags off (or the global kill switch engaged),
 * every gate returns `allowed:false` and `assert*` throws — there is no bypass.
 *
 * THIS SHIPMENT SHIPS ZERO SENDING/EXECUTION. There is deliberately no gateway
 * call, no scheduler, and no call into lib/sms/service.ts anywhere in
 * lib/journey-automation. When those land, they may only run behind these gates,
 * and all sends must still go through the existing chokepoint (sendSms/sendBatch).
 */
import {
  journeyExecutionEnabled,
  journeySmsEnabled,
  journeyPromotionalEnabled,
} from "./flags";

export interface GuardContext {
  /** Global kill switch (from automation_settings.kill_switch_engaged). */
  killSwitchEngaged?: boolean;
  /** Per-workflow disable flag. */
  workflowDisabled?: boolean;
  /** True when the action carries promotional content (extra gate). */
  promotional?: boolean;
  /** Overrides for testing; default to reading the live env flags. */
  executionEnabled?: boolean;
  smsEnabled?: boolean;
  promotionalEnabled?: boolean;
}

export interface GuardResult {
  allowed: boolean;
  /** Machine-readable reason when blocked. */
  reason:
    | "ok"
    | "execution_disabled"
    | "sms_disabled"
    | "promotional_disabled"
    | "kill_switch"
    | "workflow_disabled";
}

const BLOCK = (reason: GuardResult["reason"]): GuardResult => ({ allowed: false, reason });

/**
 * Can the engine take ANY action for a workflow? Fail-closed: execution flag must
 * be on AND neither kill switch nor workflow-disable engaged.
 */
export function canExecuteJourneys(ctx: GuardContext = {}): GuardResult {
  const execOn = ctx.executionEnabled ?? journeyExecutionEnabled();
  if (!execOn) return BLOCK("execution_disabled");
  if (ctx.killSwitchEngaged) return BLOCK("kill_switch");
  if (ctx.workflowDisabled) return BLOCK("workflow_disabled");
  return { allowed: true, reason: "ok" };
}

/**
 * Can a journey hand an SMS to the chokepoint? Requires execution AND the SMS
 * flag; promotional content additionally requires the promotional flag.
 */
export function canSendJourneySms(ctx: GuardContext = {}): GuardResult {
  const exec = canExecuteJourneys(ctx);
  if (!exec.allowed) return exec;
  const smsOn = ctx.smsEnabled ?? journeySmsEnabled();
  if (!smsOn) return BLOCK("sms_disabled");
  if (ctx.promotional) {
    const promoOn = ctx.promotionalEnabled ?? journeyPromotionalEnabled();
    if (!promoOn) return BLOCK("promotional_disabled");
  }
  return { allowed: true, reason: "ok" };
}

export class JourneyExecutionBlockedError extends Error {
  reason: GuardResult["reason"];
  constructor(reason: GuardResult["reason"]) {
    super(`Journey execution blocked: ${reason}`);
    this.name = "JourneyExecutionBlockedError";
    this.reason = reason;
  }
}

/** Throws unless execution is allowed. Future engine entry points must call this first. */
export function assertJourneyExecutionAllowed(ctx: GuardContext = {}): void {
  const res = canExecuteJourneys(ctx);
  if (!res.allowed) throw new JourneyExecutionBlockedError(res.reason);
}

/** Throws unless an SMS action is allowed. Future SMS action must call this first. */
export function assertJourneySmsAllowed(ctx: GuardContext = {}): void {
  const res = canSendJourneySms(ctx);
  if (!res.allowed) throw new JourneyExecutionBlockedError(res.reason);
}
