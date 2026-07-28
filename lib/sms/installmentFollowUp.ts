/**
 * STEP 2 of the installment reminder sequence: "Installment Instructions",
 * 30 minutes after the reminder.
 *
 * Two halves, deliberately separated so the interesting half needs no database:
 *   • DECISIONS (pure)      — should this follow-up still go out, right now?
 *   • PERSISTENCE + DRAIN   — the durable queue and the worker that empties it.
 *
 * WHY A ROW AND NOT A TIMER. setTimeout lives inside one serverless invocation.
 * The function returns, the sandbox freezes, a deploy replaces it — and a
 * follow-up that was owed simply never happens, leaving no trace that it was
 * owed at all. A row survives the process; a drain that arrives late still
 * sends. Every failure mode of the timer is a silent one, which is the worst
 * kind for something a student is waiting on.
 *
 * RE-VALIDATION IS THE POINT. Thirty minutes is long enough for the student to
 * pay, opt out, or have their plan restructured. So eligibility is re-derived
 * when the job runs, not trusted from when it was scheduled — above all, nobody
 * who has already paid is told how to pay.
 */
import { normalizeIndianMobile } from "../phone";
import { getSupabaseAdmin } from "../supabase";
import { getTemplate, isOptedOut, recentSameTemplate } from "./store";
import { previewSms, sendSms } from "./service";
import { getCourseEnrollmentById } from "../dataProvider";
import { installmentFingerprint, isInstallmentLine, lineOutstandingAmount } from "./installmentAttribution";
import type { CourseEnrollment, InstallmentItem } from "../types";
import type { SmsTemplate } from "./types";

/**
 * THE delay. One constant, one place. Tests override it via `delayMinutes` on
 * the schedule call rather than by redefining it, so production always uses this
 * value and no test can accidentally ship a different one.
 */
export const FOLLOW_UP_DELAY_MINUTES = 30;

export const INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID = "installment_instructions";

/** How many follow-ups one drain tick will process. See the throttle note in `drainDueFollowUps`. */
export const DRAIN_BATCH_SIZE = 40;

/** A claimed row left behind by a crashed drain is re-queued after this long. */
export const STALE_CLAIM_SECONDS = 300;

/** Re-sending the same instructions for the same installment inside this window is pointless. */
export const INSTRUCTIONS_REPEAT_WINDOW_MIN = 24 * 60;

export type FollowUpStatus = "pending" | "claimed" | "sent" | "cancelled" | "failed";

/**
 * Why a scheduled follow-up did not go out. Every one of these is shown to
 * staff; a cancellation never appears without its reason.
 */
export type FollowUpCancelReason =
  | "installment_paid"
  | "installment_partially_paid_then_cleared"
  | "installment_voided"
  | "installment_restructured"
  | "enrollment_cancelled"
  | "enrollment_superseded"
  | "enrollment_gone"
  | "opted_out"
  | "already_instructed"
  | "template_inactive"
  | "cancelled_by_staff";

export const CANCEL_REASON_LABELS: Record<FollowUpCancelReason | string, string> = {
  installment_paid: "paid",
  installment_partially_paid_then_cleared: "paid in full",
  installment_voided: "installment waived or voided",
  installment_restructured: "payment plan changed",
  enrollment_cancelled: "enrollment cancelled",
  enrollment_superseded: "moved to another batch",
  enrollment_gone: "enrollment no longer exists",
  opted_out: "opted out",
  already_instructed: "instructions already sent",
  template_inactive: "template deactivated",
  cancelled_by_staff: "cancelled by staff",
};

export interface ScheduledSend {
  id: string;
  template_id: string;
  normalized_mobile: string;
  student_name: string | null;
  student_id: string | null;
  course_id: string | null;
  course_enrollment_id: string;
  installment_no: number;
  installment_fingerprint: string | null;
  parent_send_id: string;
  job_id: string | null;
  scheduled_at: string;
  status: FollowUpStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  cancel_reason: string | null;
  actor_user_id: string | null;
  actor_type: string;
  sent_log_id: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

// ===========================================================================
// DECISIONS — pure. No I/O, no clock of their own.
// ===========================================================================

/**
 * Find the line a follow-up is about on the CURRENT schedule.
 *
 * Same tiering as reminder→payment attribution: the immutable fingerprint
 * first (it survives a renumbering), the ordinal only as a fallback, and never
 * a guess. A fingerprint that matches nothing means the line's identity changed,
 * which is a restructure, not a reason to send about whatever now occupies that
 * slot.
 */
export function locateFollowUpLine(
  enrollment: Pick<CourseEnrollment, "schedule">,
  job: Pick<ScheduledSend, "installment_no" | "installment_fingerprint">,
): { line: InstallmentItem } | { line: null; reason: Extract<FollowUpCancelReason, "installment_restructured"> } {
  const installments = (enrollment.schedule || []).filter(isInstallmentLine);

  if (job.installment_fingerprint) {
    const hits = installments.filter((l) => installmentFingerprint(l) === job.installment_fingerprint);
    if (hits.length === 1) return { line: hits[0]! };
    if (hits.length === 0) return { line: null, reason: "installment_restructured" };
    // Ambiguous identity: the ordinal is what tells the duplicates apart, but it
    // must land on one of them or the two pieces of evidence disagree.
    const byNo = hits.find((l) => l.no === job.installment_no);
    if (byNo) return { line: byNo };
    return { line: null, reason: "installment_restructured" };
  }

  const byNo = installments.find((l) => l.no === job.installment_no);
  if (byNo) return { line: byNo };
  return { line: null, reason: "installment_restructured" };
}

/** Everything the re-validation needs to know that it cannot derive itself. */
export interface FollowUpCheckContext {
  enrollment: CourseEnrollment | null;
  optedOut: boolean;
  /** The instructions template already went to this number for this line recently. */
  alreadyInstructed: boolean;
  template: Pick<SmsTemplate, "status" | "gateway_template_id"> | null;
}

export type FollowUpDecision =
  | { send: true; line: InstallmentItem }
  | { send: false; reason: FollowUpCancelReason };

/**
 * Should this follow-up still go out?
 *
 * Order matters only for which reason gets reported; every check is a hard stop.
 * The paid check is the one that earns this whole design: a student who paid in
 * the intervening half hour must never be told how to pay.
 *
 * A PART payment is NOT paid. Outstanding above zero means the obligation
 * stands, so the instructions are still useful and still go.
 */
export function evaluateFollowUp(job: ScheduledSend, ctx: FollowUpCheckContext): FollowUpDecision {
  if (!ctx.template) return { send: false, reason: "template_inactive" };
  if (!(ctx.template.status === "active" || ctx.template.status === "approved") || !ctx.template.gateway_template_id) {
    return { send: false, reason: "template_inactive" };
  }
  if (!ctx.enrollment) return { send: false, reason: "enrollment_gone" };
  if (ctx.enrollment.status === "cancelled") return { send: false, reason: "enrollment_cancelled" };
  // A transfer replaces this enrollment with a new one carrying rescheduled due
  // dates. The line this job was queued against still exists on the superseded
  // row and still looks unpaid, so without this check the student would be sent
  // payment instructions for a plan that no longer governs what they owe.
  if (ctx.enrollment.superseded_by || ctx.enrollment.status === "transferred_out") {
    return { send: false, reason: "enrollment_superseded" };
  }

  const located = locateFollowUpLine(ctx.enrollment, job);
  if (!located.line) return { send: false, reason: located.reason };
  const line = located.line;

  if (line.status === "waived" || line.status === "cancelled") {
    return { send: false, reason: "installment_voided" };
  }
  // Fully settled — either flagged paid or nothing left outstanding after part
  // payments. Both mean the money is in, so the instructions are moot.
  if (line.paid || lineOutstandingAmount(line) <= 0) {
    return { send: false, reason: "installment_paid" };
  }
  if (ctx.optedOut) return { send: false, reason: "opted_out" };
  if (ctx.alreadyInstructed) return { send: false, reason: "already_instructed" };

  return { send: true, line };
}

/** Exponential backoff between retries of a transient gateway failure. */
export function followUpBackoffMs(attempts: number): number {
  const minutes = Math.min(30, 2 ** Math.max(0, attempts - 1));
  return minutes * 60_000;
}

/**
 * Gateway outcomes worth retrying. A refusal on compliance or configuration
 * grounds will refuse identically next time, so retrying it just delays an
 * honest failure; only genuine transport/provider errors get another go.
 */
const TRANSIENT_SKIPS = new Set(["gateway_not_configured", "send_failed"]);

export function isTransientSendFailure(skipped: string | null | undefined, error: string | null | undefined): boolean {
  if (skipped && TRANSIENT_SKIPS.has(skipped)) return true;
  // No named skip reason but an error string => the gateway call itself broke.
  return !skipped && !!error;
}

/** Skips that mean "do not send this, ever" — mapped onto a visible cancel reason. */
export function terminalSkipReason(skipped: string | null | undefined): FollowUpCancelReason | null {
  switch (skipped) {
    case "opted_out": return "opted_out";
    case "recent_duplicate":
    case "duplicate": return "already_instructed";
    case "template_missing":
    case "not_approved":
    case "no_dlt_id": return "template_inactive";
    default: return null;
  }
}

// ===========================================================================
// PREVIEW — what the UI shows as the "+30 min" message.
// ===========================================================================
export interface FollowUpPreview {
  templateId: string;
  templateName: string;
  dltTemplateId: string | null;
  senderId: string | null;
  body: string;
  characterCount: number;
  segments: number;
  delayMinutes: number;
  /** False when the template itself cannot be sent — staff see why before step 1. */
  sendable: boolean;
  blockDetail: string | null;
}

/**
 * Render the instructions message for the UI.
 *
 * Goes through `previewSms` — the SAME function every other preview uses, which
 * resolves variables exactly as the send does and runs the same hard guard — so
 * the body staff approve is the body that goes out. Reimplementing the render
 * here would be a second path that could agree today and drift tomorrow, and the
 * one thing it might disagree about is whether a token was left raw.
 *
 * The approved body carries no placeholders, so there is normally nothing to
 * resolve; the point of routing through the shared path anyway is that a template
 * edited into a broken state is caught here rather than at the gateway.
 */
export async function buildFollowUpPreview(): Promise<FollowUpPreview> {
  const t = await getTemplate(INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID);
  const base: FollowUpPreview = {
    templateId: INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID,
    templateName: t?.name ?? "Installment Instructions",
    dltTemplateId: t?.gateway_template_id ?? null,
    senderId: t?.sender_id ?? null,
    body: "", characterCount: 0, segments: 0,
    delayMinutes: FOLLOW_UP_DELAY_MINUTES,
    sendable: false, blockDetail: null,
  };
  if (!t) return { ...base, blockDetail: "The Installment Instructions template is not configured." };
  if (!(t.status === "active" || t.status === "approved")) {
    return { ...base, blockDetail: `Template status is "${t.status}" — activate it before sending.` };
  }
  if (!t.gateway_template_id) return { ...base, blockDetail: "Template has no DLT id, so it can never be sent." };

  const p = await previewSms(INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID, {});
  if (!p) return { ...base, blockDetail: "The Installment Instructions template could not be rendered." };

  return {
    ...base,
    body: p.text,
    characterCount: p.length,
    segments: p.segments,
    sendable: p.ok,
    blockDetail: p.ok
      ? null
      : p.missing.length
        ? `Could not resolve: ${p.missing.join(", ")}.`
        : p.errors.join("; ") || "This message cannot be sent.",
  };
}

// ===========================================================================
// PERSISTENCE
// ===========================================================================
function db() { return getSupabaseAdmin(); }

const COLUMNS = "id, template_id, normalized_mobile, student_name, student_id, course_id, course_enrollment_id, installment_no, installment_fingerprint, parent_send_id, job_id, scheduled_at, status, attempts, max_attempts, last_error, cancel_reason, actor_user_id, actor_type, sent_log_id, created_at, updated_at, finished_at";

export interface ScheduleFollowUpInput {
  parentSendId: string;
  normalizedMobile: string;
  courseEnrollmentId: string;
  installmentNo: number;
  installmentFingerprint: string | null;
  studentName?: string | null;
  studentId?: string | null;
  courseId?: string | null;
  jobId?: string | null;
  actorUserId?: string | null;
  actorType?: string;
  /** Test seam only. Production always uses FOLLOW_UP_DELAY_MINUTES. */
  delayMinutes?: number;
  now?: number;
}

/**
 * Queue the follow-up. Called ONLY after step 1 has actually sent — the parent
 * log id is required and is a foreign key, so a follow-up cannot exist for a
 * reminder that never went out.
 *
 * A duplicate schedule attempt hits the unique index and returns the existing
 * row's absence quietly: the caller has nothing to fix, and the point of the
 * index is that a replay changes nothing.
 */
export async function scheduleFollowUp(input: ScheduleFollowUpInput): Promise<{ ok: boolean; id?: string; duplicate?: boolean; error?: string }> {
  const client = db();
  if (!client) return { ok: false, error: "no_db" };
  const now = input.now ?? Date.now();
  const delay = input.delayMinutes ?? FOLLOW_UP_DELAY_MINUTES;
  const scheduledAt = new Date(now + delay * 60_000).toISOString();
  try {
    const { data, error } = await client
      .from("sms_scheduled_sends")
      .insert({
        template_id: INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID,
        normalized_mobile: input.normalizedMobile,
        student_name: input.studentName ?? null,
        student_id: input.studentId ?? null,
        course_id: input.courseId ?? null,
        course_enrollment_id: input.courseEnrollmentId,
        installment_no: input.installmentNo,
        installment_fingerprint: input.installmentFingerprint,
        parent_send_id: input.parentSendId,
        job_id: input.jobId ?? null,
        scheduled_at: scheduledAt,
        actor_user_id: input.actorUserId ?? null,
        actor_type: input.actorType ?? "ADMIN",
      })
      .select("id")
      .single();
    if (error) {
      // 23505 = unique violation: this follow-up is already queued.
      if (String(error.code) === "23505") return { ok: true, duplicate: true };
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id as string };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Atomically take up to `limit` due rows. Overlapping drains never collide. */
export async function claimDueFollowUps(limit = DRAIN_BATCH_SIZE): Promise<ScheduledSend[]> {
  const client = db();
  if (!client) return [];
  const { data, error } = await client.rpc("sms_scheduled_claim", { p_limit: limit });
  if (error) return [];
  return (data || []) as ScheduledSend[];
}

/** Put rows stranded by a crashed drain back in the queue. */
export async function requeueStaleFollowUps(olderThanSeconds = STALE_CLAIM_SECONDS): Promise<number> {
  const client = db();
  if (!client) return 0;
  const { data, error } = await client.rpc("sms_scheduled_requeue_stale", { p_older_than_seconds: olderThanSeconds });
  if (error) return 0;
  return Number(data ?? 0);
}

async function finish(id: string, patch: Record<string, unknown>): Promise<void> {
  const client = db();
  if (!client) return;
  await client.from("sms_scheduled_sends").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

export async function markFollowUpSent(id: string, logId: string | null): Promise<void> {
  await finish(id, { status: "sent", sent_log_id: logId, finished_at: new Date().toISOString(), last_error: null });
}

export async function markFollowUpCancelled(id: string, reason: FollowUpCancelReason): Promise<void> {
  await finish(id, { status: "cancelled", cancel_reason: reason, finished_at: new Date().toISOString() });
}

export async function markFollowUpFailed(id: string, error: string): Promise<void> {
  await finish(id, { status: "failed", last_error: error, finished_at: new Date().toISOString() });
}

/** Hand a transiently-failed row back to the queue with backoff. */
export async function retryFollowUpLater(id: string, attempts: number, error: string): Promise<void> {
  await finish(id, {
    status: "pending",
    claimed_at: null,
    last_error: error,
    scheduled_at: new Date(Date.now() + followUpBackoffMs(attempts)).toISOString(),
  });
}

/**
 * Staff-initiated cancel of a follow-up that has not fired. Only ever touches a
 * row that is still waiting, so it cannot rewrite the history of one that went.
 */
export async function cancelFollowUpByStaff(id: string): Promise<boolean> {
  const client = db();
  if (!client) return false;
  const { data, error } = await client
    .from("sms_scheduled_sends")
    .update({
      status: "cancelled", cancel_reason: "cancelled_by_staff",
      finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .in("status", ["pending", "claimed"])
    .select("id");
  if (error) return false;
  return (data || []).length > 0;
}

/** Follow-ups for a page of enrollments, newest first — powers the row pills. */
export async function listFollowUpsForEnrollments(enrollmentIds: string[]): Promise<ScheduledSend[]> {
  const client = db();
  if (!client || !enrollmentIds.length) return [];
  const out: ScheduledSend[] = [];
  const CHUNK = 200;
  for (let i = 0; i < enrollmentIds.length; i += CHUNK) {
    const { data, error } = await client
      .from("sms_scheduled_sends")
      .select(COLUMNS)
      .in("course_enrollment_id", enrollmentIds.slice(i, i + CHUNK))
      .order("created_at", { ascending: false });
    if (!error && data) out.push(...(data as ScheduledSend[]));
  }
  return out;
}

/** Everything still waiting to fire — the pending-follow-ups panel. */
export async function listPendingFollowUps(limit = 200): Promise<ScheduledSend[]> {
  const client = db();
  if (!client) return [];
  const { data, error } = await client
    .from("sms_scheduled_sends")
    .select(COLUMNS)
    .in("status", ["pending", "claimed"])
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (error) return [];
  return (data || []) as ScheduledSend[];
}

export async function getFollowUp(id: string): Promise<ScheduledSend | null> {
  const client = db();
  if (!client) return null;
  const { data } = await client.from("sms_scheduled_sends").select(COLUMNS).eq("id", id).maybeSingle();
  return (data as ScheduledSend) ?? null;
}

// ===========================================================================
// THE DRAIN
// ===========================================================================
export interface DrainResult {
  requeued: number;
  claimed: number;
  sent: number;
  cancelled: number;
  failed: number;
  retried: number;
  byCancelReason: Record<string, number>;
}

/**
 * Dedupe key for the step-2 send: one per (queued follow-up, ATTEMPT).
 *
 * The attempt number is load-bearing and was not obvious. `sendSms` inserts the
 * log BEFORE calling the gateway, under a unique index on dedupe_key. With one
 * key per row, a transient gateway failure would leave a FAILED log holding that
 * key forever, so every retry would collide, come back as "duplicate", and be
 * recorded as "instructions already sent" — a message that never went out,
 * reported as if it had, with retries silently impossible. Keying per attempt
 * makes a retry a genuinely new log, which is what it is.
 *
 * Double-sending is still impossible, by two other means: a row can only be
 * claimed by one drain (FOR UPDATE SKIP LOCKED), and before every attempt the
 * re-validation refuses when an instructions message has ALREADY reached this
 * number (`alreadyInstructed`, which counts only SENT/DELIVERED/QUEUED). So the
 * one case this key used to "protect" — the same row processed twice after a
 * crash — is caught by the check that can tell a delivered message from a failed
 * one, which a dedupe key cannot.
 */
export function followUpDedupeKey(job: Pick<ScheduledSend, "id" | "course_enrollment_id" | "installment_no" | "attempts">): string {
  return `installment_instructions:${job.course_enrollment_id}:${job.installment_no}:${job.id}:a${job.attempts}`;
}

/**
 * The one call that talks to the gateway, behind a seam.
 *
 * Production always uses `sendSms` — the default below — so there is exactly one
 * send path and one set of safeguards. The seam exists so QA can drive the queue,
 * the lock, the retries and the crash recovery end to end while PROVING nothing
 * outbound happened: a stub here cannot reach the network by construction, which
 * is a stronger guarantee than remembering to keep a flag switched off.
 */
export type FollowUpSender = typeof sendSms;

export interface FollowUpDeps {
  send?: FollowUpSender;
}

/**
 * Process one claimed follow-up: re-validate, then send or cancel.
 * Exported so a test can drive a single job without a queue.
 */
export async function processFollowUp(job: ScheduledSend, deps: FollowUpDeps = {}): Promise<"sent" | "cancelled" | "failed" | "retried"> {
  const send = deps.send ?? sendSms;
  const [enrollment, template, optedOut, alreadyInstructed] = await Promise.all([
    getCourseEnrollmentById(job.course_enrollment_id).catch(() => null),
    getTemplate(job.template_id).catch(() => null),
    isOptedOut(job.normalized_mobile).catch(() => false),
    recentSameTemplate(job.normalized_mobile, job.template_id, INSTRUCTIONS_REPEAT_WINDOW_MIN).catch(() => false),
  ]);

  const decision = evaluateFollowUp(job, { enrollment, template, optedOut, alreadyInstructed });
  if (!decision.send) {
    await markFollowUpCancelled(job.id, decision.reason);
    return "cancelled";
  }

  const result = await send({
    mobile: job.normalized_mobile,
    templateId: job.template_id,
    // The approved body has no placeholders, so there is nothing to resolve and
    // nothing that can be left raw. The guard still runs inside sendSms.
    variables: {},
    relatedEntity: {
      student_name: job.student_name,
      user_id: job.student_id,
      course_id: job.course_id,
    },
    sentBy: { userId: job.actor_user_id, type: job.actor_type === "SYSTEM" ? "SYSTEM" : "ADMIN" },
    triggerEvent: "installment_instructions_followup",
    audienceType: "installment_reminder",
    dedupeKey: followUpDedupeKey(job),
    campaignId: job.job_id,
    // Same composite key as the reminder, so the pair is provably about one line.
    installmentKey: {
      courseEnrollmentId: job.course_enrollment_id,
      installmentNo: job.installment_no,
      fingerprint: job.installment_fingerprint ?? installmentFingerprint(decision.line),
    },
    // This is a distinct template from the reminder, so the 30-minute
    // same-template guard is about repeat INSTRUCTIONS only — which the
    // already_instructed check above has already ruled out.
  });

  if (result.ok) {
    await markFollowUpSent(job.id, result.logId ?? null);
    return "sent";
  }

  const terminal = terminalSkipReason(result.skipped);
  if (terminal) {
    await markFollowUpCancelled(job.id, terminal);
    return "cancelled";
  }

  const detail = result.error || result.skipped || "send_failed";
  if (isTransientSendFailure(result.skipped, result.error) && job.attempts < job.max_attempts) {
    await retryFollowUpLater(job.id, job.attempts, detail);
    return "retried";
  }
  await markFollowUpFailed(job.id, detail);
  return "failed";
}

/**
 * Drain due follow-ups. Safe to run concurrently with itself and safe to run
 * more often than needed — an empty queue costs one indexed query.
 *
 * THROTTLE. Sends run one after another, never fanned out, and a tick takes at
 * most DRAIN_BATCH_SIZE of them. Fifty reminders sent as a bulk job therefore
 * produce fifty follow-ups that leave in a paced line rather than a burst, and
 * anything beyond one tick's worth simply waits for the next tick — which is
 * what the queue is for.
 */
export async function drainDueFollowUps(opts: { limit?: number } & FollowUpDeps = {}): Promise<DrainResult> {
  const out: DrainResult = { requeued: 0, claimed: 0, sent: 0, cancelled: 0, failed: 0, retried: 0, byCancelReason: {} };
  out.requeued = await requeueStaleFollowUps();

  const jobs = await claimDueFollowUps(opts.limit ?? DRAIN_BATCH_SIZE);
  out.claimed = jobs.length;

  for (const job of jobs) {
    try {
      const result = await processFollowUp(job, { send: opts.send });
      if (result === "sent") out.sent++;
      else if (result === "cancelled") {
        out.cancelled++;
        const row = await getFollowUp(job.id);
        const reason = row?.cancel_reason ?? "unknown";
        out.byCancelReason[reason] = (out.byCancelReason[reason] || 0) + 1;
      }
      else if (result === "retried") out.retried++;
      else out.failed++;
    } catch (e) {
      // A thrown error must not strand the row as 'claimed' or stop the tick.
      const msg = (e as Error).message || "drain_error";
      if (job.attempts < job.max_attempts) { await retryFollowUpLater(job.id, job.attempts, msg); out.retried++; }
      else { await markFollowUpFailed(job.id, msg); out.failed++; }
    }
  }
  return out;
}
