/**
 * Pure versioning + lifecycle logic for Journey Automation workflows.
 *
 * Two invariants live here (and are unit tested):
 *  1. PUBLISHED VERSIONS ARE IMMUTABLE. Any attempt to edit a published version
 *     throws. Editing produces a NEW draft version; publishing freezes it.
 *  2. The workflow STATE MACHINE only permits explicit transitions.
 *
 * Pure/deterministic (no I/O) so the store layer and tests can both rely on it.
 */
import type {
  AutomationWorkflowVersion,
  VersionStatus,
  WorkflowStatus,
} from "@/types/journey-automation";

/** Allowed workflow status transitions. */
const TRANSITIONS: Record<WorkflowStatus, WorkflowStatus[]> = {
  draft: ["ready", "archived"],
  ready: ["active", "draft", "archived"],
  active: ["paused", "archived", "disabled_by_killswitch"],
  paused: ["active", "archived", "disabled_by_killswitch"],
  // Archive is reversible: restoring lands back in the safe `draft` state so the
  // author can review before re-publishing. Audit history + versions are kept.
  archived: ["draft"],
  // Only the kill switch sets this; resuming lands in the safe `paused` state.
  disabled_by_killswitch: ["paused"],
};

export function canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class WorkflowTransitionError extends Error {
  constructor(from: WorkflowStatus, to: WorkflowStatus) {
    super(`Illegal workflow transition: ${from} -> ${to}`);
    this.name = "WorkflowTransitionError";
  }
}

export function assertTransition(from: WorkflowStatus, to: WorkflowStatus): void {
  if (!canTransition(from, to)) throw new WorkflowTransitionError(from, to);
}

/** A version is immutable once published (belt-and-suspenders with is_immutable). */
export function isVersionImmutable(v: Pick<AutomationWorkflowVersion, "status" | "is_immutable">): boolean {
  return v.status === "published" || v.is_immutable === true;
}

export class ImmutableVersionError extends Error {
  constructor(version: number) {
    super(`Version ${version} is published and immutable; create a new draft instead`);
    this.name = "ImmutableVersionError";
  }
}

/** Throws if the version can't be edited (i.e. it is published/immutable). */
export function assertVersionEditable(v: AutomationWorkflowVersion): void {
  if (isVersionImmutable(v)) throw new ImmutableVersionError(v.version);
}

/** Next version number = highest existing + 1 (1-based). */
export function nextVersionNumber(versions: Pick<AutomationWorkflowVersion, "version">[]): number {
  return versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
}

/**
 * Apply an edit to a DRAFT version. Returns the updated version. Throws
 * ImmutableVersionError if the target is published — enforcing invariant #1.
 */
export function applyDraftEdit(
  version: AutomationWorkflowVersion,
  patch: Partial<Pick<AutomationWorkflowVersion, "definition" | "change_summary">>,
  editedBy: string | null,
  now: string = new Date().toISOString(),
): AutomationWorkflowVersion {
  assertVersionEditable(version);
  return {
    ...version,
    definition: patch.definition ?? version.definition,
    change_summary: patch.change_summary ?? version.change_summary,
    created_by: version.created_by ?? editedBy,
    updated_at: now,
  };
}

/**
 * Freeze a draft version into an immutable published version. Returns the frozen
 * version object. Idempotency/uniqueness of the version number is the store's job;
 * this enforces the immutability transition purely.
 */
export function freezeToPublished(
  version: AutomationWorkflowVersion,
  publishedBy: string | null,
  now: string = new Date().toISOString(),
): AutomationWorkflowVersion {
  if (isVersionImmutable(version)) throw new ImmutableVersionError(version.version);
  return {
    ...version,
    status: "published",
    is_immutable: true,
    published_by: publishedBy,
    published_at: now,
    updated_at: now,
  };
}

/**
 * Build the next draft version for a workflow. New entrants (once execution ships)
 * follow the latest published version; existing entrants stay on theirs. Editing
 * therefore always happens on a fresh draft, never on a published snapshot.
 */
export function newDraftVersion(
  workflowId: string,
  existing: Pick<AutomationWorkflowVersion, "version">[],
  createdBy: string | null,
  definition: Record<string, unknown> = {},
  now: string = new Date().toISOString(),
): Omit<AutomationWorkflowVersion, "id"> {
  return {
    workflow_id: workflowId,
    version: nextVersionNumber(existing),
    status: "draft" as VersionStatus,
    definition,
    change_summary: null,
    created_by: createdBy,
    published_by: null,
    published_at: null,
    is_immutable: false,
    created_at: now,
    updated_at: now,
  };
}
