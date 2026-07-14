/**
 * P4 — SMS ADAPTER. The thin layer between an SMS node and the EXISTING chokepoint.
 *
 * It NEVER talks to a gateway. It:
 *  1. resolves variables at EXECUTION TIME (secrets like login codes / payment links
 *     are passed transiently and NEVER stored),
 *  2. builds a deterministic idempotencyKey,
 *  3. asks sendDecision() whether this is LIVE or SIMULATE,
 *  4. SIMULATE (default): returns a would-send record (recipient, templateId, safe
 *     resolved variables MINUS secrets, idempotencyKey). Calls NOTHING.
 *  5. LIVE (all gates pass): calls the SenderPort (→ sendSms) with the idempotencyKey
 *     as the chokepoint dedupe_key, letting the chokepoint enforce ALL compliance.
 */
import type { SenderPort } from "./ports";
import type { EnrollmentRow, RunMode } from "./types";
import { sendDecision, type SendCategory } from "./mode";
import { sendIdempotencyKey } from "./keys";
import type { GuardContext } from "../guards";

/** Keys that must never be persisted (resolved transiently, passed to send only). */
const SECRET_KEY = /(login|otp|code|password|secret|token|payment_link|link|url)/i;

function stripSecrets(vars: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export interface SmsActionInput {
  enrollment: EnrollmentRow;
  nodeKey: string;
  category: SendCategory;
  recipient: string;
  templateId: string;
  /** Non-secret resolved vars (safe to store). */
  publicVariables: Record<string, string | number | null | undefined>;
  /** Secret resolved vars (login codes / links) — passed to send, NEVER stored. */
  secretVariables?: Record<string, string | number | null | undefined>;
  relatedEntity?: {
    user_id?: string | null; lead_id?: string | null; payment_id?: string | null;
    course_id?: string | null; webinar_id?: string | null; student_name?: string | null;
  };
  triggerEvent?: string | null;
  audienceType?: string | null;
  killSwitchEngaged: boolean;
  guardOverrides?: Pick<GuardContext, "executionEnabled" | "smsEnabled" | "promotionalEnabled">;
  paymentRemindersEnabled?: boolean;
}

export interface SmsActionResult {
  status: "simulated" | "sent" | "failed";
  mode: RunMode;
  idempotencyKey: string;
  /** Safe to persist in automation_node_runs.resolved_variables (no secrets). */
  resolvedVariables: Record<string, unknown>;
  outcome: Record<string, unknown>;
  /** True only when the real chokepoint sender was invoked. */
  senderCalled: boolean;
}

export async function runSmsAction(sender: SenderPort, input: SmsActionInput): Promise<SmsActionResult> {
  const idempotencyKey = sendIdempotencyKey(input.enrollment.id, input.nodeKey);
  const safeVars = stripSecrets(input.publicVariables as Record<string, unknown>);

  const decision = sendDecision({
    enrollmentMode: input.enrollment.mode,
    killSwitchEngaged: input.killSwitchEngaged,
    category: input.category,
    guardOverrides: input.guardOverrides,
    paymentRemindersEnabled: input.paymentRemindersEnabled,
  });

  if (!decision.live) {
    // SIMULATION: record what WOULD send. Sends NOTHING.
    return {
      status: "simulated",
      mode: "simulate",
      idempotencyKey,
      resolvedVariables: safeVars,
      outcome: {
        would_send: true,
        recipient: input.recipient,
        template_id: input.templateId,
        category: input.category,
        decision_reason: decision.reason,
        idempotency_key: idempotencyKey,
      },
      senderCalled: false,
    };
  }

  // LIVE: hand to the chokepoint. Secrets included transiently; NOT in stored vars.
  const outcome = await sender.send({
    mobile: input.recipient,
    templateId: input.templateId,
    variables: { ...input.publicVariables, ...(input.secretVariables ?? {}) },
    relatedEntity: input.relatedEntity ?? {},
    triggerEvent: input.triggerEvent ?? `journey:${input.enrollment.workflow_id}`,
    audienceType: input.audienceType ?? null,
    dedupeKey: idempotencyKey,
    workflowId: input.enrollment.workflow_id,
    versionId: input.enrollment.version_id,
    enrollmentId: input.enrollment.id,
    nodeKey: input.nodeKey,
  });

  return {
    status: outcome.ok ? "sent" : "failed",
    mode: "live",
    idempotencyKey,
    resolvedVariables: safeVars,
    outcome: {
      sent: outcome.ok,
      skipped: outcome.skipped ?? null,
      error: outcome.error ?? null,
      log_id: outcome.logId ?? null,
      recipient: input.recipient,
      template_id: input.templateId,
      idempotency_key: idempotencyKey,
    },
    senderCalled: true,
  };
}
