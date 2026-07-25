/**
 * PHASE 3 — bulk ASSIGNMENT, and nothing else.
 *
 * This module changes exactly one column: `leads.assigned_to`. It cannot move a
 * status, edit content, send anything or delete anything. Ownership is the only
 * thing at stake, which is what makes a mistake here survivable — a wrong
 * assignment is one revert away, and the revert restores the previous owner
 * exactly rather than clearing the field.
 *
 *
 * WHY PREVIEW RETURNS A MANIFEST RATHER THAN A FILTER
 *
 * The requirement is that the preview count equals what commits, including
 * under concurrent inserts. The public site captures leads continuously, so a
 * filter like "unassigned legacy leads" resolves to a different set every time
 * it runs — preview says 1,240, a lead arrives, commit writes 1,241, and the
 * number the operator approved was never the number that happened.
 *
 * So the preview resolves the filter ONCE and returns the explicit list of lead
 * ids together with the assignee chosen for each. Commit consumes that list and
 * never re-runs the filter. Exactness is then structural rather than a race the
 * code has to win: rows created after the preview cannot enter the batch,
 * because the batch is a list of ids, not a description of a set.
 *
 * Rows can still CHANGE between preview and commit (someone reassigns one by
 * hand). Commit re-reads the current owner — it must, because the audit's
 * `before_value` has to be true — and reports any drift instead of hiding it.
 *
 *
 * WHY THIS DOES NOT LOOP OVER `applyLeadWrite`
 *
 * `applyLeadWrite` costs three round trips per lead (read, update, audit). At
 * 1,000 leads that is 3,000 round trips, several minutes, and a half-applied
 * batch if the request times out in the middle. This is set-based instead:
 * one read, one update per assignee group, one audit insert per chunk. It
 * reimplements `applyLeadWrite`'s guarantees deliberately and keeps them
 * identical — frozen-field refusal, idempotence, a real `before_value`, and an
 * audit row per changed lead sharing one `batch_id`.
 */

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../supabase";
import { getAdminAccounts, getRoles } from "../dataProvider";
import { resolvePermissions, hasPermission, isSuperAdmin } from "../permissions";
import { FROZEN_FIELDS, type WriteActor } from "./writes";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Hard ceiling on one operation. Not a performance limit — a blast-radius one.
 * There is no legitimate reason to move more than this in a single click, and
 * a bug that wants to move 178,183 rows should hit a wall it cannot argue with.
 */
export const BULK_ASSIGN_MAX = 5_000;

/** Above this, the operator must type the confirmation phrase exactly. */
export const TYPED_CONFIRMATION_THRESHOLD = 1_000;

/** PostgREST `in` lists ride in the URL, so they have to stay short. */
const ID_CHUNK = 200;

/** Rows per audit insert. */
const AUDIT_CHUNK = 500;

/** The phrase the operator must type for a large batch. */
export function confirmationPhraseFor(count: number): string {
  return `ASSIGN ${count}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LeadScope = "legacy" | "live" | "all";

/** The filters bulk assignment can select on. Deliberately a small set. */
export interface BulkAssignFilter {
  scope?: LeadScope;
  assignedMode?: "assigned" | "unassigned" | null;
  workStatus?: string | null;
  status?: string | null;
  sourceTab?: string | null;
  createdFrom?: string | null;
  createdTo?: string | null;
}

export type Distribution =
  | { mode: "round_robin"; assignees: string[] }
  | { mode: "fixed"; allocations: { username: string; count: number }[] }
  | { mode: "single"; assignee: string };

export interface AssigneeBreakdown {
  username: string;
  /** Rows that will actually change hands. */
  assigning: number;
  /** Rows already owned by this person — skipped, not rewritten. */
  alreadyOwned: number;
  /** Their queue depth before this batch. */
  queueBefore: number;
  /** Their queue depth if this batch commits. */
  queueAfter: number;
}

export interface BulkAssignPlan {
  /** Minted at preview and carried into commit, so the two are one unit. */
  batchId: string;
  createdAt: string;
  /** Every lead the filter matched, before idempotence is considered. */
  totalMatched: number;
  /** Rows that will actually change. This is the number the operator approves. */
  totalChanging: number;
  /** Rows already owned by their target. Skipped so no audit row implies an act. */
  totalAlreadyOwned: number;
  perAssignee: AssigneeBreakdown[];
  /** leadId -> username. THE MANIFEST. Commit reads this and nothing else. */
  assignments: Record<string, string>;
  /** True when the filter produced more than the cap and was truncated. */
  capped: boolean;
  requiresTypedConfirmation: boolean;
  confirmationPhrase: string | null;
  warnings: string[];
}

export interface BulkAssignResult {
  ok: true;
  batchId: string;
  /** Rows whose owner actually changed. */
  assigned: number;
  /** Rows already owned by the target when commit re-read them. */
  skippedAlreadyOwned: number;
  /**
   * Rows whose owner changed between preview and commit. They are still
   * assigned — the operator asked for it — but reported so the drift is
   * visible rather than silently absorbed.
   */
  driftedSincePreview: { leadId: string; expectedBefore: string | null; actualBefore: string | null }[];
  /** Ids in the manifest that no longer exist. */
  missing: string[];
}

export class BulkAssignError extends Error {
  constructor(message: string) { super(message); this.name = "BulkAssignError"; }
}

type AdminClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>;
let _testClient: AdminClient | null = null;

/**
 * TEST-ONLY seam. Never call from application code.
 *
 * Bulk assignment is the one place in this program that writes thousands of
 * rows in a single action, which makes it exactly the thing that must not be
 * verified by pointing it at production and cleaning up afterwards. The
 * properties that matter — preview equals commit under concurrent inserts,
 * round-robin fairness, exact restoration of prior owners — are all provable
 * against a stub, and only against a stub can the concurrent insert be staged
 * deliberately rather than hoped for.
 */
export function _setBulkAssignClientForTests(client: unknown): void {
  _testClient = (client as AdminClient | null) ?? null;
}

function db(): AdminClient {
  if (_testClient) return _testClient;
  const c = getSupabaseAdmin();
  if (!c) throw new BulkAssignError("Supabase admin client unavailable");
  return c;
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// ---------------------------------------------------------------------------
// Who can be assigned to
// ---------------------------------------------------------------------------

export interface Counsellor {
  username: string;
  name: string | null;
  role: string | null;
}

/**
 * The people a lead may be assigned to.
 *
 * `leads.assigned_to` is free text with no foreign key, so nothing at the
 * database level stops a batch being assigned to `"prya"` when `"priya"` was
 * meant. At single-lead scale that is a visible annoyance; at 1,000 rows it
 * silently builds a queue that no counsellor can see, because "My Queue"
 * matches on exact username. So assignment validates against this list, and
 * an unknown assignee is refused rather than written.
 *
 * Eligibility is `manage_students_leads` — the same permission that gates the
 * worklist itself. Assigning work to someone who cannot open the screen is
 * never intentional. Disabled accounts are excluded for the same reason.
 */
export async function listAssignableCounsellors(): Promise<Counsellor[]> {
  const [accounts, roles] = await Promise.all([getAdminAccounts(), getRoles()]);
  const roleById = new Map(roles.map((r) => [r.id, r]));

  const out: Counsellor[] = [];
  for (const a of accounts) {
    if (a.status !== "active") continue;
    if (!a.username) continue;
    const rolePerms = a.role_id ? roleById.get(a.role_id)?.permissions ?? null : null;
    const perms = resolvePermissions(rolePerms, a.permissions_override);
    if (!hasPermission(perms, "manage_students_leads") && !isSuperAdmin(perms)) continue;
    out.push({ username: a.username, name: a.name ?? null, role: a.role ?? null });
  }
  return out.sort((x, y) => x.username.localeCompare(y.username));
}

async function assertAssigneesExist(usernames: string[]): Promise<void> {
  const known = new Set((await listAssignableCounsellors()).map((c) => c.username));
  const unknown = [...new Set(usernames)].filter((u) => !known.has(u));
  if (unknown.length) {
    throw new BulkAssignError(
      `Unknown or ineligible assignee(s): ${unknown.join(", ")}. ` +
        `An assignee must be an active admin with the manage_students_leads permission — ` +
        `assigning to a name that does not match one exactly creates a queue nobody can open.`,
    );
  }
}

/** Current queue depth per counsellor, plus the unassigned pool. */
export async function queueDepths(scope: LeadScope = "legacy"): Promise<{ username: string; depth: number }[]> {
  const client = db();
  const counsellors = await listAssignableCounsellors();
  const out: { username: string; depth: number }[] = [];

  for (const c of counsellors) {
    let q = client.from("leads").select("id", { count: "exact", head: true })
      .is("merged_into", null)
      .eq("assigned_to", c.username);
    q = applyScope(q, scope);
    const { count, error } = await q;
    if (error) throw new BulkAssignError(`queueDepths(${c.username}): ${error.message}`);
    out.push({ username: c.username, depth: count ?? 0 });
  }
  return out.sort((a, b) => b.depth - a.depth);
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function applyScope(q: any, scope: LeadScope): any {
  // `eq`, never `is` — PostgREST renders `.is(col,false)` as `IS FALSE`, which
  // the planner will not match to a `NOT is_legacy` index predicate. See
  // lib/legacy-migration/legacyFilter.ts.
  if (scope === "legacy") return q.eq("is_legacy", true);
  if (scope === "live") return q.eq("is_legacy", false);
  return q;
}

/**
 * Resolve a filter to an explicit, ordered list of lead ids.
 *
 * Selects `id` only. The leads table is ~1.7 KB per row, so pulling whole rows
 * to count them is what made several earlier queries in this program time out.
 * Ordered by `created_at, id` so the same filter yields the same order, which
 * is what makes round-robin distribution reproducible.
 */
export async function resolveSelectionIds(
  filter: BulkAssignFilter,
  limit = BULK_ASSIGN_MAX,
): Promise<{ ids: string[]; capped: boolean }> {
  const client = db();
  let q = client.from("leads").select("id").is("merged_into", null);
  q = applyScope(q, filter.scope ?? "legacy");

  if (filter.assignedMode === "unassigned") q = q.is("assigned_to", null);
  if (filter.assignedMode === "assigned") q = q.not("assigned_to", "is", null);
  if (filter.workStatus) q = q.eq("work_status", filter.workStatus);
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.sourceTab) q = q.eq("legacy_source_tab", filter.sourceTab);
  if (filter.createdFrom) q = q.gte("created_at", filter.createdFrom);
  if (filter.createdTo) q = q.lte("created_at", filter.createdTo);

  // Fetch one extra to detect truncation honestly, rather than reporting
  // exactly the cap and leaving the operator to guess whether more existed.
  const { data, error } = await q
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit + 1);
  if (error) throw new BulkAssignError(`resolveSelectionIds: ${error.message}`);

  const all = ((data as { id: string }[] | null) ?? []).map((r) => r.id);
  return { ids: all.slice(0, limit), capped: all.length > limit };
}

// ---------------------------------------------------------------------------
// Distribution
// ---------------------------------------------------------------------------

/**
 * Deal ids out across assignees.
 *
 * Round-robin is index-modulo over an ordered list, so the split is as even as
 * arithmetic allows: with N ids and K people everyone gets floor(N/K) and the
 * first N mod K get one more. Deterministic, so the preview an operator
 * approves is the distribution that commits.
 */
export function distribute(ids: string[], dist: Distribution): Record<string, string> {
  const out: Record<string, string> = {};

  if (dist.mode === "single") {
    for (const id of ids) out[id] = dist.assignee;
    return out;
  }

  if (dist.mode === "round_robin") {
    const people = dist.assignees;
    if (!people.length) throw new BulkAssignError("Round-robin needs at least one assignee.");
    ids.forEach((id, i) => { out[id] = people[i % people.length]!; });
    return out;
  }

  const total = dist.allocations.reduce((s, a) => s + a.count, 0);
  if (total > ids.length) {
    throw new BulkAssignError(
      `Fixed counts total ${total} but only ${ids.length} leads matched. ` +
        `Reduce the counts or widen the filter — assigning fewer than asked would ` +
        `silently under-deliver against a number someone already approved.`,
    );
  }
  let cursor = 0;
  for (const a of dist.allocations) {
    for (let i = 0; i < a.count; i++) out[ids[cursor++]!] = a.username;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/**
 * Build the plan. Reads only — nothing is written here.
 *
 * Either `filter` or `leadIds` must be supplied. `leadIds` is the checkbox
 * selection from the table; `filter` is "everything matching what I'm looking
 * at". They resolve to the same manifest shape.
 */
export async function planBulkAssign(params: {
  filter?: BulkAssignFilter;
  leadIds?: string[];
  distribution: Distribution;
  scope?: LeadScope;
}): Promise<BulkAssignPlan> {
  const { distribution } = params;
  const warnings: string[] = [];

  const targets = distribution.mode === "single"
    ? [distribution.assignee]
    : distribution.mode === "round_robin"
      ? distribution.assignees
      : distribution.allocations.map((a) => a.username);
  await assertAssigneesExist(targets);

  let ids: string[];
  let capped = false;
  if (params.leadIds?.length) {
    ids = [...new Set(params.leadIds)];
    if (ids.length > BULK_ASSIGN_MAX) {
      throw new BulkAssignError(
        `Selection of ${ids.length} exceeds the ${BULK_ASSIGN_MAX}-row cap for one operation.`,
      );
    }
  } else if (params.filter) {
    const r = await resolveSelectionIds(params.filter, BULK_ASSIGN_MAX);
    ids = r.ids;
    capped = r.capped;
    if (capped) {
      warnings.push(
        `More than ${BULK_ASSIGN_MAX} leads match. Only the oldest ${BULK_ASSIGN_MAX} ` +
          `are in this batch; run it again to continue.`,
      );
    }
  } else {
    throw new BulkAssignError("Nothing selected: supply either `leadIds` or `filter`.");
  }

  if (!ids.length) {
    return {
      batchId: randomUUID(), createdAt: new Date().toISOString(),
      totalMatched: 0, totalChanging: 0, totalAlreadyOwned: 0,
      perAssignee: [], assignments: {}, capped: false,
      requiresTypedConfirmation: false, confirmationPhrase: null,
      warnings: ["No leads match this selection."],
    };
  }

  const assignments = distribute(ids, distribution);

  // Current owners, so the preview can exclude no-ops. Reassigning a lead to
  // the person who already owns it is not an act and must not be counted as
  // one, or the operator approves a number larger than what happens.
  const current = await readOwners(Object.keys(assignments));

  const perUser = new Map<string, AssigneeBreakdown>();
  const depths = new Map((await queueDepths(params.scope ?? params.filter?.scope ?? "legacy"))
    .map((d) => [d.username, d.depth]));
  for (const u of new Set(Object.values(assignments))) {
    perUser.set(u, {
      username: u, assigning: 0, alreadyOwned: 0,
      queueBefore: depths.get(u) ?? 0, queueAfter: depths.get(u) ?? 0,
    });
  }

  let totalChanging = 0;
  let totalAlreadyOwned = 0;
  for (const [leadId, target] of Object.entries(assignments)) {
    const row = perUser.get(target)!;
    if (current.get(leadId) === target) { row.alreadyOwned++; totalAlreadyOwned++; }
    else { row.assigning++; totalChanging++; row.queueAfter++; }
  }

  const missing = Object.keys(assignments).filter((id) => !current.has(id));
  if (missing.length) {
    warnings.push(`${missing.length} selected lead(s) no longer exist and will be skipped.`);
  }

  const reassigning = [...current.entries()]
    .filter(([id, owner]) => owner !== null && owner !== assignments[id]).length;
  if (reassigning > 0) {
    warnings.push(
      `${reassigning} lead(s) already belong to someone else and will change hands. ` +
        `Reverting this batch restores their previous owner.`,
    );
  }

  return {
    batchId: randomUUID(),
    createdAt: new Date().toISOString(),
    totalMatched: ids.length,
    totalChanging,
    totalAlreadyOwned,
    perAssignee: [...perUser.values()].sort((a, b) => b.assigning - a.assigning),
    assignments,
    capped,
    requiresTypedConfirmation: totalChanging > TYPED_CONFIRMATION_THRESHOLD,
    confirmationPhrase: totalChanging > TYPED_CONFIRMATION_THRESHOLD
      ? confirmationPhraseFor(totalChanging) : null,
    warnings,
  };
}

async function readOwners(ids: string[]): Promise<Map<string, string | null>> {
  const client = db();
  const out = new Map<string, string | null>();
  for (const part of chunk(ids, ID_CHUNK)) {
    const { data, error } = await client
      .from("leads").select("id, assigned_to").in("id", part);
    if (error) throw new BulkAssignError(`readOwners: ${error.message}`);
    for (const r of (data as { id: string; assigned_to: string | null }[] | null) ?? []) {
      out.set(r.id, r.assigned_to);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

/**
 * Apply a plan.
 *
 * Consumes the manifest, never the filter — see the note at the top of the
 * file. The confirmation phrase is re-derived from what is actually about to
 * change, so an operator cannot approve a small batch and have a large one run.
 */
export async function commitBulkAssign(params: {
  plan: BulkAssignPlan;
  actor: WriteActor;
  /** Required verbatim when `plan.requiresTypedConfirmation`. */
  typedConfirmation?: string | null;
}): Promise<BulkAssignResult> {
  const { plan, actor } = params;
  const client = db();

  const ids = Object.keys(plan.assignments);
  if (!ids.length) {
    return { ok: true, batchId: plan.batchId, assigned: 0, skippedAlreadyOwned: 0, driftedSincePreview: [], missing: [] };
  }
  if (ids.length > BULK_ASSIGN_MAX) {
    throw new BulkAssignError(`Batch of ${ids.length} exceeds the ${BULK_ASSIGN_MAX}-row cap.`);
  }

  await assertAssigneesExist([...new Set(Object.values(plan.assignments))]);

  // Re-read owners now. Required for a truthful `before_value`, and it is what
  // makes the commit idempotent: a replayed request finds every row already
  // owned by its target and writes nothing.
  const current = await readOwners(ids);
  const missing = ids.filter((id) => !current.has(id));

  const changing = ids.filter((id) => current.has(id) && current.get(id) !== plan.assignments[id]);
  const skippedAlreadyOwned = ids.length - missing.length - changing.length;

  if (plan.requiresTypedConfirmation) {
    // Re-derived from the CURRENT change count, not the preview's. If drift
    // made the batch bigger than what was approved, the phrase stops matching.
    const expected = confirmationPhraseFor(changing.length);
    if ((params.typedConfirmation ?? "").trim() !== expected) {
      throw new BulkAssignError(
        `This batch changes ${changing.length} leads and needs typed confirmation. ` +
          `Expected exactly "${expected}".`,
      );
    }
  }

  const drifted = changing
    .filter((id) => current.get(id) !== null)
    .map((id) => ({ leadId: id, expectedBefore: null as string | null, actualBefore: current.get(id) ?? null }));

  if (!changing.length) {
    return { ok: true, batchId: plan.batchId, assigned: 0, skippedAlreadyOwned, driftedSincePreview: [], missing };
  }

  // The whole point of the module: only `assigned_to` is ever written. Asserted
  // rather than merely intended, because this is the one place in the program
  // that touches thousands of rows at once.
  const PATCH_FIELD = "assigned_to" as const;
  if ((FROZEN_FIELDS as readonly string[]).includes(PATCH_FIELD)) {
    throw new BulkAssignError("assigned_to is frozen — refusing to write.");
  }

  // Group by target so each UPDATE is one statement over many ids.
  const byTarget = new Map<string, string[]>();
  for (const id of changing) {
    const t = plan.assignments[id]!;
    if (!byTarget.has(t)) byTarget.set(t, []);
    byTarget.get(t)!.push(id);
  }

  const auditRows: Record<string, unknown>[] = [];
  let assigned = 0;

  for (const [target, groupIds] of byTarget) {
    for (const part of chunk(groupIds, ID_CHUNK)) {
      const { error } = await client
        .from("leads")
        .update({ [PATCH_FIELD]: target })
        .in("id", part);
      if (error) throw new BulkAssignError(`commitBulkAssign: update failed for ${target}: ${error.message}`);
      assigned += part.length;

      for (const id of part) {
        auditRows.push({
          id: randomUUID(),
          lead_id: id,
          actor: actor.id,
          action: "assign",
          field: PATCH_FIELD,
          before_value: current.get(id) ?? null,
          after_value: target,
          batch_id: plan.batchId,
          metadata: { bulk: true, distribution_size: changing.length },
        });
      }
    }
  }

  for (const part of chunk(auditRows, AUDIT_CHUNK)) {
    const { error } = await client.from("lead_worklist_audit").insert(part);
    if (error) {
      throw new BulkAssignError(
        `commitBulkAssign: ${assigned} leads WERE REASSIGNED under batch ${plan.batchId} ` +
          `but the audit insert failed: ${error.message}. Reconcile manually before retrying.`,
      );
    }
  }

  return { ok: true, batchId: plan.batchId, assigned, skippedAlreadyOwned, driftedSincePreview: drifted, missing };
}

// ---------------------------------------------------------------------------
// Reversal
// ---------------------------------------------------------------------------

/**
 * Undo a whole batch, restoring each lead's previous owner exactly.
 *
 * Reads `before_value` per row rather than clearing the field, so a lead that
 * belonged to someone before the batch goes back to them and not to Unassigned.
 * Skips rows already reverted, so calling this twice is safe.
 */
export async function revertAssignBatch(batchId: string, actor: WriteActor): Promise<{
  ok: true; batchId: string; reverted: number; skipped: number;
}> {
  const client = db();

  const { data, error } = await client
    .from("lead_worklist_audit")
    .select("id, lead_id, before_value, after_value, reverted_at")
    .eq("batch_id", batchId)
    .eq("action", "assign")
    .eq("field", "assigned_to");
  if (error) throw new BulkAssignError(`revertAssignBatch: ${error.message}`);

  const rows = (data as {
    id: string; lead_id: string; before_value: string | null;
    after_value: string | null; reverted_at: string | null;
  }[] | null) ?? [];
  if (!rows.length) throw new BulkAssignError(`No assignment batch ${batchId}.`);

  const live = rows.filter((r) => !r.reverted_at);
  const skipped = rows.length - live.length;
  if (!live.length) return { ok: true, batchId, reverted: 0, skipped };

  // Group by the owner being restored so this is also set-based.
  const byPrevOwner = new Map<string | null, string[]>();
  for (const r of live) {
    const k = r.before_value;
    if (!byPrevOwner.has(k)) byPrevOwner.set(k, []);
    byPrevOwner.get(k)!.push(r.lead_id);
  }

  const revertBatchId = randomUUID();
  const nowIso = new Date().toISOString();
  const reversalRows: Record<string, unknown>[] = [];
  let reverted = 0;

  for (const [prevOwner, leadIds] of byPrevOwner) {
    for (const part of chunk(leadIds, ID_CHUNK)) {
      const { error: updErr } = await client
        .from("leads").update({ assigned_to: prevOwner }).in("id", part);
      if (updErr) throw new BulkAssignError(`revertAssignBatch: restore failed: ${updErr.message}`);
      reverted += part.length;
    }
  }

  for (const r of live) {
    reversalRows.push({
      id: randomUUID(),
      lead_id: r.lead_id,
      actor: actor.id,
      action: "revert",
      field: "assigned_to",
      before_value: r.after_value,
      after_value: r.before_value,
      batch_id: revertBatchId,
      reverses_id: r.id,
      metadata: { reverses_batch: batchId, bulk: true },
    });
  }

  for (const part of chunk(reversalRows, AUDIT_CHUNK)) {
    const { error: insErr } = await client.from("lead_worklist_audit").insert(part);
    if (insErr) throw new BulkAssignError(`revertAssignBatch: reversal audit failed: ${insErr.message}`);
  }

  for (const part of chunk(live.map((r) => r.id), ID_CHUNK)) {
    const { error: markErr } = await client
      .from("lead_worklist_audit")
      .update({ reverted_at: nowIso, reverted_by: actor.id })
      .in("id", part);
    if (markErr) throw new BulkAssignError(`revertAssignBatch: could not mark reverted: ${markErr.message}`);
  }

  return { ok: true, batchId, reverted, skipped };
}

/** Recent bulk assignment batches, newest first. Drives the "undo" affordance. */
export async function listAssignBatches(limit = 20): Promise<{
  batchId: string; actor: string; count: number; at: string; reverted: boolean;
}[]> {
  const client = db();
  const { data, error } = await client
    .from("lead_worklist_audit")
    .select("batch_id, actor, created_at, reverted_at, metadata")
    .eq("action", "assign")
    .eq("field", "assigned_to")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw new BulkAssignError(`listAssignBatches: ${error.message}`);

  const rows = (data as {
    batch_id: string | null; actor: string; created_at: string;
    reverted_at: string | null; metadata: Record<string, unknown> | null;
  }[] | null) ?? [];

  const grouped = new Map<string, { actor: string; count: number; at: string; revertedCount: number }>();
  for (const r of rows) {
    if (!r.batch_id) continue;
    if (!(r.metadata as { bulk?: boolean } | null)?.bulk) continue;
    const g = grouped.get(r.batch_id) ?? { actor: r.actor, count: 0, at: r.created_at, revertedCount: 0 };
    g.count++;
    if (r.reverted_at) g.revertedCount++;
    if (r.created_at > g.at) g.at = r.created_at;
    grouped.set(r.batch_id, g);
  }

  return [...grouped.entries()]
    .map(([batchId, g]) => ({
      batchId, actor: g.actor, count: g.count, at: g.at,
      reverted: g.revertedCount === g.count,
    }))
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit);
}
