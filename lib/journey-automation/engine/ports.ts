/**
 * Ports (dependency interfaces) for the pure engine orchestrators (matcher/worker).
 * Real implementations live in supabasePort.ts / realState.ts / realSender.ts and
 * are wired only inside server-side cron routes. Tests supply in-memory fakes so the
 * safety proofs ("flags off => SenderPort never called") are exact and deterministic.
 */
import type { BuilderGraph, AutomationEvent } from "@/types/journey-automation";
import type {
  EnrollmentRow, JobRow, WorkflowRuntimeRow, CandidateWorkflow,
  NodeRunInput, NodeRunRow, ScheduleJobInput, CreateEnrollmentInput,
  GoalCompletionInput, SuppressionInput, StaffTaskInput, SendRequest, SendOutcome,
} from "./types";
import type { EligibilityFacts } from "./eligibility";
import type { LatestState } from "./latestState";

export interface Clock { now(): number }
export const systemClock: Clock = { now: () => Date.now() };

/** Global engine settings snapshot (kill switch, category pauses). */
export interface EngineSettings {
  killSwitchEngaged: boolean;
  pausedCategories: string[]; // e.g. ["payment_reminder"]
}

export interface EngineDataPort {
  getSettings(): Promise<EngineSettings>;

  // --- matcher ---
  getUnprocessedEvents(limit: number): Promise<AutomationEvent[]>;
  markEventProcessed(eventId: string): Promise<void>;
  listCandidateWorkflows(eventType: string): Promise<CandidateWorkflow[]>;
  countActiveEnrollments(workflowId: string): Promise<number>;
  /** Idempotent: returns created=false when the dedupe_key already exists. */
  createEnrollment(input: CreateEnrollmentInput): Promise<{ enrollment: EnrollmentRow; created: boolean }>;

  // --- queue ---
  /** Idempotent: created=false when a job with the dedupe_key already exists. */
  scheduleJob(input: ScheduleJobInput): Promise<{ created: boolean }>;
  /** Crash recovery: return stuck 'running' jobs older than olderThanMs back to 'queued'. */
  requeueStaleJobs(olderThanMs: number): Promise<number>;
  claimJobs(limit: number): Promise<JobRow[]>;
  completeJob(jobId: string, status: "done" | "cancelled"): Promise<void>;
  rescheduleJob(jobId: string, whenISO: string, error: string | null): Promise<void>;
  deadLetterJob(jobId: string, error: string): Promise<void>;
  cancelPendingJobs(enrollmentId: string): Promise<number>;

  // --- runtime records ---
  getEnrollment(id: string): Promise<EnrollmentRow | null>;
  updateEnrollment(id: string, patch: Partial<EnrollmentRow>): Promise<void>;
  getWorkflow(id: string): Promise<WorkflowRuntimeRow | null>;
  getPublishedGraph(versionId: string): Promise<BuilderGraph | null>;
  getNodeRun(enrollmentId: string, nodeKey: string): Promise<NodeRunRow | null>;
  upsertNodeRun(input: NodeRunInput): Promise<void>;
  recordGoal(input: GoalCompletionInput): Promise<void>;
  recordSuppression(input: SuppressionInput): Promise<void>;
  /** Idempotent per (enrollment,node): creates a human staff-task record. No dispatch/send. */
  createStaffTask(input: StaffTaskInput): Promise<void>;
}

/** Reads CURRENT business truth read-only. Never mutates anything. */
export interface StatePort {
  getEligibilityFacts(workflow: WorkflowRuntimeRow, event: AutomationEvent): Promise<EligibilityFacts>;
  getLatestState(enrollment: EnrollmentRow): Promise<LatestState>;
}

/** The ONLY way a real send can happen. Live impl calls lib/sms/service.sendSms. */
export interface SenderPort {
  send(req: SendRequest): Promise<SendOutcome>;
}
