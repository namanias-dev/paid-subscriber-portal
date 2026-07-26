/**
 * PHASE 4 — promoting a legacy lead into the live pipeline.
 *
 * 178,183 legacy leads sit outside the live CRM. Promotion is how one of them
 * becomes a lead the sales pipeline works, and it is the highest-consequence
 * operation in this program: it touches the live-lead surface, which is where a
 * welcome SMS to 178,183 people would come from if anything here were wrong.
 *
 *
 * `is_legacy` IS NOT TOUCHED
 *
 * The obvious implementation flips `is_legacy` to false. This does not, and the
 * reason is worth stating because it looks like extra work.
 *
 *   1. `is_legacy` is provenance — "this person came from the imported sheets,
 *      not the website". That never stops being true. A promoted lead is a
 *      legacy lead being worked, not a lead that was always live, and every
 *      historical count that says 178,183 must keep saying it.
 *   2. `is_legacy` is a GENERATED-ish column maintained by a trigger that fires
 *      on the PRESENCE of `attribution` in an UPDATE's SET list. A later
 *      no-op `SET attribution = attribution` would silently re-derive it. Any
 *      design that depends on `is_legacy` staying flipped is one incidental
 *      write away from flipping back, with no error.
 *   3. Demote becomes a one-column write instead of a re-derivation.
 *
 * So live-pipeline membership is `promoted_at IS NOT NULL`, and `cohort`
 * carries the reporting dimension. Provenance and membership stop being the
 * same bit, which is what makes both reversible.
 *
 *
 * WHY THIS DOES NOT GO THROUGH `applyLeadWrite`
 *
 * `lib/legacy-crm/writes.ts` freezes `status`, `cohort`, `attribution` and
 * `is_legacy` against CRM writes, and that guard should stay exactly as strict
 * as it is — a counsellor clicking around the worklist must never move any of
 * them. Promotion legitimately needs two of those, so it declares its own,
 * narrower contract here rather than widening the one that protects everything
 * else. `PROMOTION_FIELDS` is the complete list, asserted in tests.
 *
 * `status` is in it, deliberately. A legacy lead's `status` is the Phase 0c
 * mapping of the sheet's wording — "Not Replied", "Call Back". Carrying that
 * into the live pipeline would import stale 2023 sheet sentiment straight into
 * this quarter's funnel metrics. Promotion resets it to "New" and records the
 * prior value in the audit, which is what makes demote byte-exact. The verbatim
 * source wording is untouched in `legacy_call_status_raw` and is what the UI
 * shows as context.
 */

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../supabase";
import { normalizeIndianMobile } from "../phone";
import type { WriteActor } from "./writes";

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

/** The complete set of columns promotion or demotion may write. */
export const PROMOTION_FIELDS = [
  "promoted_at",
  "promoted_by",
  "cohort",
  "status",
] as const;

/**
 * Columns promotion must leave byte-identical, asserted rather than assumed.
 *
 * `attribution` is the one that matters most and is easiest to damage: the
 * Payments source pill resolves a buyer's channel from `attribution.first_touch`
 * long after the lead became a customer. A promotion that rewrote the blob —
 * even to "tidy" it — would silently re-attribute historical revenue.
 */
export const PROMOTION_PRESERVED = [
  "phone",
  "name",
  "is_legacy",
  "legacy_call_status_raw",
  "legacy_source_tab",
  "campaign_clean",
  "created_at",
  "attribution",
  "import_batch",
  "import_source",
] as const;

/**
 * NOT a promotion marker, despite the name.
 *
 * Measured in production 2026-07-25: all 178,183 legacy rows already carry
 * `legacy_promoted` and all 1,310 live-captured rows carry `live_captured`. It
 * was set by the Phase 0/1 import and means "came from the sheets" — a
 * provenance dimension, the same axis as `is_legacy`.
 *
 * Anything that treats `cohort = 'legacy_promoted'` as "this lead has been
 * promoted" therefore matches the entire legacy set. Live-pipeline membership
 * is `promoted_at IS NOT NULL`, and only that.
 */
export const COHORT_LEGACY_PROMOTED = "legacy_promoted";
export const PROMOTED_STATUS = "New";

/** Cap on a single bulk promotion. Blast radius, not throughput. */
export const BULK_PROMOTE_MAX = 2_000;
/** Above this, typed confirmation. Lower than assignment's: this one is louder. */
export const PROMOTE_TYPED_CONFIRMATION_THRESHOLD = 500;

export function promoteConfirmationPhraseFor(count: number): string {
  return `PROMOTE ${count}`;
}

export class PromoteError extends Error {
  constructor(message: string) { super(message); this.name = "PromoteError"; }
}

/** Raised when a live lead already exists for this human. */
export class DuplicateLiveLeadError extends PromoteError {
  constructor(readonly existingLeadId: string, readonly digits10: string) {
    super(
      `A live lead already exists for this number. Promoting would create a ` +
        `second live row for one person, so the counsellor works one record while ` +
        `the other collects the replies. Open the existing lead instead.`,
    );
    this.name = "DuplicateLiveLeadError";
  }
}

type AdminClient = NonNullable<ReturnType<typeof getSupabaseAdmin>>;
let _testClient: AdminClient | null = null;

/** TEST-ONLY seam. Never call from application code. */
export function _setPromoteClientForTests(client: unknown): void {
  _testClient = (client as AdminClient | null) ?? null;
}

function db(): AdminClient {
  if (_testClient) return _testClient;
  const c = getSupabaseAdmin();
  if (!c) throw new PromoteError("Supabase admin client unavailable");
  return c;
}

function nowIso() { return new Date().toISOString(); }

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface PromotableLead {
  id: string;
  phone: string | null;
  name: string | null;
  status: string | null;
  cohort: string | null;
  is_legacy: boolean;
  promoted_at: string | null;
  promoted_by: string | null;
  merged_into: string | null;
  legacy_call_status_raw: string | null;
  legacy_source_tab: string | null;
  campaign_clean: string | null;
  created_at: string | null;
  attribution: Record<string, unknown> | null;
  import_batch?: string | null;
  import_source?: string | null;
}

const SELECT_COLS =
  "id, phone, name, status, cohort, is_legacy, promoted_at, promoted_by, merged_into, " +
  "legacy_call_status_raw, legacy_source_tab, campaign_clean, created_at, attribution, " +
  "import_batch, import_source";

export interface PromotePreview {
  leadId: string;
  /** False when something would stop this promotion. */
  ok: boolean;
  /** True when the lead is already promoted — a no-op, not an error. */
  alreadyPromoted: boolean;
  blockedReason: string | null;
  /** Set when a live lead already exists for the same human. */
  duplicateOf: { leadId: string; name: string | null; maskedPhone: string } | null;
  /** What would change, for display before the operator commits. */
  changes: { field: string; from: string | null; to: string | null }[];
}

export interface PromoteResult {
  ok: true;
  leadId: string;
  batchId: string;
  /** False when the lead was already promoted. No audit row is written. */
  changed: boolean;
  auditIds: string[];
}

// ---------------------------------------------------------------------------
// Duplicate safety
// ---------------------------------------------------------------------------

function maskPhone(phone: string | null): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d ? `xxxxxx${d.slice(-4)}` : "(none)";
}

/**
 * Find an ACTIVE live lead for the same human.
 *
 * Phase 0 measured zero collisions across the whole legacy set, so in practice
 * this never fires today. It is enforced anyway, and exercised by a test that
 * constructs a collision, because "there are none right now" is a fact about
 * this afternoon and not a property of the system. Leads arrive continuously
 * from the public site; the first genuine collision will be created by a
 * stranger filling in a form, not by anything in this codebase.
 *
 * Matching is on the normalized 10-digit number via `normalizeIndianMobile`,
 * the same function the SMS layer suppresses on, so "+91 98765 43210",
 * "098765 43210" and "9876543210" are one person here exactly as they are
 * everywhere else. Comparing raw `phone` text would miss all three.
 */
export interface LiveMatch { leadId: string; name: string | null; maskedPhone: string }

/**
 * Every active live lead, keyed by normalized 10-digit number.
 *
 * Built in application code rather than matched in SQL, and that is a
 * deliberate trade rather than laziness.
 *
 * The obvious query is `phone LIKE '%9876543210'`. It is indexable-ish, reads
 * one row, and is WRONG: 4 of the 1,027 live leads are stored as things like
 * "+91 98765 43210", where the ten digits are not contiguous, so the pattern
 * misses them entirely. A duplicate check that silently fails to match is worse
 * than no check, because it reports "clear" and creates the second live row for
 * a real person.
 *
 * Matching properly in SQL needs a normalized column, and a STORED generated
 * column on `leads` rewrites all 179,000 rows under an ACCESS EXCLUSIVE lock.
 * That is a real outage for a table the public site writes to continuously, in
 * exchange for a lookup over what is currently a four-figure row count.
 *
 * So the live universe is pulled and normalized here, through the same
 * `normalizeIndianMobile` the SMS suppression list uses — the two must agree
 * about who is one person. Bounded by construction: never-legacy leads (~1k,
 * growing slowly) plus promoted legacy leads (bounded by promotion's own caps).
 * If promoted volume ever reaches six figures, THAT is the moment to pay for
 * the generated column.
 */
export async function buildLivePhoneIndex(): Promise<Map<string, LiveMatch>> {
  const client = db();
  const index = new Map<string, LiveMatch>();

  const absorb = (rows: {
    id: string; name: string | null; phone: string | null;
  }[]) => {
    for (const r of rows) {
      const n = normalizeIndianMobile(r.phone);
      if (!n.ok || !n.digits10) continue;
      // First writer wins: a never-legacy lead is loaded first and is the more
      // canonical record to send someone to.
      if (!index.has(n.digits10)) {
        index.set(n.digits10, { leadId: r.id, name: r.name, maskedPhone: maskPhone(r.phone) });
      }
    }
  };

  for (const arm of [
    () => client.from("leads").select("id, name, phone")
      .is("merged_into", null).eq("is_legacy", false),
    () => client.from("leads").select("id, name, phone")
      .is("merged_into", null).eq("is_legacy", true).not("promoted_at", "is", null),
  ]) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await arm().order("id", { ascending: true }).range(from, from + 999);
      if (error) throw new PromoteError(`buildLivePhoneIndex: ${error.message}`);
      const page = (data as { id: string; name: string | null; phone: string | null }[] | null) ?? [];
      absorb(page);
      if (page.length < 1000) break;
    }
  }
  return index;
}

/**
 * Find an ACTIVE live lead for the same human.
 *
 * Phase 0 measured zero collisions across the whole legacy set, so in practice
 * this never fires today. It is enforced anyway, and exercised by a test that
 * constructs a collision, because "there are none right now" is a fact about
 * this afternoon and not a property of the system. Leads arrive continuously
 * from the public site; the first genuine collision will be created by a
 * stranger filling in a form, not by anything in this codebase.
 *
 * Pass a prebuilt `index` when checking many leads — the bulk dry run builds it
 * once rather than re-reading the live universe per row.
 */
export async function findActiveLiveDuplicate(
  phone: string | null,
  excludeLeadId?: string,
  index?: Map<string, LiveMatch>,
): Promise<LiveMatch | null> {
  const n = normalizeIndianMobile(phone);
  if (!n.ok || !n.digits10) return null;

  const idx = index ?? (await buildLivePhoneIndex());
  const hit = idx.get(n.digits10);
  if (!hit) return null;
  if (excludeLeadId && hit.leadId === excludeLeadId) return null;
  return hit;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getLead(leadId: string): Promise<PromotableLead | null> {
  const { data, error } = await db()
    .from("leads").select(SELECT_COLS).eq("id", leadId).limit(1);
  if (error) throw new PromoteError(`getLead: ${error.message}`);
  return ((data as unknown as PromotableLead[] | null) ?? [])[0] ?? null;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/** Reads only. Everything that could stop a promotion is decided here. */
export async function previewPromote(leadId: string): Promise<PromotePreview> {
  const lead = await getLead(leadId);
  if (!lead) {
    return {
      leadId, ok: false, alreadyPromoted: false,
      blockedReason: "Lead not found.", duplicateOf: null, changes: [],
    };
  }

  if (lead.merged_into) {
    return {
      leadId, ok: false, alreadyPromoted: false,
      blockedReason: "This lead was merged into another record and is not active.",
      duplicateOf: null, changes: [],
    };
  }

  if (lead.promoted_at) {
    return {
      leadId, ok: true, alreadyPromoted: true,
      blockedReason: null, duplicateOf: null, changes: [],
    };
  }

  if (!lead.is_legacy) {
    return {
      leadId, ok: false, alreadyPromoted: false,
      blockedReason: "This lead is already a live lead; there is nothing to promote.",
      duplicateOf: null, changes: [],
    };
  }

  const dup = await findActiveLiveDuplicate(lead.phone, lead.id);
  if (dup) {
    return {
      leadId, ok: false, alreadyPromoted: false,
      blockedReason:
        `A live lead already exists for ${dup.maskedPhone}. Two live rows for one ` +
        `person means one of them silently stops being worked.`,
      duplicateOf: dup, changes: [],
    };
  }

  return {
    leadId, ok: true, alreadyPromoted: false, blockedReason: null, duplicateOf: null,
    changes: [
      { field: "promoted_at", from: null, to: "(now)" },
      { field: "promoted_by", from: lead.promoted_by, to: "(you)" },
      { field: "cohort", from: lead.cohort, to: COHORT_LEGACY_PROMOTED },
      { field: "status", from: lead.status, to: PROMOTED_STATUS },
    ],
  };
}

// ---------------------------------------------------------------------------
// Promote
// ---------------------------------------------------------------------------

/**
 * Promote one lead. Idempotent, audited, reversible.
 *
 * The duplicate check is re-run here rather than trusted from the preview: a
 * live lead for the same number can be captured by the public site between the
 * two calls, and that is exactly the window in which a real collision arrives.
 */
export async function promoteLead(params: {
  leadId: string;
  actor: WriteActor;
  batchId?: string;
}): Promise<PromoteResult> {
  const { leadId, actor } = params;
  const batchId = params.batchId ?? randomUUID();
  const client = db();

  const lead = await getLead(leadId);
  if (!lead) throw new PromoteError(`Lead ${leadId} not found.`);
  if (lead.merged_into) throw new PromoteError(`Lead ${leadId} is merged and not active.`);

  // Idempotent: a second promote is not a second act.
  if (lead.promoted_at) {
    return { ok: true, leadId, batchId, changed: false, auditIds: [] };
  }
  if (!lead.is_legacy) {
    throw new PromoteError(`Lead ${leadId} is not a legacy lead.`);
  }

  const dup = await findActiveLiveDuplicate(lead.phone, lead.id);
  if (dup) throw new DuplicateLiveLeadError(dup.leadId, maskPhone(lead.phone));

  const at = nowIso();
  const before: Record<string, string | null> = {
    promoted_at: lead.promoted_at,
    promoted_by: lead.promoted_by,
    cohort: lead.cohort,
    status: lead.status,
  };
  const desired: Record<string, string | null> = {
    promoted_at: at,
    promoted_by: actor.id,
    cohort: COHORT_LEGACY_PROMOTED,
    status: PROMOTED_STATUS,
  };

  // Only fields that genuinely move.
  //
  // `cohort` is the reason this matters rather than being tidiness. It reads
  // like a promotion marker and is not one: all 178,183 legacy rows already
  // carry `legacy_promoted`, set by the Phase 0/1 import, where it means "came
  // from the sheets" — the live rows carry `live_captured`. So writing it here
  // is almost always a no-op, and auditing it unconditionally would file a row
  // saying `legacy_promoted -> legacy_promoted` on every promotion.
  //
  // That is not a harmless extra row. This program's audit trail is built on
  // "an audit row means something happened", which is what makes revert safe to
  // replay and what the Phase 3 tests assert. A row recording a change that did
  // not occur erodes exactly that.
  //
  // It is still WRITTEN when it differs, so a legacy row that somehow lacks the
  // cohort gets it, and `promoted_at IS NOT NULL` remains the single honest
  // test for live-pipeline membership.
  const patch: Record<string, string | null> = {};
  for (const f of PROMOTION_FIELDS) {
    if (before[f] !== desired[f]) patch[f] = desired[f];
  }
  assertOnlyPromotionFields(patch);

  // Audit before the change, for the reason set out in bulkAssign.ts: an audit
  // row for a change that did not land reverts to the value already present and
  // is harmless, whereas a change with no audit row cannot be undone at all.
  const auditRows = Object.keys(patch).map((f) => ({
    id: randomUUID(),
    lead_id: leadId,
    actor: actor.id,
    action: "promote",
    field: f,
    before_value: before[f] ?? null,
    after_value: patch[f] ?? null,
    batch_id: batchId,
    metadata: { promotion: true },
  }));

  const { error: auditErr } = await client.from("lead_worklist_audit").insert(auditRows);
  if (auditErr) throw new PromoteError(`promoteLead: audit insert failed: ${auditErr.message}`);

  const { error } = await client.from("leads").update(patch).eq("id", leadId);
  if (error) {
    throw new PromoteError(
      `promoteLead: update failed: ${error.message}. The audit rows for this ` +
        `attempt describe a change that did not land; demoting restores the values ` +
        `already present, which is a no-op.`,
    );
  }

  return { ok: true, leadId, batchId, changed: true, auditIds: auditRows.map((r) => r.id) };
}

// ---------------------------------------------------------------------------
// Demote
// ---------------------------------------------------------------------------

/**
 * Undo a promotion, restoring the exact prior values from the audit.
 *
 * Reads `before_value` rather than assuming what the lead looked like. A legacy
 * lead's `status` before promotion is whatever Phase 0c mapped from its sheet
 * wording — "Not Replied", "Call Back", "Interested" — and there is no default
 * that reconstructs it. Guessing "Not Replied" would be right often enough to
 * look correct and wrong often enough to matter.
 */
export async function demoteLead(params: {
  leadId: string;
  actor: WriteActor;
}): Promise<{ ok: true; leadId: string; changed: boolean; restored: Record<string, string | null> }> {
  const { leadId, actor } = params;
  const client = db();

  const lead = await getLead(leadId);
  if (!lead) throw new PromoteError(`Lead ${leadId} not found.`);
  if (!lead.promoted_at) {
    return { ok: true, leadId, changed: false, restored: {} };
  }

  const { data, error } = await client
    .from("lead_worklist_audit")
    .select("id, field, before_value, after_value, created_at, reverted_at")
    .eq("lead_id", leadId)
    .eq("action", "promote")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new PromoteError(`demoteLead: ${error.message}`);

  const rows = (data as {
    id: string; field: string; before_value: string | null;
    after_value: string | null; created_at: string; reverted_at: string | null;
  }[] | null) ?? [];
  const live = rows.filter((r) => !r.reverted_at);
  if (!live.length) {
    throw new PromoteError(
      `Lead ${leadId} is promoted but has no un-reverted promotion audit rows, so ` +
        `its prior status cannot be restored exactly. Refusing to guess.`,
    );
  }

  // Most recent promotion only: take the first occurrence of each field.
  const restored: Record<string, string | null> = {};
  for (const r of live) {
    if (!(PROMOTION_FIELDS as readonly string[]).includes(r.field)) continue;
    if (!(r.field in restored)) restored[r.field] = r.before_value;
  }
  assertOnlyPromotionFields(restored);

  const revertBatch = randomUUID();
  const reversalRows = Object.entries(restored).map(([field, value]) => ({
    id: randomUUID(),
    lead_id: leadId,
    actor: actor.id,
    action: "demote",
    field,
    before_value: (lead as unknown as Record<string, string | null>)[field] ?? null,
    after_value: value,
    batch_id: revertBatch,
    reverses_id: live.find((r) => r.field === field)?.id ?? null,
    metadata: { promotion: true, demote: true },
  }));

  const { error: insErr } = await client.from("lead_worklist_audit").insert(reversalRows);
  if (insErr) throw new PromoteError(`demoteLead: audit insert failed: ${insErr.message}`);

  const { error: updErr } = await client.from("leads").update(restored).eq("id", leadId);
  if (updErr) throw new PromoteError(`demoteLead: update failed: ${updErr.message}`);

  const ids = live.filter((r) => (PROMOTION_FIELDS as readonly string[]).includes(r.field)).map((r) => r.id);
  if (ids.length) {
    await client.from("lead_worklist_audit")
      .update({ reverted_at: nowIso(), reverted_by: actor.id }).in("id", ids);
  }

  return { ok: true, leadId, changed: true, restored };
}

// ---------------------------------------------------------------------------
// Bulk — DRY RUN
// ---------------------------------------------------------------------------

export interface BulkPromoteFilter {
  sourceTab?: string | null;
  status?: string | null;
  assignedTo?: string | null;
  createdFrom?: string | null;
  createdTo?: string | null;
}

export interface BulkPromoteDryRun {
  /** Minted here and carried into any later execution, as with assignment. */
  batchId: string;
  createdAt: string;
  filter: BulkPromoteFilter;
  /** Matched the filter before any safety check. */
  totalMatched: number;
  /** Would actually promote. THE number the operator approves. */
  totalPromotable: number;
  /** Already promoted — skipped, not re-promoted. */
  totalAlreadyPromoted: number;
  /** Blocked by an existing live lead for the same human. */
  totalDuplicateBlocked: number;
  duplicateSamples: { leadId: string; maskedPhone: string; existingLeadId: string }[];
  perSourceTab: { sourceTab: string; count: number }[];
  perStatus: { status: string; count: number }[];
  capped: boolean;
  requiresTypedConfirmation: boolean;
  confirmationPhrase: string | null;
  /** Exactly what to run to undo it, printed before it is ever executed. */
  rollbackCommand: string;
  warnings: string[];
}

/**
 * Project a bulk promotion WITHOUT performing it.
 *
 * Reads only. There is no code path from this function to an UPDATE, and the
 * execution counterpart is deliberately not exported from this module — bulk
 * promotion is the one operation in this program that requires a human to say
 * yes after seeing real numbers, and a dry run that could accidentally execute
 * would defeat the point of asking.
 *
 * The duplicate check runs per lead against the live set. That is the expensive
 * part and it is not optimised away, because a projected count that skipped it
 * would under-report exactly the rows that matter.
 */
export async function dryRunBulkPromote(params: {
  filter: BulkPromoteFilter;
  limit?: number;
}): Promise<BulkPromoteDryRun> {
  const client = db();
  const limit = Math.min(params.limit ?? BULK_PROMOTE_MAX, BULK_PROMOTE_MAX);
  const f = params.filter ?? {};
  const warnings: string[] = [];

  const build = () => {
    let q = client.from("leads")
      .select("id, phone, status, legacy_source_tab, promoted_at")
      .is("merged_into", null)
      .eq("is_legacy", true);
    if (f.sourceTab) q = q.eq("legacy_source_tab", f.sourceTab);
    if (f.status) q = q.eq("status", f.status);
    if (f.assignedTo) q = q.eq("assigned_to", f.assignedTo);
    if (f.createdFrom) q = q.gte("created_at", f.createdFrom);
    if (f.createdTo) q = q.lte("created_at", f.createdTo);
    return q.order("created_at", { ascending: true }).order("id", { ascending: true });
  };

  // Page — a single request stops at 1,000 and looks complete. Same trap as
  // bulk assignment; see the note in lib/legacy-crm/bulkAssign.ts.
  const rows: {
    id: string; phone: string | null; status: string | null;
    legacy_source_tab: string | null; promoted_at: string | null;
  }[] = [];
  for (let from = 0; rows.length <= limit; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new PromoteError(`dryRunBulkPromote: ${error.message}`);
    const page = (data as typeof rows | null) ?? [];
    rows.push(...page);
    if (page.length < 1000) break;
  }

  const capped = rows.length > limit;
  const considered = rows.slice(0, limit);
  if (capped) {
    warnings.push(
      `More than ${limit} leads match. Only the oldest ${limit} are in this projection.`,
    );
  }

  let alreadyPromoted = 0;
  let duplicateBlocked = 0;
  const duplicateSamples: BulkPromoteDryRun["duplicateSamples"] = [];
  const bySourceTab = new Map<string, number>();
  const byStatus = new Map<string, number>();
  let promotable = 0;

  // Built once. Per-lead it would re-read the whole live universe per row.
  const liveIndex = await buildLivePhoneIndex();

  for (const r of considered) {
    if (r.promoted_at) { alreadyPromoted++; continue; }
    const dup = await findActiveLiveDuplicate(r.phone, r.id, liveIndex);
    if (dup) {
      duplicateBlocked++;
      if (duplicateSamples.length < 20) {
        duplicateSamples.push({
          leadId: r.id, maskedPhone: maskPhone(r.phone), existingLeadId: dup.leadId,
        });
      }
      continue;
    }
    promotable++;
    const tab = r.legacy_source_tab ?? "Legacy — no source tab";
    bySourceTab.set(tab, (bySourceTab.get(tab) ?? 0) + 1);
    const st = r.status ?? "(none)";
    byStatus.set(st, (byStatus.get(st) ?? 0) + 1);
  }

  const batchId = randomUUID();
  if (duplicateBlocked > 0) {
    warnings.push(
      `${duplicateBlocked} lead(s) already have a live record for the same number ` +
        `and are excluded. Promoting them would create two live rows for one person.`,
    );
  }

  return {
    batchId,
    createdAt: nowIso(),
    filter: f,
    totalMatched: considered.length,
    totalPromotable: promotable,
    totalAlreadyPromoted: alreadyPromoted,
    totalDuplicateBlocked: duplicateBlocked,
    duplicateSamples,
    perSourceTab: [...bySourceTab.entries()]
      .map(([sourceTab, count]) => ({ sourceTab, count }))
      .sort((a, b) => b.count - a.count),
    perStatus: [...byStatus.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    capped,
    requiresTypedConfirmation: promotable > PROMOTE_TYPED_CONFIRMATION_THRESHOLD,
    confirmationPhrase: promotable > PROMOTE_TYPED_CONFIRMATION_THRESHOLD
      ? promoteConfirmationPhraseFor(promotable) : null,
    rollbackCommand:
      `node --import tsx --env-file=.env.local scripts/qa/demote-batch.ts ${batchId}`,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/**
 * Refuse a patch touching anything outside `PROMOTION_FIELDS`.
 *
 * The mirror of `assertNoFrozenFieldWrite`. That one protects the CRM write
 * path from ever reaching provenance; this one keeps promotion — which is
 * allowed two of those columns — from quietly growing a third.
 */
export function assertOnlyPromotionFields(patch: Record<string, unknown>): void {
  for (const key of Object.keys(patch)) {
    if (!(PROMOTION_FIELDS as readonly string[]).includes(key)) {
      throw new PromoteError(
        `Refusing to write "${key}" during promotion. Promotion may only touch ` +
          `${PROMOTION_FIELDS.join(", ")}. Everything else on a legacy lead is ` +
          `history, and promotion does not rewrite history.`,
      );
    }
  }
}
