/**
 * Server-side assembly of an installment reminder: resolve the student's real
 * installment, render the DLT body, and decide whether the send is allowed.
 *
 * ONE rendering path, used three ways. `buildReminderFor` is pure and does the
 * whole resolve → render → guard sequence for a single enrollment; the
 * single-student preview, the bulk review screen and both send routes all call
 * it. The preview therefore cannot disagree with the send: if `sendable` is
 * false the route refuses, and the UI shows the same `blockReason` it refused
 * for. A bulk job that rendered its own bodies would be a second source of
 * truth for the one thing this whole feature exists to get right.
 *
 * The split is only about I/O. Everything a reminder needs that is NOT
 * per-enrollment (the template, the variable-store defaults, the opt-out set,
 * buyer identity, recent-send history) is fetched once into a ReminderContext,
 * so 500 recipients cost a handful of queries rather than 500 × 4.
 */
import { getCourseEnrollmentById, getCourseEnrollmentsByPhone } from "../dataProvider";
import { maskMobile, normalizeIndianMobile } from "../phone";
import { renderTemplate, uniqueVariables, validateBody } from "./templates";
import { isResolvedValue, lookupVariable, registryKeyFor } from "./variableRegistry";
import { checkRenderedBody } from "./sendGuard";
import {
  getTemplate, listLogs, firstNamesMatch, optedOutSet, resolveBuyersByPhones,
  type BuyerResolution,
} from "./store";
import { getResolvedDefaults } from "./variables";
import { mergeSendVars, type InstallmentKey } from "./service";
import { installmentFingerprint } from "./installmentAttribution";
import {
  installmentReminderVars, pickReminderEnrollment, resolveInstallmentForEnrollment,
  type ResolvedInstallment,
} from "./installmentReminder";
import type { CourseEnrollment } from "../types";
import type { SmsTemplate } from "./types";

/** The DLT-approved "Installment Reminder" template. */
export const INSTALLMENT_REMINDER_TEMPLATE_ID = "installment_reminder";

/** 24h idempotency window — a WARNING, never a silent block. */
export const REPEAT_WARN_WINDOW_HOURS = 24;

/** Hard ceiling on one bulk job, per the brief. */
export const MAX_BULK_RECIPIENTS = 500;

export type ReminderBlockReason =
  | "enrollment_not_found"
  | "missing_phone"
  | "invalid_mobile"
  | "template_missing"
  | "template_inactive"
  | "no_dlt_id"
  | "opted_out"
  | "no_active_enrollment"
  | "no_unpaid_installment"
  | "seat_booking_only"
  | "not_yet_due"
  | "zero_balance"
  | "render_blocked"
  | "invalid_body";

export interface ReminderVariableView {
  /** The token EXACTLY as it appears in the approved DLT body. */
  token: string;
  /** Canonical registry key it resolved through, when registered. */
  canonicalKey: string | null;
  value: string;
  resolved: boolean;
}

export interface InstallmentReminderPreview {
  enrollmentId: string;
  studentName: string;
  /** ALWAYS masked. The unmasked number never leaves the server. */
  maskedPhone: string;
  courseTitle: string;
  batchLabel: string | null;
  templateId: string;
  templateName: string;
  /** DLT gateway template id, shown so staff can verify the registration. */
  dltTemplateId: string | null;
  senderId: string | null;
  /** Fully rendered body for THIS student. */
  body: string;
  variables: ReminderVariableView[];
  installmentNo: number | null;
  amountDue: number | null;
  dueDate: string | null;
  isOverdue: boolean;
  daysOverdue: number;
  /** >1 means the reminder targets the OLDEST of several unpaid installments. */
  unpaidCount: number;
  totalRemaining: number | null;
  /** Cross-check against the figure the EMI / at-risk pages show. */
  matchesPageNextPayable: boolean;
  characterCount: number;
  segments: number;
  sendable: boolean;
  blockReason: ReminderBlockReason | null;
  blockDetail: string | null;
  /** Non-blocking warnings (repeat send in 24h, long body, …). */
  warnings: string[];
  /** ISO timestamp of the last same-template send inside the warn window. */
  lastSentAt: string | null;
  /** How many times this template already went to this student (any time). */
  priorReminderCount: number;
  /** Persisted on the log so a later payment can be correlated with this send. */
  installmentKey: InstallmentKey | null;
}

function fail(
  reason: ReminderBlockReason,
  detail: string,
  base: Partial<InstallmentReminderPreview> = {},
): InstallmentReminderPreview {
  return {
    enrollmentId: "", studentName: "", maskedPhone: "—", courseTitle: "", batchLabel: null,
    templateId: INSTALLMENT_REMINDER_TEMPLATE_ID, templateName: "Installment Reminder",
    dltTemplateId: null, senderId: null, body: "", variables: [],
    installmentNo: null, amountDue: null, dueDate: null, isOverdue: false, daysOverdue: 0,
    unpaidCount: 0, totalRemaining: null, matchesPageNextPayable: true,
    characterCount: 0, segments: 0,
    sendable: false, blockReason: reason, blockDetail: detail, warnings: [], lastSentAt: null,
    priorReminderCount: 0, installmentKey: null,
    ...base,
  };
}

/** Map a resolver block reason onto the route-level reason vocabulary. */
const RESOLVER_REASONS: Record<string, ReminderBlockReason> = {
  no_active_enrollment: "no_active_enrollment",
  no_unpaid_installment: "no_unpaid_installment",
  seat_booking_only: "seat_booking_only",
  zero_balance: "zero_balance",
  missing_phone: "missing_phone",
};

// ---------------------------------------------------------------------------
// CONTEXT — everything that is NOT per-enrollment, fetched once.
// ---------------------------------------------------------------------------
export interface ReminderContext {
  template: SmsTemplate;
  varDefaults: Record<string, string>;
  optedOut: Set<string>;
  buyers: Map<string, BuyerResolution>;
  /** digits10 → most recent same-template send inside the 24h warn window. */
  recentByMobile: Map<string, string>;
  /** digits10 → total same-template sends ever (prior reminder count). */
  priorCountByMobile: Map<string, number>;
  now: number;
  /** Only overdue installments are eligible when true (the safe default). */
  overdueOnly: boolean;
}

/** A template-level refusal: nothing can be sent, so the whole job is blocked. */
export type ContextFailure = { ok: false; reason: ReminderBlockReason; detail: string };

/**
 * Fetch the shared context for a set of enrollments. Template gating happens
 * here because it is job-level, not per-recipient: an inactive template blocks
 * everyone identically, and discovering that 500 times would be pointless.
 */
export async function buildReminderContext(
  enrollments: Pick<CourseEnrollment, "phone">[],
  opts: { now?: number; overdueOnly?: boolean } = {},
): Promise<{ ok: true; ctx: ReminderContext } | ContextFailure> {
  const now = opts.now ?? Date.now();
  const template = await getTemplate(INSTALLMENT_REMINDER_TEMPLATE_ID);
  if (!template) return { ok: false, reason: "template_missing", detail: "The Installment Reminder template is not configured." };
  if (!(template.status === "active" || template.status === "approved")) {
    return { ok: false, reason: "template_inactive", detail: `Template status is "${template.status}" — activate it before sending.` };
  }
  if (!template.gateway_template_id) {
    return { ok: false, reason: "no_dlt_id", detail: "Template has no DLT id, so it can never be sent." };
  }

  const digits = [...new Set(
    enrollments
      .map((e) => normalizeIndianMobile(e.phone || ""))
      .filter((n) => n.ok && n.digits10)
      .map((n) => n.digits10!),
  )];

  const since = new Date(now - REPEAT_WARN_WINDOW_HOURS * 3600_000).toISOString();
  const [varDefaults, optedOut, recentLogs, allLogs] = await Promise.all([
    getResolvedDefaults(INSTALLMENT_REMINDER_TEMPLATE_ID),
    optedOutSet(digits),
    listLogs({ from: since, templateId: INSTALLMENT_REMINDER_TEMPLATE_ID, limit: 5000 }),
    listLogs({ templateId: INSTALLMENT_REMINDER_TEMPLATE_ID, limit: 5000 }),
  ]);
  const buyers = await resolveBuyersByPhones(digits);

  const wanted = new Set(digits);
  const delivered = (s: string) => ["SENT", "DELIVERED", "QUEUED"].includes(s);

  const recentByMobile = new Map<string, string>();
  for (const l of recentLogs) {
    if (!wanted.has(l.normalized_mobile) || !delivered(l.status)) continue;
    const at = l.sent_at || l.created_at;
    const prev = recentByMobile.get(l.normalized_mobile);
    if (!prev || prev < at) recentByMobile.set(l.normalized_mobile, at);
  }

  const priorCountByMobile = new Map<string, number>();
  for (const l of allLogs) {
    if (!wanted.has(l.normalized_mobile) || !delivered(l.status)) continue;
    priorCountByMobile.set(l.normalized_mobile, (priorCountByMobile.get(l.normalized_mobile) || 0) + 1);
  }

  return {
    ok: true,
    ctx: { template, varDefaults, optedOut, buyers, recentByMobile, priorCountByMobile, now, overdueOnly: opts.overdueOnly !== false },
  };
}

// ---------------------------------------------------------------------------
// THE ONE RENDERING PATH — pure, per enrollment.
// ---------------------------------------------------------------------------
/**
 * Resolve, render and gate a reminder for ONE enrollment. Pure: every lookup it
 * needs is already in `ctx`. Never throws; every failure is a named
 * `blockReason` so the UI can show a reason instead of a silent omission.
 */
export function buildReminderFor(enrollment: CourseEnrollment, ctx: ReminderContext): InstallmentReminderPreview {
  const { template, now } = ctx;
  const maskedPhone = maskMobile(enrollment.phone);
  const partial: Partial<InstallmentReminderPreview> = {
    enrollmentId: enrollment.id,
    studentName: enrollment.student_name,
    maskedPhone,
    courseTitle: enrollment.course_title,
    batchLabel: enrollment.batch_label ?? null,
    templateName: template.name,
    dltTemplateId: template.gateway_template_id,
    senderId: template.sender_id ?? null,
  };

  // ---- contactability ----
  if (!enrollment.phone?.trim()) return fail("missing_phone", "This student has no phone number on record.", partial);
  const n = normalizeIndianMobile(enrollment.phone);
  if (!n.ok || !n.digits10) return fail("invalid_mobile", n.error || "Phone number is not a valid Indian mobile.", partial);
  const digits10 = n.digits10;

  // ---- consent / suppression ----
  if (ctx.optedOut.has(digits10)) {
    return fail("opted_out", "This number is in the SMS opt-out list.", partial);
  }

  // ---- installment facts (course_enrollments.schedule + deriveCollections) ----
  const resolution = resolveInstallmentForEnrollment(enrollment, now);
  if (!resolution.ok) {
    return fail(RESOLVER_REASONS[resolution.reason] ?? "no_unpaid_installment", resolution.detail, partial);
  }
  const r: ResolvedInstallment = resolution.resolved;

  const daysOverdue = r.dueDate ? Math.max(0, Math.floor((now - new Date(r.dueDate).getTime()) / 86_400_000)) : 0;
  Object.assign(partial, { installmentNo: r.installmentNo, amountDue: r.amountDue, dueDate: r.dueDate, isOverdue: r.isOverdue, daysOverdue, unpaidCount: r.unpaidCount, totalRemaining: r.totalRemaining, matchesPageNextPayable: r.matchesPageNextPayable });

  // The safe default: only chase money that is actually late. An upcoming
  // installment is excluded with its own reason rather than quietly included.
  if (ctx.overdueOnly && !r.isOverdue) {
    return fail("not_yet_due", r.dueDate
      ? `Installment ${r.installmentNo} is not due until ${String(r.dueDate).slice(0, 10)}.`
      : `Installment ${r.installmentNo} has no due date, so it is not overdue.`, partial);
  }

  // ---- per-recipient variables ----
  // login_code is attached only when it provably belongs to THIS student: one
  // buyer on the number and the first names agree. Same rule the audience
  // resolver uses, so a shared handset never leaks another person's code.
  const buyer = ctx.buyers.get(digits10);
  const loginCode = buyer && buyer.status === "ok" && buyer.login_code && firstNamesMatch(enrollment.student_name, buyer.name)
    ? buyer.login_code
    : "";

  const recipientVars: Record<string, string> = {
    name: enrollment.student_name,
    first_name: String(enrollment.student_name || "").trim().split(/\s+/)[0] || "",
    login_code: loginCode,
    ...installmentReminderVars(r),
  };
  const filled = mergeSendVars(INSTALLMENT_REMINDER_TEMPLATE_ID, ctx.varDefaults, recipientVars);

  // ---- render + guard (identical to the send path) ----
  const { text, missing } = renderTemplate(template.body_template, filled);
  const validation = validateBody(text);
  const guard = checkRenderedBody(text, filled);

  Object.assign(partial, {
    body: text,
    variables: buildVariableView(template.body_template, filled),
    characterCount: validation.analysis.length,
    segments: validation.analysis.segments,
  });

  if (!guard.ok || missing.length) {
    const detail = guard.detail || `Could not resolve: ${missing.join(", ")}.`;
    return fail("render_blocked", detail, partial);
  }
  if (!validation.ok) return fail("invalid_body", validation.errors.join("; "), partial);

  // ---- non-blocking warnings ----
  const warnings = [...validation.warnings];
  if (!r.matchesPageNextPayable) {
    warnings.push("This enrollment's next payable line is not an installment, so the reminder targets the oldest unpaid installment instead.");
  }
  if (r.unpaidCount > 1) {
    warnings.push(`${r.unpaidCount} unpaid installments — this reminder refers to the OLDEST one (no. ${r.installmentNo}).`);
  }
  const lastSentAt = ctx.recentByMobile.get(digits10) ?? null;
  if (lastSentAt) {
    warnings.push(`This template already went to this student at ${lastSentAt} (within ${REPEAT_WARN_WINDOW_HOURS}h). Sending again will be a repeat.`);
  }

  return {
    ...(partial as InstallmentReminderPreview),
    sendable: true,
    blockReason: null,
    blockDetail: null,
    warnings,
    lastSentAt,
    priorReminderCount: ctx.priorCountByMobile.get(digits10) ?? 0,
    // Captured at SEND TIME and never updated, so a plan change cannot make this
    // point at a different installment. See ./installmentAttribution.ts.
    installmentKey: {
      courseEnrollmentId: enrollment.id,
      installmentNo: r.installmentNo,
      fingerprint: installmentFingerprint(r.line),
    },
  };
}

// ---------------------------------------------------------------------------
// SINGLE STUDENT — unchanged public API.
// ---------------------------------------------------------------------------
export interface BuildReminderInput {
  /** Preferred: the exact enrollment a staff member clicked on. */
  enrollmentId?: string | null;
  /** Fallback for surfaces that only know the student (picks the worst enrollment). */
  phone?: string | null;
  now?: number;
  /**
   * The single-student button deliberately does NOT force overdue-only: staff
   * clicking one student's row may legitimately chase an upcoming installment.
   * Bulk defaults the other way. Behaviour here is unchanged from before.
   */
  overdueOnly?: boolean;
}

/**
 * Resolve, render and gate an installment reminder for ONE student.
 * Never throws; every failure is a named `blockReason`.
 */
export async function buildInstallmentReminder(input: BuildReminderInput): Promise<InstallmentReminderPreview> {
  const now = input.now ?? Date.now();

  let enrollment: CourseEnrollment | null = null;
  if (input.enrollmentId) {
    enrollment = await getCourseEnrollmentById(input.enrollmentId);
  } else if (input.phone) {
    enrollment = pickReminderEnrollment(await getCourseEnrollmentsByPhone(input.phone), now);
  }
  if (!enrollment) return fail("enrollment_not_found", "No matching enrollment for this student.");

  const ctx = await buildReminderContext([enrollment], { now, overdueOnly: input.overdueOnly === true });
  if (!ctx.ok) {
    return fail(ctx.reason, ctx.detail, {
      enrollmentId: enrollment.id,
      studentName: enrollment.student_name,
      maskedPhone: maskMobile(enrollment.phone),
      courseTitle: enrollment.course_title,
      batchLabel: enrollment.batch_label ?? null,
    });
  }
  return buildReminderFor(enrollment, ctx.ctx);
}

// ---------------------------------------------------------------------------
// BULK — same builder, one context.
// ---------------------------------------------------------------------------
export interface BulkReminderPreview {
  previews: InstallmentReminderPreview[];
  /** Job-level refusal (template gate). When set, `previews` is empty. */
  blockReason: ReminderBlockReason | null;
  blockDetail: string | null;
  sendableCount: number;
  excludedCount: number;
  /** blockReason → how many recipients it excluded. */
  excludedByReason: Record<string, number>;
  totalSegments: number;
  dltTemplateId: string | null;
  templateName: string;
  /** Recipients dropped because the request exceeded MAX_BULK_RECIPIENTS. */
  overCapDropped: number;
}

/**
 * Build a preview for every selected enrollment through the SAME builder the
 * single-student path uses. Order follows the caller's selection so the review
 * screen matches the table the staff member was looking at.
 */
export async function buildBulkInstallmentReminders(
  enrollmentIds: string[],
  opts: { now?: number; overdueOnly?: boolean } = {},
): Promise<BulkReminderPreview> {
  const now = opts.now ?? Date.now();
  const unique = [...new Set(enrollmentIds.filter(Boolean))];
  const capped = unique.slice(0, MAX_BULK_RECIPIENTS);
  const overCapDropped = unique.length - capped.length;

  const empty = (reason: ReminderBlockReason | null, detail: string | null): BulkReminderPreview => ({
    previews: [], blockReason: reason, blockDetail: detail, sendableCount: 0, excludedCount: 0,
    excludedByReason: {}, totalSegments: 0, dltTemplateId: null,
    templateName: "Installment Reminder", overCapDropped,
  });
  if (!capped.length) return empty(null, null);

  const enrollments = (await Promise.all(capped.map((id) => getCourseEnrollmentById(id))))
    .filter((e): e is CourseEnrollment => !!e);

  const ctx = await buildReminderContext(enrollments, { now, overdueOnly: opts.overdueOnly !== false });
  if (!ctx.ok) return empty(ctx.reason, ctx.detail);

  const previews = enrollments.map((e) => buildReminderFor(e, ctx.ctx));

  // A selected id that no longer resolves must be reported, not silently lost.
  const found = new Set(enrollments.map((e) => e.id));
  for (const id of capped) {
    if (!found.has(id)) previews.push(fail("enrollment_not_found", "This enrollment no longer exists.", { enrollmentId: id }));
  }

  const excludedByReason: Record<string, number> = {};
  let sendableCount = 0, totalSegments = 0;
  for (const p of previews) {
    if (p.sendable) { sendableCount++; totalSegments += p.segments; }
    else excludedByReason[p.blockReason || "unknown"] = (excludedByReason[p.blockReason || "unknown"] || 0) + 1;
  }

  return {
    previews,
    blockReason: null,
    blockDetail: null,
    sendableCount,
    excludedCount: previews.length - sendableCount,
    excludedByReason,
    totalSegments,
    dltTemplateId: ctx.ctx.template.gateway_template_id,
    templateName: ctx.ctx.template.name,
    overCapDropped,
  };
}

/** Per-token view for the preview modal: what each DLT token resolved to. */
function buildVariableView(body: string, filled: Record<string, string | number | null | undefined>): ReminderVariableView[] {
  return uniqueVariables(body).map((token) => {
    const value = lookupVariable(filled, token);
    return {
      token,
      canonicalKey: registryKeyFor(token),
      value: isResolvedValue(value) ? String(value) : "",
      resolved: isResolvedValue(value),
    };
  });
}
