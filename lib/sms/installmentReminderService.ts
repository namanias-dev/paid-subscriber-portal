/**
 * Server-side assembly of an installment reminder: resolve the student's real
 * installment, render the DLT body, and decide whether the send is allowed.
 *
 * ONE function (`buildInstallmentReminder`) produces the object the preview
 * modal renders AND the object the send route acts on. The preview therefore
 * cannot disagree with the send: if `sendable` is false the route refuses, and
 * the modal shows the same `blockReason` it refused for.
 */
import { getCourseEnrollmentById, getCourseEnrollmentsByPhone } from "../dataProvider";
import { maskMobile, normalizeIndianMobile } from "../phone";
import { renderTemplate, uniqueVariables, validateBody } from "./templates";
import { isResolvedValue, lookupVariable, registryKeyFor } from "./variableRegistry";
import { checkRenderedBody } from "./sendGuard";
import { getTemplate, isOptedOut, listLogs, resolveBuyerByPhone, firstNamesMatch } from "./store";
import { getResolvedDefaults } from "./variables";
import { mergeSendVars } from "./service";
import {
  installmentReminderVars, pickReminderEnrollment, resolveInstallmentForEnrollment,
  type ResolvedInstallment,
} from "./installmentReminder";
import type { CourseEnrollment } from "../types";

/** The DLT-approved "Installment Reminder" template. */
export const INSTALLMENT_REMINDER_TEMPLATE_ID = "installment_reminder";

/** 24h idempotency window — a WARNING, never a silent block. */
export const REPEAT_WARN_WINDOW_HOURS = 24;

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
}

function fail(
  reason: ReminderBlockReason,
  detail: string,
  base: Partial<InstallmentReminderPreview> = {},
): InstallmentReminderPreview {
  return {
    enrollmentId: "", studentName: "", maskedPhone: "—", courseTitle: "",
    templateId: INSTALLMENT_REMINDER_TEMPLATE_ID, templateName: "Installment Reminder",
    dltTemplateId: null, senderId: null, body: "", variables: [],
    installmentNo: null, amountDue: null, dueDate: null, isOverdue: false,
    unpaidCount: 0, totalRemaining: null, matchesPageNextPayable: true,
    characterCount: 0, segments: 0,
    sendable: false, blockReason: reason, blockDetail: detail, warnings: [], lastSentAt: null,
    ...base,
  };
}

/** Map a resolver block reason onto the route-level reason vocabulary. */
const RESOLVER_REASONS: Record<string, ReminderBlockReason> = {
  no_active_enrollment: "no_active_enrollment",
  no_unpaid_installment: "no_unpaid_installment",
  zero_balance: "zero_balance",
  missing_phone: "missing_phone",
};

export interface BuildReminderInput {
  /** Preferred: the exact enrollment a staff member clicked on. */
  enrollmentId?: string | null;
  /** Fallback for surfaces that only know the student (picks the worst enrollment). */
  phone?: string | null;
  now?: number;
}

/**
 * Resolve, render and gate an installment reminder for ONE student.
 * Never throws; every failure is a named `blockReason`.
 */
export async function buildInstallmentReminder(input: BuildReminderInput): Promise<InstallmentReminderPreview> {
  const now = input.now ?? Date.now();

  // ---- 1. locate the enrollment (course_enrollments — the real table) ----
  let enrollment: CourseEnrollment | null = null;
  if (input.enrollmentId) {
    enrollment = await getCourseEnrollmentById(input.enrollmentId);
  } else if (input.phone) {
    enrollment = pickReminderEnrollment(await getCourseEnrollmentsByPhone(input.phone), now);
  }
  if (!enrollment) return fail("enrollment_not_found", "No matching enrollment for this student.");

  const maskedPhone = maskMobile(enrollment.phone);
  const partial: Partial<InstallmentReminderPreview> = {
    enrollmentId: enrollment.id,
    studentName: enrollment.student_name,
    maskedPhone,
    courseTitle: enrollment.course_title,
  };

  // ---- 2. contactability ----
  if (!enrollment.phone?.trim()) return fail("missing_phone", "This student has no phone number on record.", partial);
  const n = normalizeIndianMobile(enrollment.phone);
  if (!n.ok || !n.digits10) return fail("invalid_mobile", n.error || "Phone number is not a valid Indian mobile.", partial);
  const digits10 = n.digits10;

  // ---- 3. template gate (same rules the send service enforces) ----
  const template = await getTemplate(INSTALLMENT_REMINDER_TEMPLATE_ID);
  if (!template) return fail("template_missing", "The Installment Reminder template is not configured.", partial);
  Object.assign(partial, {
    templateName: template.name,
    dltTemplateId: template.gateway_template_id,
    senderId: template.sender_id ?? null,
  });
  if (!(template.status === "active" || template.status === "approved")) {
    return fail("template_inactive", `Template status is "${template.status}" — activate it before sending.`, partial);
  }
  if (!template.gateway_template_id) {
    return fail("no_dlt_id", "Template has no DLT id, so it can never be sent.", partial);
  }

  // ---- 4. consent / suppression ----
  if (await isOptedOut(digits10)) {
    return fail("opted_out", "This number is in the SMS opt-out list.", partial);
  }

  // ---- 5. installment facts (course_enrollments.schedule + deriveCollections) ----
  const resolution = resolveInstallmentForEnrollment(enrollment, now);
  if (!resolution.ok) {
    return fail(RESOLVER_REASONS[resolution.reason] ?? "no_unpaid_installment", resolution.detail, partial);
  }
  const r: ResolvedInstallment = resolution.resolved;

  // ---- 6. per-recipient variables ----
  // login_code is attached only when it provably belongs to THIS student: one
  // buyer on the number and the first names agree. Same rule the audience
  // resolver uses, so a shared handset never leaks another person's code.
  const buyer = await resolveBuyerByPhone(digits10);
  const loginCode = buyer.status === "ok" && buyer.login_code && firstNamesMatch(enrollment.student_name, buyer.name)
    ? buyer.login_code
    : "";

  const recipientVars: Record<string, string> = {
    name: enrollment.student_name,
    first_name: String(enrollment.student_name || "").trim().split(/\s+/)[0] || "",
    login_code: loginCode,
    ...installmentReminderVars(r),
  };
  const filled = mergeSendVars(INSTALLMENT_REMINDER_TEMPLATE_ID, await getResolvedDefaults(INSTALLMENT_REMINDER_TEMPLATE_ID), recipientVars);

  // ---- 7. render + guard (identical to the send path) ----
  const { text, missing } = renderTemplate(template.body_template, filled);
  const validation = validateBody(text);
  const guard = checkRenderedBody(text, filled);

  const variables = buildVariableView(template.body_template, filled);
  Object.assign(partial, {
    body: text,
    variables,
    installmentNo: r.installmentNo,
    amountDue: r.amountDue,
    dueDate: r.dueDate,
    isOverdue: r.isOverdue,
    unpaidCount: r.unpaidCount,
    totalRemaining: r.totalRemaining,
    matchesPageNextPayable: r.matchesPageNextPayable,
    characterCount: validation.analysis.length,
    segments: validation.analysis.segments,
  });

  if (!guard.ok || missing.length) {
    const detail = guard.detail || `Could not resolve: ${missing.join(", ")}.`;
    return fail("render_blocked", detail, partial);
  }
  if (!validation.ok) return fail("invalid_body", validation.errors.join("; "), partial);

  // ---- 8. non-blocking warnings ----
  const warnings = [...validation.warnings];
  if (!r.matchesPageNextPayable) {
    warnings.push("This enrollment's next payable line is not an installment, so the reminder targets the oldest unpaid installment instead.");
  }
  if (r.unpaidCount > 1) {
    warnings.push(`${r.unpaidCount} unpaid installments — this reminder refers to the OLDEST one (no. ${r.installmentNo}).`);
  }
  const lastSentAt = await lastSameTemplateSendAt(digits10, now);
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

/** Most recent same-template send to this number inside the warn window. */
async function lastSameTemplateSendAt(digits10: string, now: number): Promise<string | null> {
  const since = new Date(now - REPEAT_WARN_WINDOW_HOURS * 3600_000).toISOString();
  try {
    const logs = await listLogs({
      from: since, templateId: INSTALLMENT_REMINDER_TEMPLATE_ID, mobile: digits10, limit: 50,
    });
    const hit = logs
      .filter((l) => ["SENT", "DELIVERED", "QUEUED"].includes(l.status))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
    return hit?.created_at ?? null;
  } catch {
    return null;
  }
}
