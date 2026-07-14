/**
 * Effective-mode resolution. PURE. Two questions:
 *  1. shouldProcess(): should the engine enroll/run this workflow AT ALL?
 *     — 'off' unless a human moved the workflow to 'simulate'/'live' AND the kill
 *       switch is clear. Default 'off' => the engine does NOTHING post-deploy.
 *  2. sendDecision(): for an SMS action, LIVE or SIMULATE?
 *     — LIVE requires enrollment.mode==='live' AND the env flags (EXECUTION+SMS +
 *       category) on AND kill switch clear. Otherwise SIMULATE (records would-send,
 *       sends NOTHING). Fail-closed: any missing gate => SIMULATE.
 */
import { canSendJourneySms, type GuardContext } from "../guards";
import { journeyPaymentRemindersEnabled } from "../flags";
import type { WorkflowExecutionMode, RunMode } from "./types";

export function shouldProcess(workflowMode: WorkflowExecutionMode, killSwitchEngaged: boolean): WorkflowExecutionMode {
  if (killSwitchEngaged) return "off";
  return workflowMode;
}

/** Enrollment mode snapshotted at enroll time (simulate unless fully live). */
export function enrollmentModeFor(workflowMode: WorkflowExecutionMode): RunMode {
  return workflowMode === "live" ? "live" : "simulate";
}

export type SendCategory = "payment_reminder" | "promotional" | "transactional";

export interface SendDecisionInput {
  enrollmentMode: RunMode;
  killSwitchEngaged: boolean;
  category: SendCategory;
  /** Test overrides; default to live env flags. */
  guardOverrides?: Pick<GuardContext, "executionEnabled" | "smsEnabled" | "promotionalEnabled">;
  paymentRemindersEnabled?: boolean;
}

export interface SendDecision { live: boolean; reason: string }

export function sendDecision(input: SendDecisionInput): SendDecision {
  if (input.enrollmentMode !== "live") return { live: false, reason: "enrollment_simulate" };
  if (input.killSwitchEngaged) return { live: false, reason: "kill_switch" };
  const guard = canSendJourneySms({
    killSwitchEngaged: input.killSwitchEngaged,
    promotional: input.category === "promotional",
    ...input.guardOverrides,
  });
  if (!guard.allowed) return { live: false, reason: guard.reason };
  if (input.category === "payment_reminder") {
    const on = input.paymentRemindersEnabled ?? journeyPaymentRemindersEnabled();
    if (!on) return { live: false, reason: "payment_reminders_disabled" };
  }
  return { live: true, reason: "ok" };
}
