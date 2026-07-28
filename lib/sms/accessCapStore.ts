/**
 * Persistence for access-reminder automation caps + settings.
 * Defaults match ACCESS_AUTOMATION_DEFAULTS when the DB row is missing.
 */
import { getSupabaseAdmin } from "../supabase";
import {
  ACCESS_AUTO_CAP_PER_INSTALLMENT,
  ACCESS_AUTOMATION_DEFAULTS,
} from "./accessReminderConstants";

export interface AccessReminderSettings {
  killSwitch: boolean;
  dryRun: boolean;
  enabled: boolean;
  rampLimit: number;
  dailyCeiling: number;
}

export interface AccessCapRow {
  id: string;
  course_enrollment_id: string;
  installment_no: number;
  installment_fingerprint: string | null;
  student_id: string | null;
  normalized_mobile: string | null;
  auto_sequences_used: number;
  needs_call: boolean;
  needs_call_at: string | null;
  excluded_from_automation: boolean;
  excluded_reason: string | null;
  last_auto_sent_at: string | null;
  first_blocked_seen_at: string | null;
}

export async function getAccessReminderSettings(): Promise<AccessReminderSettings> {
  const db = getSupabaseAdmin();
  if (!db) return { ...ACCESS_AUTOMATION_DEFAULTS };
  const { data } = await db.from("access_reminder_settings").select("*").eq("id", 1).maybeSingle();
  if (!data) return { ...ACCESS_AUTOMATION_DEFAULTS };
  return {
    killSwitch: !!data.kill_switch,
    dryRun: data.dry_run !== false,
    enabled: !!data.enabled,
    rampLimit: Number(data.ramp_limit) || ACCESS_AUTOMATION_DEFAULTS.rampLimit,
    dailyCeiling: Number(data.daily_ceiling) || ACCESS_AUTOMATION_DEFAULTS.dailyCeiling,
  };
}

export async function updateAccessReminderSettings(
  patch: Partial<AccessReminderSettings>,
  updatedBy: string | null,
): Promise<AccessReminderSettings> {
  const db = getSupabaseAdmin();
  if (!db) return { ...ACCESS_AUTOMATION_DEFAULTS, ...patch };
  const row: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString(), updated_by: updatedBy };
  if (patch.killSwitch !== undefined) row.kill_switch = patch.killSwitch;
  if (patch.dryRun !== undefined) row.dry_run = patch.dryRun;
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.rampLimit !== undefined) row.ramp_limit = patch.rampLimit;
  if (patch.dailyCeiling !== undefined) row.daily_ceiling = patch.dailyCeiling;
  await db.from("access_reminder_settings").upsert(row);
  return getAccessReminderSettings();
}

export async function getCap(
  enrollmentId: string,
  installmentNo: number,
): Promise<AccessCapRow | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db
    .from("access_reminder_caps")
    .select("*")
    .eq("course_enrollment_id", enrollmentId)
    .eq("installment_no", installmentNo)
    .maybeSingle();
  return (data as AccessCapRow) ?? null;
}

export async function listNeedsCall(limit = 200): Promise<AccessCapRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db
    .from("access_reminder_caps")
    .select("*")
    .eq("needs_call", true)
    .order("needs_call_at", { ascending: false })
    .limit(limit);
  return (data as AccessCapRow[]) || [];
}

export async function listCapsForEnrollments(enrollmentIds: string[]): Promise<AccessCapRow[]> {
  const db = getSupabaseAdmin();
  if (!db || !enrollmentIds.length) return [];
  const { data } = await db
    .from("access_reminder_caps")
    .select("*")
    .in("course_enrollment_id", enrollmentIds);
  return (data as AccessCapRow[]) || [];
}

/**
 * Record one successful automated sequence (step-1 delivered). Caps at 5 →
 * needs_call. Failed deliveries must NOT call this.
 */
export async function recordAutoSequence(input: {
  courseEnrollmentId: string;
  installmentNo: number;
  fingerprint: string | null;
  studentId: string | null;
  normalizedMobile: string | null;
}): Promise<{ used: number; needsCall: boolean; justReachedCap: boolean }> {
  const db = getSupabaseAdmin();
  if (!db) return { used: 0, needsCall: false, justReachedCap: false };

  const existing = await getCap(input.courseEnrollmentId, input.installmentNo);
  const prev = existing?.auto_sequences_used ?? 0;
  const used = prev + 1;
  const needsCall = used >= ACCESS_AUTO_CAP_PER_INSTALLMENT;
  const justReachedCap = needsCall && prev < ACCESS_AUTO_CAP_PER_INSTALLMENT;
  const now = new Date().toISOString();

  await db.from("access_reminder_caps").upsert({
    course_enrollment_id: input.courseEnrollmentId,
    installment_no: input.installmentNo,
    installment_fingerprint: input.fingerprint,
    student_id: input.studentId,
    normalized_mobile: input.normalizedMobile,
    auto_sequences_used: used,
    needs_call: needsCall,
    needs_call_at: justReachedCap ? now : (existing?.needs_call_at ?? (needsCall ? now : null)),
    last_auto_sent_at: now,
    updated_at: now,
    first_blocked_seen_at: existing?.first_blocked_seen_at ?? now,
  }, { onConflict: "course_enrollment_id,installment_no" });

  return { used, needsCall, justReachedCap };
}

export async function setExcluded(input: {
  courseEnrollmentId: string;
  installmentNo: number;
  excluded: boolean;
  reason: string | null;
  by: string | null;
  fingerprint?: string | null;
  studentId?: string | null;
  normalizedMobile?: string | null;
}): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const now = new Date().toISOString();
  await db.from("access_reminder_caps").upsert({
    course_enrollment_id: input.courseEnrollmentId,
    installment_no: input.installmentNo,
    installment_fingerprint: input.fingerprint ?? null,
    student_id: input.studentId ?? null,
    normalized_mobile: input.normalizedMobile ?? null,
    excluded_from_automation: input.excluded,
    excluded_reason: input.reason,
    excluded_by: input.by,
    excluded_at: input.excluded ? now : null,
    updated_at: now,
  }, { onConflict: "course_enrollment_id,installment_no" });
}

/** Flag needs_call with an explicit reason (payment failures, grant expiring, cap). */
export async function flagNeedsCall(input: {
  courseEnrollmentId: string;
  installmentNo: number;
  reason: string;
  fingerprint?: string | null;
  studentId?: string | null;
  normalizedMobile?: string | null;
}): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const now = new Date().toISOString();
  const existing = await getCap(input.courseEnrollmentId, input.installmentNo);
  await db.from("access_reminder_caps").upsert({
    course_enrollment_id: input.courseEnrollmentId,
    installment_no: input.installmentNo,
    installment_fingerprint: input.fingerprint ?? existing?.installment_fingerprint ?? null,
    student_id: input.studentId ?? existing?.student_id ?? null,
    normalized_mobile: input.normalizedMobile ?? existing?.normalized_mobile ?? null,
    auto_sequences_used: existing?.auto_sequences_used ?? 0,
    needs_call: true,
    needs_call_at: existing?.needs_call_at ?? now,
    // Payment-failure / grant-expiry flags must NOT blanket-exclude manual Remind.
    excluded_from_automation: existing?.excluded_from_automation ?? false,
    excluded_reason: input.reason,
    updated_at: now,
  }, { onConflict: "course_enrollment_id,installment_no" });
}

export async function resetCap(input: {
  courseEnrollmentId: string;
  installmentNo: number;
  reason: string;
  by: string | null;
}): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const now = new Date().toISOString();
  await db.from("access_reminder_caps").upsert({
    course_enrollment_id: input.courseEnrollmentId,
    installment_no: input.installmentNo,
    auto_sequences_used: 0,
    needs_call: false,
    needs_call_at: null,
    reset_at: now,
    reset_by: input.by,
    reset_reason: input.reason,
    updated_at: now,
  }, { onConflict: "course_enrollment_id,installment_no" });
}

export async function logAutomationRun(row: {
  dryRun: boolean;
  killSwitch: boolean;
  enabled: boolean;
  wouldSend: number;
  excluded: number;
  sent: number;
  haltedReason: string | null;
  detail: unknown;
}): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.from("access_reminder_automation_runs").insert({
    dry_run: row.dryRun,
    kill_switch: row.killSwitch,
    enabled: row.enabled,
    would_send: row.wouldSend,
    excluded: row.excluded,
    sent: row.sent,
    halted_reason: row.haltedReason,
    detail: row.detail,
  });
}
