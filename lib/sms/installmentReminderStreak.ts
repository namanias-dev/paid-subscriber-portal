/**
 * Consecutive-day streak for Mission Control installment_access_reminder.
 * Independent of ACCESS_AUTO_CAP_PER_INSTALLMENT (access_reminder_caps) and
 * installment_ladder_events — counts shown separately in admin UI.
 */
import { getSupabaseAdmin } from "../supabase";
import { getCourseEnrollmentsByPhone } from "../dataProvider";
import { istYMD } from "../dates";

export const REMINDER_STREAK_HARD_CAP = 10;

export async function getReminderStreak(
  enrollmentId: string,
  installmentNo: number,
): Promise<{ consecutiveDays: number; lastSentYmd: string | null; paused: boolean; callTaskCreated: boolean } | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db
    .from("installment_reminder_streaks")
    .select("consecutive_days, last_sent_ymd, paused, call_task_created")
    .eq("course_enrollment_id", enrollmentId)
    .eq("installment_no", installmentNo)
    .maybeSingle();
  if (!data) return { consecutiveDays: 0, lastSentYmd: null, paused: false, callTaskCreated: false };
  return {
    consecutiveDays: Number(data.consecutive_days) || 0,
    lastSentYmd: data.last_sent_ymd ? String(data.last_sent_ymd) : null,
    paused: !!data.paused,
    callTaskCreated: !!data.call_task_created,
  };
}

export async function recordReminderStreakSend(input: {
  enrollmentId: string;
  installmentNo: number;
  now?: number;
}): Promise<{ consecutiveDays: number; hitCap: boolean }> {
  const db = getSupabaseAdmin();
  if (!db) return { consecutiveDays: 0, hitCap: false };
  const today = istYMD(new Date(input.now ?? Date.now()))!;
  const prev = await getReminderStreak(input.enrollmentId, input.installmentNo);
  let next = 1;
  if (prev?.lastSentYmd === today) {
    next = prev.consecutiveDays;
  } else if (prev?.lastSentYmd) {
    // Consecutive calendar days only — gap resets.
    const prevMs = Date.parse(`${prev.lastSentYmd}T12:00:00+05:30`);
    const todayMs = Date.parse(`${today}T12:00:00+05:30`);
    const dayGap = Math.round((todayMs - prevMs) / 86_400_000);
    next = dayGap === 1 ? prev.consecutiveDays + 1 : 1;
  }
  await db.from("installment_reminder_streaks").upsert(
    {
      course_enrollment_id: input.enrollmentId,
      installment_no: input.installmentNo,
      consecutive_days: next,
      last_sent_ymd: today,
      paused: false,
      pause_reason: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "course_enrollment_id,installment_no" },
  );
  return { consecutiveDays: next, hitCap: next >= REMINDER_STREAK_HARD_CAP };
}

export async function pauseReminderStreak(input: {
  courseEnrollmentId: string | null;
  phone: string;
  courseId: string;
  reason: string | null;
  unpause?: boolean;
}): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  let enrollmentId = input.courseEnrollmentId;
  if (!enrollmentId) {
    const rows = await getCourseEnrollmentsByPhone(input.phone);
    const e = rows.find((r) => r.course_id === input.courseId && r.status !== "cancelled");
    enrollmentId = e?.id ?? null;
  }
  if (!enrollmentId) return;

  if (input.unpause) {
    await db
      .from("installment_reminder_streaks")
      .update({ paused: false, pause_reason: null, updated_at: new Date().toISOString() })
      .eq("course_enrollment_id", enrollmentId);
    return;
  }

  // Pause all installments for this enrollment while extension is active.
  await db
    .from("installment_reminder_streaks")
    .update({
      paused: true,
      pause_reason: input.reason || "extension",
      updated_at: new Date().toISOString(),
    })
    .eq("course_enrollment_id", enrollmentId);

  // Ensure a row exists so the scanner sees paused even before first send.
  const { data: existing } = await db
    .from("installment_reminder_streaks")
    .select("installment_no")
    .eq("course_enrollment_id", enrollmentId)
    .limit(1);
  if (!existing?.length) {
    await db.from("installment_reminder_streaks").upsert(
      {
        course_enrollment_id: enrollmentId,
        installment_no: 0,
        consecutive_days: 0,
        paused: true,
        pause_reason: input.reason || "extension",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "course_enrollment_id,installment_no" },
    );
  }
}

export async function clearReminderStreak(input: {
  courseEnrollmentId: string | null;
  phone: string;
  courseId: string | null;
}): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  let enrollmentId = input.courseEnrollmentId;
  if (!enrollmentId && input.courseId) {
    const rows = await getCourseEnrollmentsByPhone(input.phone);
    const e = rows.find((r) => r.course_id === input.courseId && r.status !== "cancelled");
    enrollmentId = e?.id ?? null;
  }
  if (!enrollmentId) return;
  await db.from("installment_reminder_streaks").delete().eq("course_enrollment_id", enrollmentId);
}

export async function markStreakCallTaskCreated(
  enrollmentId: string,
  installmentNo: number,
): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.from("installment_reminder_streaks").upsert(
    {
      course_enrollment_id: enrollmentId,
      installment_no: installmentNo,
      call_task_created: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "course_enrollment_id,installment_no" },
  );
}
