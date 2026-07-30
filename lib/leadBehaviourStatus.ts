/**
 * Behaviour-driven lead pipeline status.
 *
 * RULE ZERO: real behaviour wins the displayed `leads.status`. The staff
 * manual verdict is NEVER deleted — it moves into `manual_status*` fields.
 *
 * Architecture (chosen):
 *   Persist derived status on `leads.status` so existing filters/kanban/counts
 *   keep working. Update EVENT-DRIVEN (fire-and-forget after registration /
 *   course payment finalize) — never on CRM page render, never via full-table
 *   cron. Derivation is a projection of event rows via indexed `phone_key`.
 *
 * Alternatives rejected:
 *   - Generated/virtual column: can't express "furthest stage across joins"
 *     without expensive views; filters would break.
 *   - DB triggers on payments: risk adding latency/locks on the payment write
 *     path — payments must never be slowed.
 *   - Recompute on page open: burns requests, N× cost, drifts between views.
 */

import { getSupabaseAdmin } from "./supabase";
import { phoneKeyFromRaw } from "./marketing/legacyLeadMatch";
import {
  leadStatusFlags,
  normalizeLeadStatus,
  type LeadStatus,
} from "./leadStatus";
import { deriveEnrollment, isActiveEnrollment } from "./installments";
import type { CourseEnrollment, InstallmentItem } from "./types";

function isPaidStatus(status: string | null | undefined): boolean {
  return status === "PAID" || status === "captured";
}

/** Ordered behaviour ladder — furthest stage wins; never move backwards. */
export const BEHAVIOUR_LADDER = [
  "Webinar Registered",
  "Seat Booked",
  "Admission Done",
] as const satisfies readonly LeadStatus[];

export type BehaviourStage = (typeof BEHAVIOUR_LADDER)[number];

export const BEHAVIOUR_STAGE_RANK: Readonly<Record<BehaviourStage, number>> = {
  "Webinar Registered": 1,
  "Seat Booked": 2,
  "Admission Done": 3,
};

export type StatusOrigin = "staff" | "system" | "import" | "unknown";

export interface ManualVerdict {
  status: LeadStatus | string;
  at: string | null;
  by: string | null;
  byRole: string | null;
  note: string | null;
}

/** Negative / terminal staff judgements used by the disparity report. */
export const NEGATIVE_MANUAL_STATUSES: readonly LeadStatus[] = [
  "Not Interested",
  "Wrong No.",
];

/** Columns added by 2026-07-30-lead-behaviour-status.sql */
export const BEHAVIOUR_SCHEMA_COLS = [
  "status_origin",
  "status_system_verified_at",
  "manual_status",
  "manual_status_at",
  "manual_status_by",
  "manual_status_by_role",
  "manual_status_note",
] as const;

let behaviourSchemaReady: boolean | null = null;

/** True once the additive behaviour-status columns exist (cached). */
export async function hasBehaviourStatusSchema(): Promise<boolean> {
  if (behaviourSchemaReady != null) return behaviourSchemaReady;
  const db = getSupabaseAdmin();
  if (!db) {
    behaviourSchemaReady = false;
    return false;
  }
  const { error } = await db.from("leads").select("id,status_origin").limit(1);
  behaviourSchemaReady = !error;
  return behaviourSchemaReady;
}

/** Test helper — reset the schema probe cache. */
export function resetBehaviourSchemaCache(): void {
  behaviourSchemaReady = null;
}

export function isBehaviourStage(value: string | null | undefined): value is BehaviourStage {
  return value === "Webinar Registered" || value === "Seat Booked" || value === "Admission Done";
}

export function behaviourStageRank(value: string | null | undefined): number {
  return isBehaviourStage(value) ? BEHAVIOUR_STAGE_RANK[value] : 0;
}

/**
 * Pick the furthest stage. Never demotes: if `current` is already further
 * along the ladder than `candidate`, keep `current`.
 */
export function furthestBehaviourStage(
  current: string | null | undefined,
  candidate: BehaviourStage | null,
): BehaviourStage | null {
  if (!candidate) return isBehaviourStage(current) ? current : null;
  if (!isBehaviourStage(current)) return candidate;
  return BEHAVIOUR_STAGE_RANK[candidate] >= BEHAVIOUR_STAGE_RANK[current] ? candidate : current;
}

/** System-verified badge text — unambiguous, no "auto". */
export function formatSystemVerifiedLabel(status: string | null | undefined): string {
  const s = normalizeLeadStatus(status) ?? status ?? "—";
  return `System verified — ${s}`;
}

/** Staff manual verdict badge. */
export function formatStaffVerdictLabel(v: ManualVerdict | null | undefined): string | null {
  if (!v?.status) return null;
  const who = v.by?.trim() || "staff";
  const role = v.byRole?.trim();
  const when = v.at ? formatShortDate(v.at) : null;
  const head = role ? `Staff: ${who} (${role})` : `Staff: ${who}`;
  return `${head} — ${v.status}${when ? ` · ${when}` : ""}`;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

// ---------------------------------------------------------------------------
// Derivation from event rows (phone_key indexed)
// ---------------------------------------------------------------------------

export interface BehaviourEvidence {
  phoneKey: string;
  stage: BehaviourStage | null;
  webinarRegisteredAt: string | null;
  webinarTitle: string | null;
  seatBookedAt: string | null;
  admissionAt: string | null;
  /** Timeline-only signals that do NOT advance the ladder. */
  attemptedWebinarAt: string | null;
  failedPaymentAt: string | null;
}

type EnrRow = {
  id: string;
  phone_key: string | null;
  status: string | null;
  amount_paid: number | null;
  created_at: string | null;
  schedule: InstallmentItem[] | null;
  course_title: string | null;
};

type PayRow = {
  id: string;
  phone_key: string | null;
  status: string | null;
  amount: number | null;
  item_type: string | null;
  payment_kind: string | null;
  created_at: string | null;
  item_name: string | null;
};

type RegRow = {
  id: string;
  phone_key: string | null;
  webinar_id: string | null;
  created_at: string | null;
};

type WebinarRow = { id: string; title: string | null; price: number | null };

/**
 * Pure derivation from already-fetched event rows for one phone_key.
 * Exported for unit tests — no I/O.
 */
export function deriveBehaviourStageFromEvents(input: {
  enrollments: EnrRow[];
  payments: PayRow[];
  registrations: RegRow[];
  webinarsById: Map<string, WebinarRow>;
}): BehaviourEvidence {
  let stage: BehaviourStage | null = null;
  let webinarRegisteredAt: string | null = null;
  let webinarTitle: string | null = null;
  let seatBookedAt: string | null = null;
  let admissionAt: string | null = null;
  let attemptedWebinarAt: string | null = null;
  let failedPaymentAt: string | null = null;

  const bump = (next: BehaviourStage, at: string | null) => {
    const prevRank = behaviourStageRank(stage);
    const nextRank = BEHAVIOUR_STAGE_RANK[next];
    if (nextRank < prevRank) return;
    stage = next;
    if (next === "Webinar Registered") {
      if (!webinarRegisteredAt || (at && at < webinarRegisteredAt)) webinarRegisteredAt = at;
    }
    if (next === "Seat Booked") {
      if (!seatBookedAt || (at && at < seatBookedAt)) seatBookedAt = at;
    }
    if (next === "Admission Done") {
      if (!admissionAt || (at && at < admissionAt)) admissionAt = at;
    }
  };

  for (const e of input.enrollments) {
    if (e.status === "cancelled" || e.status === "transferred_out") continue;
    const paid = Number(e.amount_paid || 0);
    const withFee = deriveEnrollment({
      total_fee: Math.max(paid, 1),
      schedule: Array.isArray(e.schedule) ? e.schedule : [],
    });

    if (e.status === "fully_paid" || e.status === "partially_paid") {
      const firstInstallmentPaid = (Array.isArray(e.schedule) ? e.schedule : [])
        .filter((s) => (s.kind === "installment" || s.kind === "full") && s.paid)
        .map((s) => s.paid_at || e.created_at)
        .filter(Boolean)
        .sort()[0] as string | undefined;
      bump("Admission Done", firstInstallmentPaid || e.created_at);
      if (withFee.seatPaid) {
        const seatAt = (Array.isArray(e.schedule) ? e.schedule : [])
          .filter((s) => s.kind === "seat" && s.paid)
          .map((s) => s.paid_at || e.created_at)
          .filter(Boolean)
          .sort()[0] as string | undefined;
        if (!seatBookedAt) seatBookedAt = seatAt || e.created_at;
      }
      continue;
    }

    if (
      e.status === "seat_booked" ||
      (isActiveEnrollment({ status: e.status as CourseEnrollment["status"], amount_paid: paid }) &&
        withFee.seatPaid &&
        withFee.paidCount === 0 &&
        !withFee.isFullyPaid)
    ) {
      bump("Seat Booked", e.created_at);
    }
  }

  for (const p of input.payments) {
    if (!isPaidStatus(p.status) || Number(p.amount || 0) <= 0) {
      const st = (p.status || "").toUpperCase();
      if (st === "FAILED" || st === "ABANDONED" || st === "REFUNDED") {
        if (!failedPaymentAt || (p.created_at && p.created_at < failedPaymentAt)) {
          failedPaymentAt = p.created_at;
        }
      }
      continue;
    }
    if (p.item_type === "course") {
      const kind = (p.payment_kind || "").toLowerCase();
      if (kind === "seat") bump("Seat Booked", p.created_at);
      else bump("Admission Done", p.created_at);
    }
    if (p.item_type === "webinar") {
      bump("Webinar Registered", p.created_at);
      if (!webinarTitle && p.item_name) webinarTitle = p.item_name;
    }
  }

  for (const r of input.registrations) {
    const w = r.webinar_id ? input.webinarsById.get(r.webinar_id) : undefined;
    const price = Number(w?.price ?? 0);
    if (price <= 0) {
      bump("Webinar Registered", r.created_at);
      if (!webinarTitle && w?.title) webinarTitle = w.title;
    } else {
      if (behaviourStageRank(stage) < 1) {
        if (!attemptedWebinarAt || (r.created_at && r.created_at < attemptedWebinarAt)) {
          attemptedWebinarAt = r.created_at;
        }
      }
      if (isBehaviourStage(stage) && BEHAVIOUR_STAGE_RANK[stage] >= 1 && !webinarTitle && w?.title) {
        webinarTitle = w.title;
      }
    }
  }

  return {
    phoneKey: "",
    stage,
    webinarRegisteredAt,
    webinarTitle,
    seatBookedAt,
    admissionAt,
    attemptedWebinarAt,
    failedPaymentAt,
  };
}

/** Load events for one phone_key and derive the furthest behaviour stage. */
export async function deriveBehaviourForPhone(phoneRaw: string): Promise<BehaviourEvidence | null> {
  const phoneKey = phoneKeyFromRaw(phoneRaw);
  if (!phoneKey) return null;
  const db = getSupabaseAdmin();
  if (!db) return null;

  const [ens, pays, regs] = await Promise.all([
    db.from("course_enrollments").select("id,phone_key,status,amount_paid,created_at,schedule,course_title").eq("phone_key", phoneKey),
    db.from("payments").select("id,phone_key,status,amount,item_type,payment_kind,created_at,item_name").eq("phone_key", phoneKey),
    db.from("webinar_registrations").select("id,phone_key,webinar_id,created_at").eq("phone_key", phoneKey),
  ]);

  const webinarIds = [...new Set((regs.data || []).map((r) => r.webinar_id).filter(Boolean))] as string[];
  const webinarsById = new Map<string, WebinarRow>();
  if (webinarIds.length) {
    const { data: ws } = await db.from("webinars").select("id,title,price").in("id", webinarIds);
    for (const w of ws || []) webinarsById.set(w.id, w as WebinarRow);
  }

  const evidence = deriveBehaviourStageFromEvents({
    enrollments: (ens.data || []) as EnrRow[],
    payments: (pays.data || []) as PayRow[],
    registrations: (regs.data || []) as RegRow[],
    webinarsById,
  });
  evidence.phoneKey = phoneKey;
  return evidence;
}

export interface ApplyBehaviourResult {
  leadId: string;
  phoneKey: string;
  before: string | null;
  after: string | null;
  changed: boolean;
  preservedManual: boolean;
  skippedReason?: string;
}

/**
 * Apply behaviour-derived status to ONE lead row.
 * Never moves backwards on the behaviour ladder.
 * Preserves staff/manual verdict into manual_* when flipping away from it.
 */
export function buildBehaviourPatch(input: {
  currentStatus: string | null | undefined;
  statusOrigin: StatusOrigin | null | undefined;
  manualStatus: string | null | undefined;
  derived: BehaviourStage;
  nowIso?: string;
  /** When false, omit additive columns (pre-migration deploy safety). */
  includeAttributionCols?: boolean;
}): {
  patch: Record<string, unknown>;
  changed: boolean;
  preservedManual: boolean;
  skippedReason?: string;
} {
  const now = input.nowIso || new Date().toISOString();
  const includeAttrs = input.includeAttributionCols !== false;
  const current = normalizeLeadStatus(input.currentStatus) ?? input.currentStatus ?? null;
  const currentRank = behaviourStageRank(current);
  const derivedRank = BEHAVIOUR_STAGE_RANK[input.derived];

  if (currentRank > derivedRank) {
    return { patch: {}, changed: false, preservedManual: false, skippedReason: "would_demote" };
  }
  if (current === input.derived && input.statusOrigin === "system") {
    return { patch: {}, changed: false, preservedManual: false, skippedReason: "already_system" };
  }
  if (current === input.derived && input.statusOrigin !== "staff") {
    if (!includeAttrs) {
      return { patch: {}, changed: false, preservedManual: false, skippedReason: "already_same" };
    }
    return {
      patch: {
        status_origin: "system",
        status_system_verified_at: now,
      },
      changed: true,
      preservedManual: false,
    };
  }

  const flags = leadStatusFlags(input.derived);
  const patch: Record<string, unknown> = {
    status: input.derived,
    updated_at: now,
  };
  if (includeAttrs) {
    patch.status_origin = "system";
    patch.status_system_verified_at = now;
  }
  if (flags.webinar_registered) patch.webinar_registered = true;
  if (flags.admitted) patch.admitted = true;

  let preservedManual = false;
  const shouldPreserve =
    includeAttrs &&
    !input.manualStatus &&
    current &&
    current !== input.derived &&
    (input.statusOrigin === "staff" ||
      input.statusOrigin === "import" ||
      input.statusOrigin == null ||
      input.statusOrigin === "unknown" ||
      !isBehaviourStage(current));

  if (shouldPreserve && current) {
    patch.manual_status = current;
    patch.manual_status_at = now;
    preservedManual = true;
  }

  return { patch, changed: true, preservedManual };
}

/**
 * Apply derived behaviour status to every unmerged lead on this phone.
 * Safe to call fire-and-forget — never throws to caller when wrapped in void.
 */
export async function applyBehaviourStatusForPhone(phoneRaw: string): Promise<ApplyBehaviourResult[]> {
  const schemaOk = await hasBehaviourStatusSchema();
  // Without the new CHECK values, writing Webinar Registered / Seat Booked fails.
  if (!schemaOk) return [];

  const evidence = await deriveBehaviourForPhone(phoneRaw);
  if (!evidence?.stage || !evidence.phoneKey) return [];

  const db = getSupabaseAdmin();
  if (!db) return [];

  const { data: leads, error } = await db
    .from("leads")
    .select("id,phone_key,status,status_origin,manual_status,is_legacy")
    .eq("phone_key", evidence.phoneKey)
    .is("merged_into", null);

  if (error || !leads?.length) return [];

  const results: ApplyBehaviourResult[] = [];
  for (const lead of leads) {
    const { patch, changed, preservedManual, skippedReason } = buildBehaviourPatch({
      currentStatus: lead.status,
      statusOrigin: (lead.status_origin as StatusOrigin | null) ?? null,
      manualStatus: lead.manual_status,
      derived: evidence.stage,
      includeAttributionCols: true,
    });
    if (!changed) {
      results.push({
        leadId: lead.id,
        phoneKey: evidence.phoneKey,
        before: lead.status,
        after: lead.status,
        changed: false,
        preservedManual: false,
        skippedReason,
      });
      continue;
    }
    const { error: upErr } = await db.from("leads").update(patch).eq("id", lead.id);
    if (upErr) {
      results.push({
        leadId: lead.id,
        phoneKey: evidence.phoneKey,
        before: lead.status,
        after: lead.status,
        changed: false,
        preservedManual: false,
        skippedReason: upErr.message,
      });
      continue;
    }
    results.push({
      leadId: lead.id,
      phoneKey: evidence.phoneKey,
      before: lead.status,
      after: evidence.stage,
      changed: true,
      preservedManual,
    });
  }
  return results;
}

/** Fire-and-forget wrapper — MUST NOT be awaited on payment/registration paths. */
export function scheduleBehaviourStatusApply(phoneRaw: string | null | undefined): void {
  if (!phoneRaw) return;
  void applyBehaviourStatusForPhone(phoneRaw).catch((err) => {
    console.error("[leadBehaviourStatus] apply failed", phoneRaw, err);
  });
}

/**
 * Staff PATCH: write pipeline status + stamp manual verdict attribution.
 * When the additive columns are not yet migrated, omit them so CRM edits
 * keep working against the pre-migration schema.
 */
export function buildStaffStatusPatch(input: {
  status: LeadStatus;
  actorName: string | null;
  actorRole: string | null;
  note?: string | null;
  nowIso?: string;
  includeAttributionCols?: boolean;
}): Record<string, unknown> {
  const now = input.nowIso || new Date().toISOString();
  const flags = leadStatusFlags(input.status);
  const patch: Record<string, unknown> = {
    status: input.status,
    admitted: flags.admitted,
    updated_at: now,
  };
  if (flags.webinar_registered) patch.webinar_registered = true;
  if (input.includeAttributionCols !== false) {
    patch.status_origin = "staff" satisfies StatusOrigin;
    patch.manual_status = input.status;
    patch.manual_status_at = now;
    patch.manual_status_by = input.actorName;
    patch.manual_status_by_role = input.actorRole;
    patch.manual_status_note = input.note ?? null;
  }
  return patch;
}

// silence unused import in type-only paths
void isLeadStatus;
