/**
 * PHASE 2 — per-lead WRITE actions for the Lead CRM.
 *
 * This is what replaces the Google Sheet. Every action here is:
 *   AUDITED     — who / what / when / before / after, in lead_worklist_audit
 *   IDEMPOTENT  — re-applying the same value is a no-op, not a second audit row
 *   REVERSIBLE  — every audit row can be replayed backwards by `revertWrite`
 *   BATCH-TAGGED— one batch_id per call, so Phase 3 bulk ops reverse as a unit
 *
 * =====================================================================
 * THE INVARIANT THIS MODULE EXISTS TO ENFORCE
 * =====================================================================
 * `work_status` IS A SEPARATE FIELD from BOTH:
 *
 *   `status`                 — the FROZEN Phase 0c mapped LeadStatus. Rewriting
 *                              it retroactively moves leads between historical
 *                              reporting buckets, which is the exact thing
 *                              freezing it prevented.
 *
 *   `legacy_call_status_raw` — the team's OWN verbatim wording from the source
 *                              sheet, on all 178,183 rows. The team trusts this
 *                              text. It is displayed, never parsed, and NEVER
 *                              written.
 *
 * Both stay visible in the lead drawer as history, forever. `WRITABLE_FIELDS`
 * below is an allow-list, and `assertNoFrozenFieldWrite` re-checks the built
 * patch immediately before it is sent — belt and braces, because a leak here
 * is silent and permanent.
 */

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../supabase";
// The opt-out SUPPRESSION writer — not a sender. `lib/sms/store` holds the
// compliance table that every send path screens against; `markOptedOut` has to
// write it or the opt-out is decorative. Nothing that can transmit a message is
// imported here, and `tests/legacy-crm-phase2/phase2-guardrails.test.ts` pins
// that distinction by name.
import { addOptOut } from "../sms/store";
import type { LeadWorkStatus } from "../types";

/**
 * Columns a CRM write may touch. Anything absent is unreachable from this
 * module by construction.
 *
 * `status` and `legacy_call_status_raw` are deliberately, permanently absent.
 */
export const WRITABLE_FIELDS = [
  "work_status",
  "work_status_at",
  "work_status_by",
  "assigned_to",
  "follow_up_at",
  "last_contacted_at",
  "contact_attempt_count",
  "last_worked_at",
  "suppression_reason",
  "consent_status",
  "opted_out_at",
  "dnd_status",
  "worklist_queue",
] as const;

export type WritableField = (typeof WRITABLE_FIELDS)[number];

/**
 * Fields no CRM write may EVER touch.
 *
 * Not merely "not in the allow-list" — named explicitly so the guard produces a
 * diagnostic that says WHY, and so a future edit that adds one of these to
 * WRITABLE_FIELDS fails loudly at runtime and in tests instead of silently
 * destroying history.
 */
export const FROZEN_FIELDS = [
  "status",
  "legacy_call_status",
  "legacy_call_status_raw",
  "cohort",
  "is_legacy",
  "created_at",
  "first_seen_at",
  "import_batch",
  "import_source",
  "attribution",
  "phone",
] as const;

export class FrozenFieldWriteError extends Error {
  constructor(field: string) {
    super(
      `Refusing to write frozen field "${field}". ` +
        (field === "legacy_call_status_raw"
          ? "This is the team's verbatim source-sheet wording, preserved on all 178,183 legacy rows. It is history and is never overwritten — move `work_status` instead."
          : field === "status"
            ? "This is the FROZEN Phase 0c mapped status. Rewriting it retroactively moves leads between historical reporting buckets — move `work_status` instead."
            : "This field is immutable provenance."),
    );
    this.name = "FrozenFieldWriteError";
  }
}

/** Throws if a built patch would touch anything frozen. */
export function assertNoFrozenFieldWrite(patch: Record<string, unknown>): void {
  for (const key of Object.keys(patch)) {
    if ((FROZEN_FIELDS as readonly string[]).includes(key)) throw new FrozenFieldWriteError(key);
    if (!(WRITABLE_FIELDS as readonly string[]).includes(key)) {
      throw new Error(
        `Refusing to write "${key}": not in WRITABLE_FIELDS. Add it there deliberately, ` +
          `after checking it is not frozen provenance.`,
      );
    }
  }
}

export type WriteAction =
  | "work_status"
  | "assign"
  | "follow_up"
  | "wrong_number"
  | "unreachable"
  | "opt_out"
  | "contact_attempt"
  | "note"
  | "revert";

/**
 * Actions an OPERATOR can take from a script, which are deliberately NOT
 * reachable from any API route.
 *
 * The separation is the point. `note_retract` removes a note, and notes are
 * append-only on purpose — a counsellor's record of what a lead said is
 * evidence, and evidence that can be quietly deleted from the UI is not
 * evidence. But an operator still needs a way to pull a note that should never
 * have existed (QA residue, a note filed against the wrong person, content that
 * has to come out), and that removal must itself leave a trace.
 *
 * `tests/legacy-crm-phase2/phase2-guardrails.test.ts` asserts that no route
 * accepts any member of this union.
 */
export type OperatorAction = "note_retract";

/** Anything that can appear in `lead_worklist_audit.action`. */
export type AuditAction = WriteAction | OperatorAction;

export interface WriteActor {
  id: string;
  name?: string | null;
}

export interface WriteResult {
  ok: true;
  /** False when the value was already what was asked for. No audit row is written. */
  changed: boolean;
  /** Batch tag for this call. Phase 3 reuses one batch_id across many leads. */
  batchId: string;
  /** Audit row ids created. Empty when `changed` is false. */
  auditIds: string[];
}

/** An audit row as the drawer renders it. */
export interface LeadAuditEntry {
  id: string;
  lead_id: string;
  actor: string;
  action: string;
  field: string | null;
  before_value: string | null;
  after_value: string | null;
  batch_id: string | null;
  reverses_id: string | null;
  reverted_at: string | null;
  reverted_by: string | null;
  created_at: string;
}

type AdminClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

let _testClient: AdminClient | null = null;

/**
 * TEST-ONLY seam. Never call this from application code.
 *
 * It exists so the write paths can be exercised behaviourally — the emitted
 * operations, their order, and what happens when one of them fails — without
 * pointing a test at production. Phase 2 QA verified writes by mutating real
 * legacy leads and reverting them afterwards; the reverts were complete, but
 * briefly flipping `wrong_number` or `opt_out` on a real person's record is a
 * risk worth removing rather than managing.
 *
 * Note that `addOptOut`/`optedOutSet` in `lib/sms/store` are NOT routed through
 * this seam. They fall back to an in-memory store when the Supabase env vars
 * are absent, so a test run without credentials exercises the real suppression
 * code against real logic and no real data.
 */
export function _setWritesClientForTests(client: unknown): void {
  _testClient = (client as AdminClient | null) ?? null;
}

function db(): AdminClient {
  if (_testClient) return _testClient;
  const c = getSupabaseAdmin();
  if (!c) throw new Error("Supabase admin client unavailable");
  return c;
}

/**
 * Apply a field patch to one lead, audited and idempotent.
 *
 * Reads the current values FIRST so the audit row records a real `before`, not
 * an assumed one. If every field already holds the requested value the write is
 * skipped entirely — re-clicking "mark unreachable" must not produce a second
 * audit row implying a second action.
 */
export async function applyLeadWrite(params: {
  leadId: string;
  action: WriteAction;
  patch: Partial<Record<WritableField, string | number | null>>;
  actor: WriteActor;
  batchId?: string;
  metadata?: Record<string, unknown>;
}): Promise<WriteResult> {
  const { leadId, action, patch, actor } = params;
  const batchId = params.batchId ?? randomUUID();

  assertNoFrozenFieldWrite(patch);

  const fields = Object.keys(patch) as WritableField[];
  if (fields.length === 0) return { ok: true, changed: false, batchId, auditIds: [] };

  const client = db();

  // BEFORE. Also proves the lead exists — writing to a missing id must 404,
  // not silently succeed against zero rows.
  const { data: beforeRows, error: readErr } = await client
    .from("leads")
    .select(["id", ...fields].join(","))
    .eq("id", leadId)
    .limit(1);
  if (readErr) throw new Error(`applyLeadWrite: could not read lead ${leadId}: ${readErr.message}`);
  const before = (beforeRows as unknown as Record<string, unknown>[] | null)?.[0];
  if (!before) throw new LeadNotFoundError(leadId);

  // IDEMPOTENCE. Compare as strings so a Date and its ISO form agree.
  const changedFields = fields.filter((f) => norm(before[f]) !== norm(patch[f]));
  if (changedFields.length === 0) {
    return { ok: true, changed: false, batchId, auditIds: [] };
  }

  const effectivePatch: Record<string, unknown> = {};
  for (const f of changedFields) effectivePatch[f] = patch[f];
  assertNoFrozenFieldWrite(effectivePatch);

  const { error: updErr } = await client.from("leads").update(effectivePatch).eq("id", leadId);
  if (updErr) throw new Error(`applyLeadWrite: update failed for ${leadId}: ${updErr.message}`);

  // AUDIT — one row per field, so a partial revert is possible.
  const auditRows = changedFields.map((f) => ({
    id: randomUUID(),
    lead_id: leadId,
    actor: actor.id,
    action,
    field: f,
    before_value: before[f] === null || before[f] === undefined ? null : String(before[f]),
    after_value: patch[f] === null || patch[f] === undefined ? null : String(patch[f]),
    batch_id: batchId,
    metadata: params.metadata ?? {},
  }));
  const { error: auditErr } = await client.from("lead_worklist_audit").insert(auditRows);
  if (auditErr) {
    // The write landed but the audit did not. Say so loudly: an unaudited
    // write is exactly the state this program refuses to be in.
    throw new Error(
      `applyLeadWrite: lead ${leadId} WAS UPDATED but the audit insert failed: ${auditErr.message}. ` +
        `Fields changed: ${changedFields.join(", ")}. Reconcile manually.`,
    );
  }

  return { ok: true, changed: true, batchId, auditIds: auditRows.map((r) => r.id) };
}

export class LeadNotFoundError extends Error {
  constructor(id: string) {
    super(`Lead ${id} not found`);
    this.name = "LeadNotFoundError";
  }
}

function norm(v: unknown): string {
  if (v === null || v === undefined) return "\u0000null";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

// =====================================================================
// The concrete actions the UI offers.
// =====================================================================

const nowIso = () => new Date().toISOString();

/** Move the counsellor working status. NEVER touches `status`. */
export function setWorkStatus(leadId: string, value: LeadWorkStatus, actor: WriteActor, batchId?: string) {
  return applyLeadWrite({
    leadId,
    action: "work_status",
    patch: { work_status: value, work_status_at: nowIso(), work_status_by: actor.id, last_worked_at: nowIso() },
    actor,
    batchId,
  });
}

/**
 * Assign or reassign. `null` unassigns.
 *
 * Kept as a first-class audited action rather than a UI convenience because
 * Phase 3 is bulk assignment: it will call this with a shared `batchId` so an
 * entire round-robin can be previewed, committed, and reversed as one unit.
 */
export function assignLead(leadId: string, assignee: string | null, actor: WriteActor, batchId?: string) {
  return applyLeadWrite({ leadId, action: "assign", patch: { assigned_to: assignee }, actor, batchId });
}

/** Set or clear the follow-up date. */
export function setFollowUp(leadId: string, whenIso: string | null, actor: WriteActor, batchId?: string) {
  return applyLeadWrite({ leadId, action: "follow_up", patch: { follow_up_at: whenIso }, actor, batchId });
}

/**
 * Mark wrong number / unreachable.
 *
 * Writes `work_status` + `suppression_reason`. It does NOT edit `phone` — a
 * wrong number is a fact ABOUT the record, and destroying the number would
 * destroy the evidence and break de-duplication against future imports.
 */
export function markWrongNumber(leadId: string, actor: WriteActor, batchId?: string) {
  return applyLeadWrite({
    leadId,
    action: "wrong_number",
    patch: {
      work_status: "wrong_number",
      work_status_at: nowIso(),
      work_status_by: actor.id,
      suppression_reason: "wrong_number",
      last_worked_at: nowIso(),
    },
    actor,
    batchId,
  });
}

export function markUnreachable(leadId: string, actor: WriteActor, batchId?: string) {
  return applyLeadWrite({
    leadId,
    action: "unreachable",
    patch: {
      work_status: "not_reachable",
      work_status_at: nowIso(),
      work_status_by: actor.id,
      suppression_reason: "unreachable",
      last_worked_at: nowIso(),
    },
    actor,
    batchId,
  });
}

/**
 * Mark opted out.
 *
 * THE ENFORCEMENT LIVES IN `sms_opt_outs`, NOT IN `leads.consent_status`.
 * An earlier version of this function set `consent_status` alone, with a comment
 * claiming that was "the field every SMS audience gates on". That was wrong.
 * `consent_status` is read by nothing on any send path — every one of them
 * (`sendSms`, `sendBatch`, and `applySuppression` on every resolved audience)
 * screens against `sms_opt_outs` via `optedOutSet`/`isOptedOut`. Writing only
 * the lead column produced the worst possible outcome: the drawer, the audit
 * trail and the counsellor all reported the person as opted out while the next
 * campaign would still have sent to them.
 *
 * So this writes the suppression row FIRST and refuses to continue if it fails.
 * The ordering is deliberate: if the suppression lands and the lead update then
 * fails, the person is still protected and the UI just looks stale. The reverse
 * order fails towards sending a message to someone who asked not to receive
 * one, which is not a failure mode this action is allowed to have.
 *
 * `consent_status` is set to `'withdrawn'` — the member of `ConsentStatus` that
 * means this. The previous `'opted_out'` string is not in that union at all, and
 * because the column carries no CHECK constraint it stored silently, leaving the
 * type lying about its own domain.
 *
 * NOT SYMMETRICAL ON REVERT, BY DESIGN. Reverting this audit entry restores the
 * lead columns but deliberately leaves the `sms_opt_outs` row in place. Undoing
 * a consent withdrawal is a compliance decision, not a mis-click correction, and
 * must go through the SMS opt-out admin surface where it is visible as such.
 */
export async function markOptedOut(leadId: string, actor: WriteActor, batchId?: string) {
  const client = db();
  const { data, error } = await client
    .from("leads")
    .select("phone")
    .eq("id", leadId)
    .limit(1);
  if (error) throw new Error(`markOptedOut: could not read lead ${leadId}: ${error.message}`);
  const row = (data as { phone: string | null }[] | null)?.[0];
  if (!row) throw new LeadNotFoundError(leadId);

  // `addOptOut` normalises to the last 10 digits and fails closed by returning
  // false — it never throws — so the result has to be checked explicitly.
  const suppressed = await addOptOut(
    row.phone ?? "",
    "Opted out from the lead worklist",
    "lead_worklist",
    actor.id,
  );
  if (!suppressed) {
    throw new Error(
      `markOptedOut: refusing to record an opt-out for ${leadId} because the ` +
        `sms_opt_outs suppression row could not be written. Nothing was changed. ` +
        `Reporting success here would tell a counsellor this person is protected ` +
        `when they are not.`,
    );
  }

  return applyLeadWrite({
    leadId,
    action: "opt_out",
    patch: {
      work_status: "opted_out",
      work_status_at: nowIso(),
      work_status_by: actor.id,
      consent_status: "withdrawn",
      opted_out_at: nowIso(),
      suppression_reason: "opted_out",
      last_worked_at: nowIso(),
    },
    actor,
    batchId,
    metadata: { suppression_table: "sms_opt_outs", suppression_source: "lead_worklist" },
  });
}

/** Record that a contact attempt happened. */
export async function recordContactAttempt(leadId: string, actor: WriteActor) {
  const client = db();
  const { data, error } = await client
    .from("leads")
    .select("contact_attempt_count")
    .eq("id", leadId)
    .limit(1);
  if (error) throw new Error(`recordContactAttempt: ${error.message}`);
  const row = (data as { contact_attempt_count: number | null }[] | null)?.[0];
  if (!row) throw new LeadNotFoundError(leadId);
  return applyLeadWrite({
    leadId,
    // Audited as itself, not as a work-status change. The audit trail is the
    // artefact this program keeps insisting must be trustworthy, and a logged
    // call attempt showing up in the drawer's history labelled "work status"
    // misrepresents what the counsellor actually did.
    action: "contact_attempt",
    patch: {
      last_contacted_at: nowIso(),
      contact_attempt_count: (row.contact_attempt_count ?? 0) + 1,
      last_worked_at: nowIso(),
    },
    actor,
  });
}

// =====================================================================
// Notes — a child table, never a column on `leads`.
// =====================================================================

/**
 * Append a note. Reuses the existing `lead_notes` table (id, lead_id, author,
 * body, created_at), which already carries the author + timestamp the
 * requirement asks for and is already indexed (lead_id, created_at desc).
 *
 * Notes are APPEND-ONLY. There is no edit and no delete: a counsellor's record
 * of what a lead said is evidence, and evidence that can be quietly rewritten
 * is not evidence.
 */
export async function addLeadNote(params: {
  leadId: string;
  body: string;
  actor: WriteActor;
}): Promise<{ ok: true; id: string }> {
  const body = params.body.trim();
  if (!body) throw new Error("A note cannot be empty.");
  if (body.length > 5000) throw new Error("A note cannot exceed 5000 characters.");

  const client = db();
  const { data: leadRows, error: leadErr } = await client
    .from("leads")
    .select("id")
    .eq("id", params.leadId)
    .limit(1);
  if (leadErr) throw new Error(`addLeadNote: ${leadErr.message}`);
  if (!(leadRows as unknown[] | null)?.length) throw new LeadNotFoundError(params.leadId);

  const id = randomUUID();
  const { error } = await client.from("lead_notes").insert({
    id,
    lead_id: params.leadId,
    author: params.actor.id,
    body,
  });
  if (error) throw new Error(`addLeadNote: ${error.message}`);

  // Audited too, so the drawer's single timeline shows notes alongside status
  // changes in one ordering. The body is referenced, not duplicated.
  await client.from("lead_worklist_audit").insert({
    id: randomUUID(),
    lead_id: params.leadId,
    actor: params.actor.id,
    action: "note",
    field: "note",
    before_value: null,
    after_value: body.slice(0, 120),
    batch_id: randomUUID(),
    metadata: { note_id: id },
  });

  return { ok: true, id };
}

// =====================================================================
// Reversal
// =====================================================================

/**
 * Reverse a previously audited write by replaying its `before_value`.
 *
 * The reversal is itself an audited row carrying `reverses_id`, and the
 * original is marked `reverted_at` / `reverted_by` rather than deleted. History
 * is append-only: you can always see that something was done AND undone, which
 * is strictly more informative than seeing neither.
 */
export async function revertWrite(auditId: string, actor: WriteActor): Promise<WriteResult> {
  const client = db();
  const { data, error } = await client
    .from("lead_worklist_audit")
    .select("id, lead_id, action, field, before_value, after_value, reverted_at")
    .eq("id", auditId)
    .limit(1);
  if (error) throw new Error(`revertWrite: ${error.message}`);
  const entry = (data as LeadAuditEntry[] | null)?.[0];
  if (!entry) throw new Error(`revertWrite: audit row ${auditId} not found`);
  if (entry.reverted_at) throw new Error(`revertWrite: audit row ${auditId} was already reverted`);
  if (!entry.field || entry.action === "note") {
    throw new Error(
      `revertWrite: action "${entry.action}" is not reversible. Notes are append-only evidence.`,
    );
  }

  const field = entry.field as WritableField;
  const batchId = randomUUID();
  const result = await applyLeadWrite({
    leadId: entry.lead_id,
    action: "revert",
    patch: { [field]: entry.before_value } as Partial<Record<WritableField, string | null>>,
    actor,
    batchId,
    metadata: { reverses: auditId },
  });

  await client
    .from("lead_worklist_audit")
    .update({ reverted_at: nowIso(), reverted_by: actor.id })
    .eq("id", auditId);

  if (result.auditIds.length) {
    await client
      .from("lead_worklist_audit")
      .update({ reverses_id: auditId })
      .in("id", result.auditIds);
  }

  return result;
}

/**
 * Retract a note. OPERATOR ONLY — no route reaches this, by design.
 *
 * Notes are append-only for counsellors (see `addLeadNote`). This is the escape
 * hatch for a note that should never have been filed at all, and it is
 * deliberately awkward to reach: it needs a written reason, and it records what
 * it removed before removing it.
 *
 * The audit entry keeps the note's id, author and timestamp, and a 120-char
 * excerpt of the body, so the trail shows that something was retracted and by
 * whom rather than silently losing a row. The excerpt is capped because the
 * point is accountability, not preserving the content the retraction removed.
 */
export async function retractLeadNote(params: {
  noteId: string;
  actor: WriteActor;
  reason: string;
}): Promise<{ ok: true; leadId: string }> {
  const reason = params.reason.trim();
  if (!reason) throw new Error("Retracting a note requires a written reason.");

  const client = db();
  const { data, error } = await client
    .from("lead_notes")
    .select("id, lead_id, author, body, created_at")
    .eq("id", params.noteId)
    .limit(1);
  if (error) throw new Error(`retractLeadNote: ${error.message}`);
  const note = (data as {
    id: string; lead_id: string; author: string | null; body: string; created_at: string;
  }[] | null)?.[0];
  if (!note) throw new Error(`retractLeadNote: no note ${params.noteId}`);

  // Audit BEFORE the delete. If the delete then fails we have a spurious audit
  // row, which is noisy but harmless; the reverse order can lose the record of
  // what was removed entirely, which defeats the purpose of the function.
  const { error: auditErr } = await client.from("lead_worklist_audit").insert({
    id: randomUUID(),
    lead_id: note.lead_id,
    actor: params.actor.id,
    action: "note_retract" satisfies OperatorAction,
    field: "note",
    before_value: note.body.slice(0, 120),
    after_value: null,
    batch_id: randomUUID(),
    metadata: {
      note_id: note.id,
      note_author: note.author,
      note_created_at: note.created_at,
      reason,
    },
  });
  if (auditErr) throw new Error(`retractLeadNote: audit failed, nothing removed: ${auditErr.message}`);

  const { error: delErr } = await client.from("lead_notes").delete().eq("id", params.noteId);
  if (delErr) throw new Error(`retractLeadNote: ${delErr.message}`);

  return { ok: true, leadId: note.lead_id };
}

/** The audit trail for one lead, newest first. Drives the drawer timeline. */
export async function getLeadAudit(leadId: string, limit = 100): Promise<LeadAuditEntry[]> {
  const client = db();
  const { data, error } = await client
    .from("lead_worklist_audit")
    .select("id, lead_id, actor, action, field, before_value, after_value, batch_id, reverses_id, reverted_at, reverted_by, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 500));
  if (error) throw new Error(`getLeadAudit: ${error.message}`);
  return (data as LeadAuditEntry[] | null) ?? [];
}

/** Notes for one lead, newest first. */
export async function getLeadNotes(leadId: string, limit = 100) {
  const client = db();
  const { data, error } = await client
    .from("lead_notes")
    .select("id, lead_id, author, body, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 500));
  if (error) throw new Error(`getLeadNotes: ${error.message}`);
  return (data as { id: string; lead_id: string; author: string | null; body: string; created_at: string }[] | null) ?? [];
}
