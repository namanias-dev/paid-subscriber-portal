/**
 * Runtime domain types for the Journey Automation execution engine (P3/P4).
 *
 * The engine NEVER sends directly and NEVER mutates business truth. Its default
 * mode is SIMULATION (records intended actions). These types describe the durable
 * runtime rows + the request/result shapes the pure orchestrators pass to ports.
 */
import type { BuilderGraph } from "@/types/journey-automation";

export type EnrollmentStatus = "active" | "completed" | "exited" | "cancelled" | "goal_met" | "failed";
export type RunMode = "simulate" | "live";
export type WorkflowExecutionMode = "off" | "simulate" | "live";
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled" | "dead";
export type NodeRunStatus = "pending" | "done" | "simulated" | "sent" | "suppressed" | "skipped" | "failed";

export interface EnrollmentRow {
  id: string;
  workflow_id: string;
  version_id: string;
  event_id: string | null;
  normalized_phone: string | null;
  student_id: string | null;
  lead_id: string | null;
  enrollment_ref: string | null;
  mode: RunMode;
  status: EnrollmentStatus;
  current_node_key: string | null;
  context: Record<string, unknown>;
  goal_met: boolean;
  exit_reason: string | null;
  dedupe_key: string | null;
  enrolled_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface JobRow {
  id: string;
  enrollment_id: string;
  workflow_id: string;
  node_key: string;
  kind: string;
  status: JobStatus;
  scheduled_for: string;
  attempts: number;
  max_attempts: number;
  dedupe_key: string | null;
  last_error: string | null;
  dead_letter: boolean;
}

export interface WorkflowRuntimeRow {
  id: string;
  name: string;
  status: string;
  published_version: number | null;
  current_version_id: string | null;
  execution_mode: WorkflowExecutionMode;
  killswitch_disabled: boolean;
  canary_max_enrollments: number | null;
  canary_test_phones: string[] | null;
}

export interface NodeRunInput {
  enrollment_id: string;
  workflow_id: string;
  node_key: string;
  node_type: string;
  status: NodeRunStatus;
  mode: RunMode;
  resolved_variables?: Record<string, unknown>;
  outcome?: Record<string, unknown>;
  idempotency_key?: string | null;
  error?: string | null;
}

export interface NodeRunRow extends NodeRunInput {
  id: string;
}

export interface ScheduleJobInput {
  enrollment_id: string;
  workflow_id: string;
  node_key: string;
  scheduled_for: string;
  dedupe_key: string;
  max_attempts?: number;
}

export interface CreateEnrollmentInput {
  workflow_id: string;
  version_id: string;
  event_id: string | null;
  normalized_phone: string | null;
  student_id: string | null;
  lead_id: string | null;
  enrollment_ref: string | null;
  mode: RunMode;
  current_node_key: string | null;
  context: Record<string, unknown>;
  dedupe_key: string;
}

export interface GoalCompletionInput {
  enrollment_id: string;
  workflow_id: string;
  goal_node_key: string | null;
  goal_type: string | null;
  attributed_event: string | null;
  mode: RunMode;
}

export interface SuppressionInput {
  enrollment_id: string | null;
  workflow_id: string | null;
  node_key: string | null;
  normalized_phone: string | null;
  reason: string;
  detail?: Record<string, unknown>;
}

/** What the SMS adapter hands the SenderPort in LIVE mode (mirrors the chokepoint). */
export interface SendRequest {
  mobile: string;
  templateId: string;               // DLT-governed sms_templates.id
  variables: Record<string, string | number | null | undefined>;
  relatedEntity: {
    user_id?: string | null; lead_id?: string | null; payment_id?: string | null;
    course_id?: string | null; webinar_id?: string | null; student_name?: string | null;
  };
  triggerEvent: string | null;
  audienceType: string | null;
  /** Deterministic idempotencyKey → chokepoint dedupe_key (insert-first UNIQUE). */
  dedupeKey: string;
  workflowId: string;
  versionId: string;
  enrollmentId: string;
  nodeKey: string;
}

export interface SendOutcome { ok: boolean; skipped?: string; error?: string; logId?: string }

export interface CandidateWorkflow {
  workflow: WorkflowRuntimeRow;
  version_id: string;
  graph: BuilderGraph;
}
