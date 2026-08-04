/**
 * Access At Risk reminder: resolve installment + live lecture access, pick the
 * blocked vs expiring template, render through the SAME path as installment
 * reminders. Preview and send share this builder — staff cannot approve a body
 * the send route will refuse, or vice versa.
 */
import { getCourseEnrollmentById, getAllCourses, getAccessOverridesByPhone } from "../dataProvider";
import { lectureAccessForCourse, type LectureAccess } from "../entitlements";
import { maskMobile, normalizeIndianMobile } from "../phone";
import { uniqueVariables } from "./templates";
import { isResolvedValue, lookupVariable, registryKeyFor } from "./variableRegistry";
import { prepareAndRenderSms } from "./renderPipeline";
import {
  getTemplate, listLogs, firstNamesMatch, optedOutSet, resolveBuyersByPhones,
  type BuyerResolution,
} from "./store";
import { getResolvedDefaults } from "./variables";
import { mergeSendVars, type InstallmentKey } from "./service";
import { installmentFingerprint } from "./installmentAttribution";
import {
  installmentReminderVars, resolveInstallmentForEnrollment,
  type ResolvedInstallment,
} from "./installmentReminder";
import { istWholeDaysUntil } from "./accessDays";
import {
  ACCESS_BLOCKED_TEMPLATE_ID,
  ACCESS_EXPIRING_TEMPLATE_ID,
  ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID,
  ACCESS_MAX_BULK,
} from "./accessReminderConstants";
import type { Course, CourseEnrollment, CourseAccessOverride } from "../types";
import type { SmsTemplate } from "./types";

export const REPEAT_WARN_WINDOW_HOURS = 24;

export type AccessReminderBlockReason =
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
  | "zero_balance"
  | "not_access_risk"
  | "days_not_positive"
  | "access_restored"
  | "data_inconsistency"
  | "missing_login_code"
  | "render_blocked"
  | "invalid_body"
  | "kill_switch"
  | "quiet_hours"
  | "already_sent_today"
  | "daily_ceiling"
  | "needs_call";

/** Active temporary grant holding access open (mode=grant, not expired). */
export function activeAccessGrant(
  override: CourseAccessOverride | undefined | null,
  now = Date.now(),
): CourseAccessOverride | null {
  if (!override || override.mode !== "grant") return null;
  if (!override.expires_at) return override; // indefinite — report separately; still "active"
  const exp = Date.parse(override.expires_at);
  if (!Number.isFinite(exp) || exp <= now) return null;
  return override;
}

export interface ReminderVariableView {
  token: string;
  canonicalKey: string | null;
  value: string;
  resolved: boolean;
}

export interface AccessReminderPreview {
  enrollmentId: string;
  studentId: string | null;
  studentName: string;
  maskedPhone: string;
  courseTitle: string;
  batchLabel: string | null;
  templateId: string;
  templateName: string;
  dltTemplateId: string | null;
  senderId: string | null;
  body: string;
  variables: ReminderVariableView[];
  accessStatus: "blocked" | "grace" | string;
  /** Live playback access (may differ from schedule when a grant is active). */
  liveAccessAllowed: boolean;
  scheduleStatus: string;
  grantExpiresAt: string | null;
  daysLeft: number | null;
  daysSource: "grace" | "override" | null;
  installmentNo: number | null;
  amountDue: number | null;
  dueDate: string | null;
  unpaidCount: number;
  totalRemaining: number | null;
  characterCount: number;
  segments: number;
  sendable: boolean;
  blockReason: AccessReminderBlockReason | null;
  blockDetail: string | null;
  warnings: string[];
  lastSentAt: string | null;
  priorReminderCount: number;
  installmentKey: InstallmentKey | null;
  /** Known cosmetic: approved copy says "1 days". */
  daysSingularCosmetic: boolean;
}

function fail(
  reason: AccessReminderBlockReason,
  detail: string,
  base: Partial<AccessReminderPreview> = {},
): AccessReminderPreview {
  return {
    enrollmentId: "", studentId: null, studentName: "", maskedPhone: "—", courseTitle: "", batchLabel: null,
    templateId: "", templateName: "Access Reminder",
    dltTemplateId: null, senderId: null, body: "", variables: [],
    accessStatus: "", liveAccessAllowed: false, scheduleStatus: "", grantExpiresAt: null,
    daysLeft: null, daysSource: null, installmentNo: null, amountDue: null, dueDate: null,
    unpaidCount: 0, totalRemaining: null,
    characterCount: 0, segments: 0,
    sendable: false, blockReason: reason, blockDetail: detail, warnings: [], lastSentAt: null,
    priorReminderCount: 0, installmentKey: null, daysSingularCosmetic: false,
    ...base,
  };
}

const RESOLVER_REASONS: Record<string, AccessReminderBlockReason> = {
  no_active_enrollment: "no_active_enrollment",
  no_unpaid_installment: "no_unpaid_installment",
  seat_booking_only: "seat_booking_only",
  zero_balance: "zero_balance",
  missing_phone: "missing_phone",
};

const ACCESS_TEMPLATE_IDS = [
  ACCESS_BLOCKED_TEMPLATE_ID,
  ACCESS_EXPIRING_TEMPLATE_ID,
  ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID,
] as const;

export interface AccessReminderContext {
  templates: Map<string, SmsTemplate>;
  varDefaults: Map<string, Record<string, string>>;
  optedOut: Set<string>;
  buyers: Map<string, BuyerResolution>;
  recentByMobile: Map<string, string>;
  priorCountByMobile: Map<string, number>;
  courses: Map<string, Course>;
  overridesByPhoneCourse: Map<string, CourseAccessOverride>;
  now: number;
}

export type AccessContextFailure = { ok: false; reason: AccessReminderBlockReason; detail: string };

async function gateTemplate(id: string): Promise<{ ok: true; template: SmsTemplate } | AccessContextFailure> {
  const template = await getTemplate(id);
  if (!template) return { ok: false, reason: "template_missing", detail: `Template "${id}" is not configured.` };
  if (!(template.status === "active" || template.status === "approved")) {
    return { ok: false, reason: "template_inactive", detail: `Template status is "${template.status}" — activate it before sending.` };
  }
  if (!template.gateway_template_id) {
    return { ok: false, reason: "no_dlt_id", detail: `Template "${id}" has no DLT id.` };
  }
  return { ok: true, template };
}

export async function buildAccessReminderContext(
  enrollments: Pick<CourseEnrollment, "phone" | "course_id">[],
  opts: { now?: number; courses?: Map<string, Course> } = {},
): Promise<{ ok: true; ctx: AccessReminderContext } | AccessContextFailure> {
  const now = opts.now ?? Date.now();

  const templates = new Map<string, SmsTemplate>();
  for (const id of ACCESS_TEMPLATE_IDS) {
    const g = await gateTemplate(id);
    if (!g.ok) return g;
    templates.set(id, g.template);
  }

  const digits = [...new Set(
    enrollments
      .map((e) => normalizeIndianMobile(e.phone || ""))
      .filter((n) => n.ok && n.digits10)
      .map((n) => n.digits10!),
  )];

  const since = new Date(now - REPEAT_WARN_WINDOW_HOURS * 3600_000).toISOString();
  const [blockedDefaults, expiringDefaults, installmentDefaults, optedOut, recentBlocked, recentExpiring, recentInstallment, allBlocked, allExpiring, allInstallment] = await Promise.all([
    getResolvedDefaults(ACCESS_BLOCKED_TEMPLATE_ID),
    getResolvedDefaults(ACCESS_EXPIRING_TEMPLATE_ID),
    getResolvedDefaults(ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID),
    optedOutSet(digits),
    listLogs({ from: since, templateId: ACCESS_BLOCKED_TEMPLATE_ID, limit: 5000 }),
    listLogs({ from: since, templateId: ACCESS_EXPIRING_TEMPLATE_ID, limit: 5000 }),
    listLogs({ from: since, templateId: ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID, limit: 5000 }),
    listLogs({ templateId: ACCESS_BLOCKED_TEMPLATE_ID, limit: 5000 }),
    listLogs({ templateId: ACCESS_EXPIRING_TEMPLATE_ID, limit: 5000 }),
    listLogs({ templateId: ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID, limit: 5000 }),
  ]);
  const buyers = await resolveBuyersByPhones(digits);

  const wanted = new Set(digits);
  const delivered = (s: string) => ["SENT", "DELIVERED", "QUEUED"].includes(s);

  const recentByMobile = new Map<string, string>();
  for (const l of [...recentBlocked, ...recentExpiring, ...recentInstallment]) {
    if (!wanted.has(l.normalized_mobile) || !delivered(l.status)) continue;
    const at = l.sent_at || l.created_at;
    const prev = recentByMobile.get(l.normalized_mobile);
    if (!prev || prev < at) recentByMobile.set(l.normalized_mobile, at);
  }

  const priorCountByMobile = new Map<string, number>();
  for (const l of [...allBlocked, ...allExpiring, ...allInstallment]) {
    if (!wanted.has(l.normalized_mobile) || !delivered(l.status)) continue;
    priorCountByMobile.set(l.normalized_mobile, (priorCountByMobile.get(l.normalized_mobile) || 0) + 1);
  }

  const courses = opts.courses ?? new Map<string, Course>();
  if (!opts.courses) {
    for (const c of await getAllCourses()) courses.set(c.id, c);
  }

  const overridesByPhoneCourse = new Map<string, CourseAccessOverride>();
  const phones = [...new Set(enrollments.map((e) => e.phone).filter(Boolean))];
  await Promise.all(phones.map(async (phone) => {
    const ovrs = await getAccessOverridesByPhone(phone);
    for (const o of ovrs) overridesByPhoneCourse.set(`${o.phone}::${o.course_id}`, o);
  }));

  return {
    ok: true,
    ctx: {
      templates,
      varDefaults: new Map([
        [ACCESS_BLOCKED_TEMPLATE_ID, blockedDefaults],
        [ACCESS_EXPIRING_TEMPLATE_ID, expiringDefaults],
        [ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID, installmentDefaults],
      ]),
      optedOut, buyers, recentByMobile, priorCountByMobile, courses, overridesByPhoneCourse, now,
    },
  };
}

export type AccessTemplatePick =
  | { templateId: string; daysSource: "grace" | "override"; daysEndAt: string | null; scheduleStatus: string }
  | { block: AccessReminderBlockReason; detail: string; scheduleStatus: string };

/**
 * Reminder eligibility follows the SCHEDULE, not a temporary access grant.
 *
 * Roles (approved templates only):
 *   installment_reminder  — notice while a grant holds the door (grandfather / −7d path)
 *   portal_access_expiring — genuine dated grace notice (no grant)
 *   portal_access_blocked  — lectures actually gated (blocked, no grant)
 */
export function pickAccessTemplate(input: {
  scheduleAccess: LectureAccess;
  override: CourseAccessOverride | null | undefined;
  totalRemaining: number;
  now?: number;
}): AccessTemplatePick {
  const now = input.now ?? Date.now();
  const schedule = input.scheduleAccess;
  const grant = activeAccessGrant(input.override, now);

  if (input.totalRemaining <= 0) {
    return { block: "access_restored", detail: "Nothing outstanding — no access-risk reminder applies.", scheduleStatus: schedule.status };
  }

  const scheduleBlocked = schedule.status === "blocked" && schedule.reason === "overdue";
  const scheduleGrace = schedule.status === "grace";

  // Enforcement: lectures gated, no grant → blocked template.
  if (scheduleBlocked && !grant) {
    return { templateId: ACCESS_BLOCKED_TEMPLATE_ID, daysSource: "grace", daysEndAt: schedule.graceEndsAt ?? null, scheduleStatus: "blocked" };
  }
  // Grandfather / temporary restore: grant holding door while schedule overdue → installment_reminder.
  if (scheduleBlocked && grant) {
    return {
      templateId: ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID,
      daysSource: "override",
      daysEndAt: grant.expires_at,
      scheduleStatus: "blocked_with_grant",
    };
  }
  // Genuine dated grace notice (classic 15d) — expiring copy.
  if (scheduleGrace && !grant) {
    return { templateId: ACCESS_EXPIRING_TEMPLATE_ID, daysSource: "grace", daysEndAt: schedule.graceEndsAt ?? null, scheduleStatus: "grace" };
  }
  if (scheduleGrace && grant) {
    const graceEnd = schedule.graceEndsAt ? Date.parse(schedule.graceEndsAt) : Infinity;
    const grantEnd = grant.expires_at ? Date.parse(grant.expires_at) : Infinity;
    const useGrant = grantEnd <= graceEnd;
    // Grant during grace still uses installment_reminder (amount + code).
    return {
      templateId: ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID,
      daysSource: useGrant ? "override" : "grace",
      daysEndAt: useGrant ? grant.expires_at : (schedule.graceEndsAt ?? null),
      scheduleStatus: "grace_with_grant",
    };
  }

  return {
    block: "not_access_risk",
    detail: `Schedule status "${schedule.status}" (${schedule.reason}) is not a collections access-risk case.`,
    scheduleStatus: schedule.status,
  };
}

/** @deprecated — use pickAccessTemplate({ scheduleAccess, override, totalRemaining }). Kept for tests that pass LectureAccess alone. */
export function pickAccessTemplateLegacy(access: LectureAccess): { templateId: string } | { block: AccessReminderBlockReason; detail: string } {
  const r = pickAccessTemplate({ scheduleAccess: access, override: null, totalRemaining: 1 });
  if ("block" in r) return { block: r.block, detail: r.detail };
  return { templateId: r.templateId };
}

export function buildAccessReminderFor(
  enrollment: CourseEnrollment,
  ctx: AccessReminderContext,
): AccessReminderPreview {
  const { now } = ctx;
  const maskedPhone = maskMobile(enrollment.phone);
  const partial: Partial<AccessReminderPreview> = {
    enrollmentId: enrollment.id,
    studentId: enrollment.student_id ?? null,
    studentName: enrollment.student_name,
    maskedPhone,
    courseTitle: enrollment.course_title,
    batchLabel: enrollment.batch_label ?? null,
  };

  if (!enrollment.phone?.trim()) return fail("missing_phone", "This student has no phone number on record.", partial);
  const n = normalizeIndianMobile(enrollment.phone);
  if (!n.ok || !n.digits10) return fail("invalid_mobile", n.error || "Phone number is not a valid Indian mobile.", partial);
  const digits10 = n.digits10;

  if (ctx.optedOut.has(digits10)) {
    return fail("opted_out", "This number is in the SMS opt-out list.", partial);
  }

  const resolution = resolveInstallmentForEnrollment(enrollment, now);
  if (!resolution.ok) {
    return fail(RESOLVER_REASONS[resolution.reason] ?? "no_unpaid_installment", resolution.detail, partial);
  }
  const r: ResolvedInstallment = resolution.resolved;
  Object.assign(partial, {
    installmentNo: r.installmentNo,
    amountDue: r.amountDue,
    dueDate: r.dueDate,
    unpaidCount: r.unpaidCount,
    totalRemaining: r.totalRemaining,
  });

  const course = ctx.courses.get(enrollment.course_id);
  const override = ctx.overridesByPhoneCourse.get(`${enrollment.phone}::${enrollment.course_id}`);
  // Schedule state ignores temporary grants — that is what drives collections.
  const scheduleAccess = lectureAccessForCourse(course, enrollment, undefined, false, now);
  const liveAccess = lectureAccessForCourse(course, enrollment, override, false, now);
  const grant = activeAccessGrant(override, now);
  Object.assign(partial, {
    accessStatus: scheduleAccess.status,
    liveAccessAllowed: liveAccess.allowed,
    scheduleStatus: scheduleAccess.status,
    grantExpiresAt: grant?.expires_at ?? null,
  });

  if (r.totalRemaining <= 0 && scheduleAccess.status === "blocked" && scheduleAccess.reason === "overdue") {
    return fail("data_inconsistency", "Balance is cleared but schedule access is still blocked — fix the enrollment, do not SMS.", partial);
  }

  const pick = pickAccessTemplate({
    scheduleAccess,
    override,
    totalRemaining: r.totalRemaining,
    now,
  });
  if ("block" in pick) return fail(pick.block, pick.detail, { ...partial, scheduleStatus: pick.scheduleStatus });

  const template = ctx.templates.get(pick.templateId);
  if (!template) return fail("template_missing", `Template ${pick.templateId} missing from context.`, partial);

  const daysLeft = istWholeDaysUntil(pick.daysEndAt, now);
  Object.assign(partial, {
    daysLeft,
    daysSource: pick.daysSource,
    scheduleStatus: pick.scheduleStatus,
    accessStatus: pick.scheduleStatus.startsWith("blocked") ? "blocked" : pick.scheduleStatus.startsWith("grace") ? "grace" : pick.scheduleStatus,
    templateId: template.id,
    templateName: template.name,
    dltTemplateId: template.gateway_template_id,
    senderId: template.sender_id ?? null,
  });

  if (pick.templateId === ACCESS_EXPIRING_TEMPLATE_ID) {
    if (daysLeft == null) {
      return fail("days_not_positive", pick.daysSource === "override"
        ? "Override has no expiry date — cannot compute days."
        : "Grace end date is missing, so days cannot be resolved.", partial);
    }
    if (daysLeft <= 0) {
      return fail("days_not_positive", pick.daysSource === "override"
        ? "Override expires today or has expired (days ≤ 0) — do not send Expiring."
        : "Grace has ended (days ≤ 0) — use the blocked template path, not expiring.", partial);
    }
  }

  const buyer = ctx.buyers.get(digits10);
  const loginCode = buyer && buyer.status === "ok" && buyer.login_code && firstNamesMatch(enrollment.student_name, buyer.name)
    ? buyer.login_code
    : "";

  if (pick.templateId === ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID && !loginCode) {
    return fail(
      "missing_login_code",
      "login_code is required for installment_reminder — buyer missing, ambiguous, or name mismatch. Exclude from send.",
      partial,
    );
  }

  const recipientVars: Record<string, string> = {
    name: enrollment.student_name,
    first_name: String(enrollment.student_name || "").trim().split(/\s+/)[0] || "",
    login_code: loginCode,
    ...installmentReminderVars(r),
    days: daysLeft != null && daysLeft > 0 ? String(daysLeft) : "",
  };
  const filled = mergeSendVars(template.id, ctx.varDefaults.get(template.id) || {}, recipientVars);

  const rendered = prepareAndRenderSms(template.body_template, template.id, filled);

  Object.assign(partial, {
    body: rendered.text,
    variables: buildVariableView(template.body_template, rendered.vars),
    characterCount: rendered.length,
    segments: rendered.segments,
    daysSingularCosmetic: pick.templateId === ACCESS_EXPIRING_TEMPLATE_ID && daysLeft === 1,
  });

  if (!rendered.ok || rendered.missing.length) {
    return fail("render_blocked", rendered.errors.join("; ") || `Could not resolve: ${rendered.missing.join(", ")}.`, partial);
  }

  const warnings = [...rendered.warnings];
  if (partial.daysSingularCosmetic) {
    warnings.push('Approved copy reads "1 days" (immutable DLT text) — cosmetic only.');
  }
  if (grant?.expires_at && pick.templateId === ACCESS_INSTALLMENT_REMINDER_TEMPLATE_ID) {
    warnings.push(`Access grant active until ${grant.expires_at.slice(0, 10)} — installment_reminder (amount+code); grant restores lectures.`);
  }
  if (grant?.expires_at && pick.templateId === ACCESS_EXPIRING_TEMPLATE_ID) {
    warnings.push(`Access grant active until ${grant.expires_at.slice(0, 10)} — Expiring template uses days to that date, not "access paused".`);
  }
  if (r.unpaidCount > 1) {
    warnings.push(`${r.unpaidCount} unpaid installments — this reminder refers to the OLDEST one (no. ${r.installmentNo}).`);
  }
  const lastSentAt = ctx.recentByMobile.get(digits10) ?? null;
  if (lastSentAt) {
    warnings.push(`An access reminder already went to this student at ${lastSentAt} (within ${REPEAT_WARN_WINDOW_HOURS}h).`);
  }

  return {
    ...(partial as AccessReminderPreview),
    sendable: true,
    blockReason: null,
    blockDetail: null,
    warnings,
    lastSentAt,
    priorReminderCount: ctx.priorCountByMobile.get(digits10) ?? 0,
    installmentKey: {
      courseEnrollmentId: enrollment.id,
      installmentNo: r.installmentNo,
      fingerprint: installmentFingerprint(r.line),
    },
  };
}

export async function buildAccessReminder(input: {
  enrollmentId: string;
  now?: number;
}): Promise<AccessReminderPreview> {
  const now = input.now ?? Date.now();
  const enrollment = await getCourseEnrollmentById(input.enrollmentId);
  if (!enrollment) return fail("enrollment_not_found", "No matching enrollment for this student.");

  const ctx = await buildAccessReminderContext([enrollment], { now });
  if (!ctx.ok) {
    return fail(ctx.reason, ctx.detail, {
      enrollmentId: enrollment.id,
      studentId: enrollment.student_id ?? null,
      studentName: enrollment.student_name,
      maskedPhone: maskMobile(enrollment.phone),
      courseTitle: enrollment.course_title,
      batchLabel: enrollment.batch_label ?? null,
    });
  }
  return buildAccessReminderFor(enrollment, ctx.ctx);
}

export interface BulkAccessReminderPreview {
  previews: AccessReminderPreview[];
  blockReason: AccessReminderBlockReason | null;
  blockDetail: string | null;
  sendableCount: number;
  excludedCount: number;
  excludedByReason: Record<string, number>;
  totalSegments: number;
  overCapDropped: number;
}

export async function buildBulkAccessReminders(
  enrollmentIds: string[],
  opts: { now?: number } = {},
): Promise<BulkAccessReminderPreview> {
  const now = opts.now ?? Date.now();
  const unique = [...new Set(enrollmentIds.filter(Boolean))];
  const capped = unique.slice(0, ACCESS_MAX_BULK);
  const overCapDropped = unique.length - capped.length;

  const empty = (reason: AccessReminderBlockReason | null, detail: string | null): BulkAccessReminderPreview => ({
    previews: [], blockReason: reason, blockDetail: detail, sendableCount: 0, excludedCount: 0,
    excludedByReason: {}, totalSegments: 0, overCapDropped,
  });
  if (!capped.length) return empty(null, null);

  const enrollments = (await Promise.all(capped.map((id) => getCourseEnrollmentById(id))))
    .filter((e): e is CourseEnrollment => !!e);

  const ctx = await buildAccessReminderContext(enrollments, { now });
  if (!ctx.ok) return empty(ctx.reason, ctx.detail);

  const previews = enrollments.map((e) => buildAccessReminderFor(e, ctx.ctx));
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
    previews, blockReason: null, blockDetail: null, sendableCount,
    excludedCount: previews.length - sendableCount, excludedByReason, totalSegments, overCapDropped,
  };
}

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
