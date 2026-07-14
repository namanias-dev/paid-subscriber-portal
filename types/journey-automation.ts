/**
 * Shared domain types for the Student Journey Automation studio (foundation).
 *
 * This shipment is FOUNDATION ONLY: no execution, no sending. Runtime concepts
 * (enrollments/runs/jobs/node_runs/attribution) are intentionally absent — they
 * belong to the execution shipment (P3). All future sends route through the
 * existing SMS chokepoint (`lib/sms/service.ts`), never from here.
 */

/** Workflow lifecycle state machine. */
export type WorkflowStatus =
  | "draft"
  | "ready"
  | "active"
  | "paused"
  | "archived"
  | "disabled_by_killswitch";

export const WORKFLOW_STATUSES: WorkflowStatus[] = [
  "draft",
  "ready",
  "active",
  "paused",
  "archived",
  "disabled_by_killswitch",
];

/** Version lifecycle. A `published` version is IMMUTABLE. */
export type VersionStatus = "draft" | "published" | "archived";

export type NodeType =
  | "trigger"
  | "wait"
  | "send_sms"
  | "branch"
  | "goal"
  | "exit";

export interface AutomationWorkflow {
  id: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  current_version_id: string | null;
  published_version: number | null;
  killswitch_disabled: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationWorkflowVersion {
  id: string;
  workflow_id: string;
  version: number;
  status: VersionStatus;
  definition: Record<string, unknown>;
  change_summary: string | null;
  created_by: string | null;
  published_by: string | null;
  published_at: string | null;
  is_immutable: boolean;
  created_at: string;
  updated_at: string;
}

export interface AutomationNode {
  id: string;
  workflow_id: string;
  version_id: string;
  node_key: string;
  type: NodeType | string;
  config: Record<string, unknown>;
  position: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AutomationEdge {
  id: string;
  workflow_id: string;
  version_id: string;
  source_node_id: string;
  target_node_id: string;
  branch_label: string | null;
  condition: Record<string, unknown>;
  created_at: string;
}

export interface AutomationTrigger {
  id: string;
  workflow_id: string;
  version_id: string;
  event_type: string;
  config: Record<string, unknown>;
  /** Defaults false — nothing can enroll/execute this shipment. */
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AutomationGoal {
  id: string;
  workflow_id: string;
  version_id: string;
  name: string;
  goal_type: string;
  config: Record<string, unknown>;
  created_at: string;
}

export interface AutomationSuppression {
  id: string;
  scope: "global" | "workflow";
  workflow_id: string | null;
  normalized_mobile: string;
  /** Required — compliance is never optional. */
  reason: string;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
}

/**
 * A journey message template MUST bind to a real DLT-governed `sms_templates`
 * row — a journey can never reference an unapproved/ad-hoc template.
 */
export interface AutomationTemplate {
  id: string;
  name: string;
  channel: "sms";
  sms_template_id: string;
  description: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export type AutomationAuditAction =
  | "create"
  | "edit"
  | "version"
  | "publish"
  | "pause"
  | "resume"
  | "archive"
  | "killswitch_on"
  | "killswitch_off";

export interface AutomationAuditLog {
  id: string;
  workflow_id: string | null;
  version_id: string | null;
  action: AutomationAuditAction | string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  actor_is_super: boolean;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  summary: string | null;
  created_at: string;
}

export interface AutomationSettings {
  id: string;
  kill_switch_engaged: boolean;
  kill_switch_reason: string | null;
  kill_switch_by: string | null;
  kill_switch_at: string | null;
  data: Record<string, unknown>;
  updated_by: string | null;
  updated_at: string;
}

/** A workflow plus its versions, for the read-only detail view. */
export interface WorkflowWithVersions extends AutomationWorkflow {
  versions: AutomationWorkflowVersion[];
}
