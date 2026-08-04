/**
 * Persistence for instalment ladder steps — separate from access_reminder_caps.
 */
import { getSupabaseAdmin } from "../supabase";
import type { LadderStep } from "./installmentLadder";

export async function listLadderStepCounts(enrollmentIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (enrollmentIds.length === 0) return out;
  const db = getSupabaseAdmin();
  if (!db) return out;
  const { data, error } = await db
    .from("installment_ladder_events")
    .select("course_enrollment_id, step")
    .in("course_enrollment_id", enrollmentIds)
    .eq("dry_run", false);
  if (error) return out; // table may not exist yet
  for (const row of data || []) {
    const id = row.course_enrollment_id as string;
    out.set(id, (out.get(id) || 0) + 1);
  }
  return out;
}

export async function hasLadderStep(
  enrollmentId: string,
  installmentNo: number,
  step: LadderStep,
): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { data } = await db
    .from("installment_ladder_events")
    .select("id")
    .eq("course_enrollment_id", enrollmentId)
    .eq("installment_no", installmentNo)
    .eq("step", step)
    .maybeSingle();
  return !!data;
}

export async function recordLadderStep(input: {
  enrollmentId: string;
  installmentNo: number;
  step: LadderStep;
  channel: "sms" | "call_task" | "none";
  templateId?: string | null;
  bodySnapshot?: string | null;
  dryRun: boolean;
}): Promise<{ ok: boolean; duplicate?: boolean }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false };
  const { error } = await db.from("installment_ladder_events").insert({
    course_enrollment_id: input.enrollmentId,
    installment_no: input.installmentNo,
    step: input.step,
    channel: input.channel,
    template_id: input.templateId ?? null,
    body_snapshot: input.bodySnapshot ?? null,
    dry_run: input.dryRun,
  });
  if (error) {
    if (String(error.message || "").includes("duplicate") || error.code === "23505") {
      return { ok: true, duplicate: true };
    }
    return { ok: false };
  }
  return { ok: true };
}

export async function ensureCollectionsCallTask(input: {
  enrollmentId: string;
  installmentNo: number;
  studentName: string;
  phone: string;
  amountDue: number;
  daysOverdue: number;
  reason?: string;
}): Promise<{ ok: boolean }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false };
  const { error } = await db.from("collections_call_tasks").upsert(
    {
      course_enrollment_id: input.enrollmentId,
      installment_no: input.installmentNo,
      student_name: input.studentName,
      phone: input.phone,
      amount_due: input.amountDue,
      days_overdue: input.daysOverdue,
      reason: input.reason || "ladder_p7",
      status: "open",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "course_enrollment_id,installment_no,reason" },
  );
  return { ok: !error };
}
