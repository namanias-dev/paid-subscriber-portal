/**
 * The student event timeline.
 *
 * Two kinds of event feed this, and the distinction matters:
 *
 *   CAPTURED — a transfer writes an enrollment_transfers row inside its own
 *   transaction, carrying a structured before/after snapshot. There is no other
 *   way to reconstruct a transfer after the fact, so it must be recorded as it
 *   happens.
 *
 *   SURFACED — payments, receipts, reminder SMS and enrollment creation are
 *   already recorded by the systems that perform them. Writing a second event row
 *   for those would be a parallel log that can drift from the source, so they are
 *   read from where they already live and shaped into the same event type here.
 *
 * Everything in this file is pure: it takes rows in and returns events out. The
 * reading happens in the route, the formatting in the component.
 */
import type { InstallmentItem } from "./types";

export type TimelineEventType =
  | "enrollment_created"
  | "transfer"
  | "payment"
  | "receipt"
  | "sms"
  | "plan_changed"
  | "schedule_reanchor"
  | "discount_applied"
  | "access_cap"
  | "access_exclusion"
  | "access_override";

export interface TimelineActor {
  /** The username or id recorded against the action. */
  id: string | null;
  /** Display name as it was when they acted, when we have one. */
  name: string | null;
}

/** One itemised change inside an event, e.g. a fee moving or a due date shifting. */
export interface TimelineChange {
  label: string;
  before: string | null;
  after: string | null;
  /** True when this is the change a reader most needs to notice. */
  emphasis?: boolean;
}

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  at: string;
  /** One plain-language sentence. Built here so console QA and the UI agree. */
  title: string;
  detail: string | null;
  actor: TimelineActor;
  /** Free-text reason captured from staff. ADMIN-ONLY — never shown to students. */
  reason: string | null;
  changes: TimelineChange[];
  /** The full structured before/after, for the expanded view. */
  snapshot: unknown | null;
  courseTitle: string | null;
}

// ─────────────────────────── formatting helpers ───────────────────────────

export const rupees = (n: number | null | undefined): string =>
  n == null ? "—" : `₹${Math.round(Number(n)).toLocaleString("en-IN")}`;

const IST_DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

export const istDate = (iso: string | null | undefined): string => (iso ? IST_DATE.format(new Date(iso)) : "—");

/** Short form for inside a sentence: "1 Aug". */
export function istDayMonth(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(new Date(iso));
}

/**
 * "2 days ago" / "in 3 days". Whole units only — a timeline does not need
 * precision it cannot honestly claim.
 */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const past = diff >= 0;
  const mins = Math.floor(abs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return past ? `${mins} minute${mins === 1 ? "" : "s"} ago` : `in ${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return past ? `${hours} hour${hours === 1 ? "" : "s"} ago` : `in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return past ? `${days} day${days === 1 ? "" : "s"} ago` : `in ${days} day${days === 1 ? "" : "s"}`;
  const months = Math.floor(days / 30);
  if (months < 12) return past ? `${months} month${months === 1 ? "" : "s"} ago` : `in ${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  return past ? `${years} year${years === 1 ? "" : "s"} ago` : `in ${years} year${years === 1 ? "" : "s"}`;
}

/** Describe a batch the way staff talk about it, tolerating missing pieces. */
function batchPhrase(label: string | null | undefined, startISO: string | null | undefined): string {
  const l = label?.trim();
  if (l && startISO) return `${l} (starts ${istDayMonth(startISO)})`;
  if (l) return l;
  if (startISO) return `batch starting ${istDayMonth(startISO)}`;
  return "no batch recorded";
}

// ─────────────────────────── the transfer event ───────────────────────────

/** The shape transfer_enrollment() stores in enrollment_transfers.snapshot. */
export interface TransferSnapshot {
  before: SnapshotSide;
  after: SnapshotSide;
  contentAccess?: { beforeItems: number | null; afterItems: number | null } | null;
}
export interface SnapshotSide {
  courseId: string | null;
  courseTitle: string | null;
  batchId: string | null;
  batchLabel: string | null;
  batchStart: string | null;
  batchStartProvenance?: string | null;
  totalFee: number;
  amountPaid: number;
  outstanding: number;
  schedule: InstallmentItem[];
  seatsLeft: number | null;
}

export interface TransferRow {
  id: string;
  created_at: string;
  student_name: string | null;
  from_course_title: string | null;
  to_course_title: string | null;
  from_batch_label: string | null;
  to_batch_label: string | null;
  old_total_fee: number;
  new_total_fee: number;
  amount_paid: number;
  fee_delta: number;
  credit_due: number;
  old_schedule: InstallmentItem[];
  new_schedule: InstallmentItem[];
  shift_days: number | null;
  reason: string;
  actor_user_id: string | null;
  actor_name: string | null;
  capacity_overridden: boolean;
  snapshot: TransferSnapshot | null;
}

/**
 * Turn a stored transfer into a readable event.
 *
 * Reads the snapshot when present and falls back to the flat columns when it is
 * not — transfers written before the snapshot column existed must still render,
 * just with less detail, rather than disappearing from the history.
 */
export function transferEvent(row: TransferRow): TimelineEvent {
  const snap = row.snapshot ?? null;
  const before = snap?.before;
  const after = snap?.after;

  const courseChanged = (row.from_course_title ?? "") !== (row.to_course_title ?? "");
  const fromBatch = batchPhrase(row.from_batch_label, before?.batchStart);
  const toBatch = batchPhrase(row.to_batch_label, after?.batchStart);

  const title = courseChanged
    ? `Course & batch changed: ${row.from_course_title ?? "—"} (${row.from_batch_label ?? "no batch"}) → ${row.to_course_title ?? "—"} — ${toBatch}`
    : `Batch changed: ${fromBatch} → ${toBatch}`;

  const changes: TimelineChange[] = [];

  if (courseChanged) {
    changes.push({ label: "Course", before: row.from_course_title, after: row.to_course_title });
  }
  changes.push({ label: "Batch", before: fromBatch, after: toBatch });

  if (before?.batchStart || after?.batchStart) {
    changes.push({ label: "Batch start", before: istDate(before?.batchStart), after: istDate(after?.batchStart) });
  }

  // Fee: say explicitly when nothing changed, rather than showing an identical
  // pair and leaving the reader to compare two numbers.
  changes.push({
    label: "Total fee",
    before: rupees(row.old_total_fee),
    after: row.fee_delta === 0 ? `${rupees(row.new_total_fee)} (no change)` : rupees(row.new_total_fee),
    emphasis: row.fee_delta !== 0,
  });
  changes.push({ label: "Amount paid", before: rupees(row.amount_paid), after: `${rupees(row.amount_paid)} (carried over)` });

  const oldOut = before?.outstanding ?? Math.max(0, row.old_total_fee - row.amount_paid);
  const newOut = after?.outstanding ?? Math.max(0, row.new_total_fee - row.amount_paid);
  changes.push({
    label: "Outstanding",
    before: rupees(oldOut),
    after: oldOut === newOut ? `${rupees(newOut)} (unchanged)` : rupees(newOut),
    emphasis: oldOut !== newOut,
  });

  if (row.credit_due > 0) {
    changes.push({ label: "Credit due", before: null, after: `${rupees(row.credit_due)} — flagged for manual handling, not refunded`, emphasis: true });
  }

  // Due dates: one line per unpaid installment that actually moved. Paid lines
  // are excluded because they did not move and saying so adds noise.
  for (const line of dueDateMoves(row.old_schedule ?? [], row.new_schedule ?? [])) {
    changes.push({
      label: `Due date — ${line.label}`,
      before: `${rupees(line.amount)} due ${istDayMonth(line.oldDue)}`,
      after: istDayMonth(line.newDue),
      emphasis: true,
    });
  }

  if (snap?.contentAccess && (snap.contentAccess.beforeItems != null || snap.contentAccess.afterItems != null)) {
    changes.push({
      label: "Class Hub content",
      before: snap.contentAccess.beforeItems != null ? `${snap.contentAccess.beforeItems} items` : "—",
      after: courseChanged
        ? `${snap.contentAccess.afterItems ?? 0} items (old course content no longer applies)`
        : `${snap.contentAccess.afterItems ?? 0} items (unchanged — same course)`,
    });
  }

  if (before?.seatsLeft != null || after?.seatsLeft != null) {
    changes.push({
      label: "Seats",
      before: before?.seatsLeft != null ? `source ${before.seatsLeft} → ${before.seatsLeft + 1}` : "source not tracked",
      after: after?.seatsLeft != null ? `target ${after.seatsLeft} → ${after.seatsLeft - 1}` : "target not tracked",
    });
  }

  if (row.capacity_overridden) {
    changes.push({ label: "Capacity", before: null, after: "Target batch was full — a senior admin overrode the limit", emphasis: true });
  }

  return {
    id: `transfer:${row.id}`,
    type: "transfer",
    at: row.created_at,
    title,
    detail: row.shift_days != null && row.shift_days !== 0
      ? `Unpaid due dates moved ${row.shift_days > 0 ? "later" : "earlier"} by ${Math.abs(row.shift_days)} days.`
      : null,
    actor: { id: row.actor_user_id, name: row.actor_name },
    reason: row.reason,
    changes,
    snapshot: snap,
    courseTitle: row.to_course_title,
  };
}

/** Unpaid lines whose due date differs between the two schedules. */
export function dueDateMoves(oldS: InstallmentItem[], newS: InstallmentItem[]) {
  const out: { no: number; label: string; amount: number; oldDue: string | null; newDue: string | null }[] = [];
  for (const o of oldS) {
    if (o.paid) continue;
    const n = newS.find((x) => x.no === o.no);
    if (!n || n.due === o.due) continue;
    out.push({ no: o.no, label: o.label, amount: n.amount, oldDue: o.due ?? null, newDue: n.due ?? null });
  }
  return out;
}

// ─────────────────────────── surfaced events ───────────────────────────

export interface PaymentRow {
  id: string; created_at: string; amount: number; status: string; item: string | null;
  payment_kind: string | null; installment_no: number | null; mode: string | null;
  reference_no: string | null; receipt_no: string | null;
}

export function paymentEvent(p: PaymentRow): TimelineEvent {
  const kind = p.payment_kind === "seat" ? "Seat booking" : p.installment_no != null ? `Installment ${p.installment_no}` : "Payment";
  return {
    id: `payment:${p.id}`,
    type: "payment",
    at: p.created_at,
    title: `${kind} received — ${rupees(p.amount)}`,
    detail: [p.item, p.mode, p.reference_no ? `ref ${p.reference_no}` : null].filter(Boolean).join(" · ") || null,
    // A gateway payment has no staff actor; saying "system" is more honest than
    // leaving a blank that looks like missing data.
    actor: { id: null, name: p.mode && /cash|offline/i.test(p.mode) ? "recorded by staff" : "student / gateway" },
    reason: null,
    changes: [],
    snapshot: null,
    courseTitle: p.item,
  };
}

export interface SmsRow {
  id: string; created_at: string; sent_at: string | null; template_name: string | null;
  status: string; sent_by_type: string | null; sent_by_user_id?: string | null;
  installment_no: number | null; course_id: string | null;
}

export function smsEvent(s: SmsRow): TimelineEvent {
  const when = s.sent_at ?? s.created_at;
  const name = s.template_name ?? "SMS";
  const actorName = s.sent_by_type === "ADMIN"
    ? (s.sent_by_user_id || "staff")
    : s.sent_by_type === "SYSTEM"
      ? "System · automated"
      : "automated";
  return {
    id: `sms:${s.id}`,
    type: "sms",
    at: when,
    title: `SMS sent — ${name}${s.installment_no != null ? ` (installment ${s.installment_no})` : ""}`,
    detail: `Delivery status: ${s.status}`,
    actor: { id: s.sent_by_user_id ?? null, name: actorName },
    reason: null,
    changes: [],
    snapshot: null,
    courseTitle: null,
  };
}

export interface AccessCapRow {
  id: string;
  course_enrollment_id: string;
  installment_no: number;
  auto_sequences_used: number;
  needs_call: boolean;
  needs_call_at: string | null;
  excluded_from_automation: boolean;
  excluded_reason: string | null;
  excluded_at: string | null;
  excluded_by: string | null;
  reset_at: string | null;
  reset_by: string | null;
  reset_reason: string | null;
}

/** Cap reached / exclusion / reset — surfaced from access_reminder_caps. */
export function accessCapEvents(row: AccessCapRow): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  if (row.needs_call && row.needs_call_at) {
    const paymentFailure = row.installment_no === 0 || /FAILED|VERIFYING|Grant expires/i.test(row.excluded_reason || "");
    events.push({
      id: `access_cap:${row.id}`,
      type: "access_cap",
      at: row.needs_call_at,
      title: paymentFailure
        ? `Flagged for call — ${row.excluded_reason || "payment issue"}`
        : `Escalation cap reached — installment ${row.installment_no} flagged for call`,
      detail: paymentFailure
        ? "Automated installment SMS suppressed while flagged. Manual send remains available."
        : `${row.auto_sequences_used} automated sequences used. Automation stopped for this installment.`,
      actor: { id: null, name: "System · automated" },
      reason: row.excluded_reason,
      changes: [],
      snapshot: null,
      courseTitle: null,
    });
  }
  if (row.excluded_from_automation && row.excluded_at) {
    events.push({
      id: `access_excl:${row.id}`,
      type: "access_exclusion",
      at: row.excluded_at,
      title: `Excluded from access automation — installment ${row.installment_no}`,
      detail: row.excluded_reason,
      actor: { id: row.excluded_by, name: row.excluded_by ? "staff" : null },
      reason: row.excluded_reason,
      changes: [],
      snapshot: null,
      courseTitle: null,
    });
  }
  if (row.reset_at && row.reset_reason) {
    events.push({
      id: `access_reset:${row.id}`,
      type: "access_exclusion",
      at: row.reset_at,
      title: `Access automation cap reset — installment ${row.installment_no}`,
      detail: row.reset_reason,
      actor: { id: row.reset_by, name: row.reset_by ? "staff" : null },
      reason: row.reset_reason,
      changes: [],
      snapshot: null,
      courseTitle: null,
    });
  }
  return events;
}

export interface EnrollmentRow {
  id: string; created_at: string; course_title: string | null; batch_label: string | null;
  total_fee: number; plan_type: string | null; status: string | null;
  payment_plan_changed_at: string | null; payment_plan_changed_by: string | null; payment_plan_change_reason: string | null;
  discount_amount: number | null; discount_applied_at: string | null; discount_applied_by: string | null;
  discount_reason: string | null; original_total_fee: number | null;
}

export function enrollmentEvents(e: EnrollmentRow): TimelineEvent[] {
  const events: TimelineEvent[] = [{
    id: `enrolled:${e.id}`,
    type: "enrollment_created",
    at: e.created_at,
    title: `Enrolled in ${e.course_title ?? "a course"}${e.batch_label ? ` — ${e.batch_label}` : ""}`,
    detail: `${e.plan_type === "emi" ? "Instalment plan" : "Pay in full"} · total ${rupees(e.total_fee)}`,
    actor: { id: null, name: null },
    reason: null,
    changes: [],
    snapshot: null,
    courseTitle: e.course_title,
  }];

  // A plan change caused BY a transfer is already told as a transfer event, and
  // repeating it as a separate "schedule changed" entry would double-report one
  // action. The transfer writes a reason with this prefix, which is how the two
  // are told apart.
  const planReason = e.payment_plan_change_reason ?? "";
  const isTransferPlanChange = planReason.startsWith("Batch/course transfer:");
  const isReanchorPlanChange = planReason.startsWith("Schedule re-anchor");
  const isPhantomNeutralize = planReason.includes("neutralized phantom");
  if (e.payment_plan_changed_at && !isTransferPlanChange && !isReanchorPlanChange && !isPhantomNeutralize) {
    events.push({
      id: `plan:${e.id}`,
      type: "plan_changed",
      at: e.payment_plan_changed_at,
      title: `Instalment schedule changed — ${e.course_title ?? "course"}`,
      detail: null,
      actor: { id: e.payment_plan_changed_by, name: e.payment_plan_changed_by },
      reason: planReason || null,
      changes: [],
      snapshot: null,
      courseTitle: e.course_title,
    });
  }

  if (e.discount_applied_at && (e.discount_amount ?? 0) > 0) {
    events.push({
      id: `discount:${e.id}`,
      type: "discount_applied",
      at: e.discount_applied_at,
      title: `Discount applied — ${rupees(e.discount_amount)} off ${e.course_title ?? "course"}${e.discount_reason ? ` (${e.discount_reason})` : ""}`,
      detail: null,
      actor: { id: e.discount_applied_by, name: e.discount_applied_by },
      reason: e.discount_reason ?? null,
      changes: [{ label: "Total fee", before: rupees(e.original_total_fee), after: rupees(e.total_fee), emphasis: true }],
      snapshot: null,
      courseTitle: e.course_title,
    });
  }

  return events;
}

/** Newest first, with a stable tiebreak so equal timestamps do not reorder between renders. */
export function sortTimeline(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => {
    const d = new Date(b.at).getTime() - new Date(a.at).getTime();
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });
}

/**
 * Strip anything a student must not see. Internal reason notes are written for
 * colleagues, not customers.
 */
export function forStudentEyes(events: TimelineEvent[]): TimelineEvent[] {
  return events.map((e) => ({ ...e, reason: null, actor: { id: null, name: null }, snapshot: null }));
}

export const TYPE_LABELS: Record<TimelineEventType, string> = {
  enrollment_created: "Enrolment",
  transfer: "Transfer",
  payment: "Payment",
  receipt: "Receipt",
  sms: "SMS",
  plan_changed: "Schedule change",
  schedule_reanchor: "Schedule re-anchor",
  discount_applied: "Discount",
  access_cap: "Access cap",
  access_exclusion: "Access automation",
  access_override: "Access grant",
};

export interface ScheduleReanchorRow {
  id: string;
  created_at: string;
  enrollment_id: string;
  course_id: string | null;
  batch_start: string | null;
  reason: string | null;
  actor: string | null;
  schedule_before: InstallmentItem[];
  schedule_after: InstallmentItem[];
  lines: { no: number; label: string; currentDue: string | null; proposedDue: string | null; daysShifted: number | null; paid: boolean }[];
  reverted_at: string | null;
}

export function scheduleReanchorEvent(row: ScheduleReanchorRow, courseTitle?: string | null): TimelineEvent {
  const moves = dueDateMoves(row.schedule_before || [], row.schedule_after || []);
  const changes: TimelineChange[] = moves.map((m) => ({
    label: `Due date — ${m.label}`,
    before: istDayMonth(m.oldDue),
    after: istDayMonth(m.newDue),
    emphasis: true,
  }));
  return {
    id: `reanchor:${row.id}`,
    type: "schedule_reanchor",
    at: row.created_at,
    title: row.reverted_at
      ? `Schedule re-anchor reverted — ${courseTitle ?? "course"}`
      : `Schedule re-anchored to batch start — ${courseTitle ?? "course"}`,
    detail: row.batch_start ? `Batch start ${istDate(row.batch_start)}. Amounts unchanged.` : "Amounts unchanged.",
    actor: { id: row.actor, name: row.actor || "System · re-anchor" },
    reason: row.reason,
    changes,
    snapshot: { before: row.schedule_before, after: row.schedule_after, lines: row.lines },
    courseTitle: courseTitle ?? null,
  };
}

export interface AccessOverrideEventRow {
  id: string;
  created_at: string;
  /** Live column — prefer this. */
  event_type?: string | null;
  /** Legacy / mistyped insert shape still seen in some writers. */
  kind?: string | null;
  detail?: string | null;
  reason: string | null;
  actor?: string | null;
  actor_name?: string | null;
  actor_user_id?: string | null;
  course_id: string | null;
}

export function accessOverrideEvent(row: AccessOverrideEventRow): TimelineEvent {
  const kind = row.event_type || row.kind || "";
  const titles: Record<string, string> = {
    granted: "Access override granted",
    revoked: "Access override revoked",
    shortened: "Access override shortened",
    expired: "Access override expired",
    reminder_sent: "Access reminder SMS sent",
  };
  const actorName = row.actor_name || row.actor || "staff";
  return {
    id: `access_ovr:${row.id}`,
    type: "access_override",
    at: row.created_at,
    title: titles[kind] || "Access override",
    detail: row.detail ?? row.reason,
    actor: { id: row.actor_user_id ?? row.actor ?? null, name: actorName },
    reason: row.reason,
    changes: [],
    snapshot: null,
    courseTitle: null,
  };
}
