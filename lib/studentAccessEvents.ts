/**
 * Append-only student access / reminder events → profile timeline.
 * System automations and admin actions share one log (actor = 'system' | username).
 */
import { getSupabaseAdmin } from "./supabase";

export type StudentAccessEventType =
  | "reminder_sent"
  | "reminder_failed"
  | "extension_granted"
  | "extension_revoked"
  | "extension_expired"
  | "call_task_created"
  | "access_blocked"
  | "access_restored";

export interface AppendAccessEventInput {
  studentId?: string | null;
  phone: string;
  courseId?: string | null;
  courseEnrollmentId?: string | null;
  eventType: StudentAccessEventType;
  actor?: string | null;
  channel?: string | null;
  templateId?: string | null;
  bodySent?: string | null;
  amount?: number | null;
  installmentNo?: number | null;
  reason?: string | null;
  relatedEventId?: string | null;
  meta?: Record<string, unknown>;
}

export interface StudentAccessEventRow {
  id: string;
  student_id: string | null;
  phone: string;
  course_id: string | null;
  course_enrollment_id: string | null;
  event_type: StudentAccessEventType;
  actor: string;
  channel: string | null;
  template_id: string | null;
  body_sent: string | null;
  amount: number | null;
  installment_no: number | null;
  reason: string | null;
  related_event_id: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

export async function appendStudentAccessEvent(
  input: AppendAccessEventInput,
): Promise<string | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const phone = String(input.phone || "").trim();
  if (!phone) return null;
  const { data, error } = await db
    .from("student_access_events")
    .insert({
      student_id: input.studentId ?? null,
      phone,
      course_id: input.courseId ?? null,
      course_enrollment_id: input.courseEnrollmentId ?? null,
      event_type: input.eventType,
      actor: (input.actor || "system").trim() || "system",
      channel: input.channel ?? null,
      template_id: input.templateId ?? null,
      body_sent: input.bodySent ?? null,
      amount: input.amount ?? null,
      installment_no: input.installmentNo ?? null,
      reason: input.reason ?? null,
      related_event_id: input.relatedEventId ?? null,
      meta: input.meta ?? {},
    })
    .select("id")
    .maybeSingle();
  if (error) return null;
  return data?.id ? String(data.id) : null;
}

export async function listStudentAccessEventsByPhone(
  phone: string,
  limit = 100,
): Promise<StudentAccessEventRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db
    .from("student_access_events")
    .select("*")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data || []) as StudentAccessEventRow[];
}

/** Stage-1 without stage-3 follow-up (instructions) — for admin re-send queue. */
export async function listMissingInstructionsFollowUps(sinceIso: string): Promise<{
  phone: string;
  courseEnrollmentId: string | null;
  stage1At: string;
  templateId: string | null;
}[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db
    .from("student_access_events")
    .select("phone, course_enrollment_id, created_at, template_id, event_type, related_event_id, meta")
    .gte("created_at", sinceIso)
    .in("event_type", ["reminder_sent", "reminder_failed"])
    .order("created_at", { ascending: false })
    .limit(2000);
  const rows = (data || []) as {
    phone: string;
    course_enrollment_id: string | null;
    created_at: string;
    template_id: string | null;
    event_type: string;
    related_event_id: string | null;
    meta: { stage?: string } | null;
  }[];

  const stage1 = rows.filter(
    (r) =>
      r.event_type === "reminder_sent" &&
      (r.template_id === "portal_access_expiring" || r.template_id === "portal_access_blocked"),
  );
  const stage3Ok = new Set(
    rows
      .filter((r) => r.event_type === "reminder_sent" && r.template_id === "installment_instructions")
      .map((r) => r.related_event_id || `${r.phone}:${r.course_enrollment_id}`),
  );
  const stage3Fail = rows.filter(
    (r) => r.event_type === "reminder_failed" && r.template_id === "installment_instructions",
  );

  const missing: {
    phone: string;
    courseEnrollmentId: string | null;
    stage1At: string;
    templateId: string | null;
  }[] = [];
  for (const s of stage1) {
    const key = s.related_event_id || `${s.phone}:${s.course_enrollment_id}`;
    if (stage3Ok.has(key)) continue;
    const failed = stage3Fail.some(
      (f) =>
        f.phone === s.phone &&
        f.course_enrollment_id === s.course_enrollment_id &&
        f.created_at >= s.created_at,
    );
    if (failed || !stage3Ok.has(key)) {
      missing.push({
        phone: s.phone,
        courseEnrollmentId: s.course_enrollment_id,
        stage1At: s.created_at,
        templateId: s.template_id,
      });
    }
  }
  return missing;
}
