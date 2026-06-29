import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "./supabase";
import { isPaidStatus } from "./paymentsAgg";
import { groupKeyOf } from "./paymentGroups";
import type { Payment } from "./types";

/**
 * ============================================================================
 *  PAYMENT SUPERSESSION (write-side) — auto-flag moot unpaid attempts.
 *
 *  When an attempt becomes PAID / proof-accepted, the OTHER open unpaid attempts
 *  for the SAME group (phone + item_type + item + purpose) are flagged
 *  is_superseded = true. Their real status is NEVER changed. This is derived,
 *  idempotent and self-correcting:
 *    • runs from the single verified-PAID chokepoint (recordPaymentPaid), so it
 *      fires for ICICI callback / verify / cron / manual approve / proof-accept
 *      / free / offline alike — exactly once per payment becoming paid.
 *    • if a group has NO paid attempt (e.g. a paid attempt was later reversed),
 *      any stale supersession is CLEARED so the group re-derives correctly.
 *    • two PAID attempts in one group are NEVER auto-superseded — that is real
 *      money and is surfaced as a "possible duplicate payment" flag for a human.
 *
 *  Audit reuses the existing payment_action_log ledger (action 'supersede' /
 *  'unsupersede'); no new ledger table.
 * ============================================================================
 */

const SUPERSEDE_REASON = "Another attempt for the same student/item was paid or approved";

export interface SupersedeActor {
  id: string;
  name: string | null;
  role: string | null;
  isSuper: boolean;
}

export const SYSTEM_ACTOR: SupersedeActor = { id: "system", name: "System (auto)", role: "system", isSuper: false };

function nowISO(): string {
  return new Date().toISOString();
}

/** Lean, self-contained ledger insert (avoids a dependency cycle with paymentActions). */
async function logLedger(
  db: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  input: {
    action: "supersede" | "unsupersede";
    payment: Payment;
    actor: SupersedeActor;
    reason: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await db.from("payment_action_log").insert({
      id: randomUUID(),
      action: input.action,
      payment_id: input.payment.id,
      reference_no: input.payment.reference_no ?? null,
      enrollment_id: input.payment.enrollment_id ?? null,
      student_id: null,
      phone: input.payment.phone ?? null,
      actor_id: input.actor.id,
      actor_name: input.actor.name,
      actor_role: input.actor.role,
      actor_is_super: input.actor.isSuper,
      old_status: input.payment.status,
      new_status: input.payment.status, // status is intentionally unchanged
      reason: input.reason,
      files: [],
      file_count: 0,
      metadata: input.metadata,
      created_at: nowISO(),
    });
  } catch {
    /* audit is best-effort; supersession itself must not fail on a log error */
  }
}

export interface RecomputeResult {
  superseded: number;
  cleared: number;
  groupKey: string;
  paidCount: number;
}

/**
 * Recompute supersession for the ONE group that `trigger` belongs to. Idempotent.
 * Touches no other item/purpose. Returns how many attempts were newly flagged or
 * cleared.
 */
export async function recomputeGroupSupersession(
  trigger: Payment,
  actor: SupersedeActor = SYSTEM_ACTOR,
): Promise<RecomputeResult> {
  const db = getSupabaseAdmin();
  const groupKey = groupKeyOf(trigger);
  const empty: RecomputeResult = { superseded: 0, cleared: 0, groupKey, paidCount: 0 };
  if (!db) return empty;

  const phone = (trigger.phone || "").trim();
  if (!phone) return empty;

  const { data } = await db
    .from("payments")
    .select("*")
    .eq("phone", phone)
    .is("deleted_at", null);
  const rows = (data as Payment[]) ?? [];
  const group = rows.filter((r) => groupKeyOf(r) === groupKey);
  if (!group.length) return empty;

  const paid = group.filter((p) => isPaidStatus(p.status));

  // --- No paid attempt: clear any stale supersession so the group re-derives. ---
  if (paid.length === 0) {
    const toClear = group.filter((p) => p.is_superseded);
    for (const p of toClear) {
      await db
        .from("payments")
        .update({ is_superseded: false, superseded_by_payment_id: null, superseded_at: null, superseded_reason: null })
        .eq("id", p.id);
      await logLedger(db, {
        action: "unsupersede",
        payment: p,
        actor,
        reason: "No paid attempt remains in this group — supersession cleared.",
        metadata: { group_key: groupKey },
      });
    }
    return { superseded: 0, cleared: toClear.length, groupKey, paidCount: 0 };
  }

  // --- Paid exists: flag the open unpaid attempts as superseded (idempotent). ---
  // Never auto-supersede a PAID row (two paids = surfaced as duplicate flag).
  const anchor = [...paid].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
  const toSupersede = group.filter((p) => !isPaidStatus(p.status) && !p.is_superseded);
  for (const p of toSupersede) {
    await db
      .from("payments")
      .update({
        is_superseded: true,
        superseded_by_payment_id: anchor.id,
        superseded_at: nowISO(),
        superseded_reason: SUPERSEDE_REASON,
      })
      .eq("id", p.id)
      .not("status", "in", "(captured,PAID)"); // hard-guard: never touch a paid row
    await logLedger(db, {
      action: "supersede",
      payment: p,
      actor,
      reason: SUPERSEDE_REASON,
      metadata: { group_key: groupKey, superseded_by_payment_id: anchor.id, paid_count: paid.length },
    });
  }
  return { superseded: toSupersede.length, cleared: 0, groupKey, paidCount: paid.length };
}

/**
 * Fire-and-forget auto-supersede from the verified-PAID chokepoint. Best-effort:
 * never throws so it can be safely `void`-ed inside recordPaymentPaid.
 */
export async function supersedeUnpaidSiblings(paid: Payment): Promise<void> {
  try {
    await recomputeGroupSupersession(paid, SYSTEM_ACTOR);
  } catch {
    /* best-effort */
  }
}

// ----------------------------- Backfill (safe, dry-run first) -----------------------------

export interface BackfillGroupChange {
  group_key: string;
  phone: string;
  item: string;
  paid_count: number;
  superseded_payment_ids: string[];
}

export interface BackfillReport {
  apply: boolean;
  groupsScanned: number;
  groupsAffected: number;
  attemptsToSupersede: number;
  duplicatePaidGroups: number;
  changes: BackfillGroupChange[];
}

/**
 * Scan EVERY group across all live payments and, where a group has ≥1 paid
 * attempt and ≥1 open unpaid attempt, mark the unpaid ones superseded. Dry-run
 * by default (apply=false) — reports exactly what WOULD change without writing.
 * Never deletes; never touches paid rows; logs each applied change.
 */
export async function backfillSupersession(opts: { apply: boolean }): Promise<BackfillReport> {
  const db = getSupabaseAdmin();
  const report: BackfillReport = {
    apply: opts.apply,
    groupsScanned: 0,
    groupsAffected: 0,
    attemptsToSupersede: 0,
    duplicatePaidGroups: 0,
    changes: [],
  };
  if (!db) return report;

  const { data } = await db.from("payments").select("*").is("deleted_at", null);
  const rows = (data as Payment[]) ?? [];

  const byKey = new Map<string, Payment[]>();
  for (const p of rows) {
    const k = groupKeyOf(p);
    const arr = byKey.get(k);
    if (arr) arr.push(p);
    else byKey.set(k, [p]);
  }
  report.groupsScanned = byKey.size;

  for (const [groupKey, group] of byKey) {
    const paid = group.filter((p) => isPaidStatus(p.status));
    if (paid.length === 0) continue;
    if (paid.length >= 2) report.duplicatePaidGroups += 1;
    const toSupersede = group.filter((p) => !isPaidStatus(p.status) && !p.is_superseded);
    if (!toSupersede.length) continue;

    report.groupsAffected += 1;
    report.attemptsToSupersede += toSupersede.length;
    const sample = toSupersede[0];
    report.changes.push({
      group_key: groupKey,
      phone: (sample.phone || "").trim(),
      item: sample.item || "",
      paid_count: paid.length,
      superseded_payment_ids: toSupersede.map((p) => p.id),
    });

    if (opts.apply) {
      const anchor = [...paid].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
      for (const p of toSupersede) {
        await db
          .from("payments")
          .update({
            is_superseded: true,
            superseded_by_payment_id: anchor.id,
            superseded_at: nowISO(),
            superseded_reason: SUPERSEDE_REASON,
          })
          .eq("id", p.id)
          .not("status", "in", "(captured,PAID)");
        await logLedger(db, {
          action: "supersede",
          payment: p,
          actor: { id: "backfill", name: "Backfill script", role: "system", isSuper: false },
          reason: SUPERSEDE_REASON,
          metadata: { group_key: groupKey, superseded_by_payment_id: anchor.id, backfill: true },
        });
      }
    }
  }

  return report;
}
