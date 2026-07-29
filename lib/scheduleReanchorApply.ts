/**
 * Apply / revert schedule re-anchoring via Postgres RPC (one txn per enrolment).
 */
import { getSupabaseAdmin } from "./supabase";
import {
  previewReanchorEnrollment,
  scheduleFromReanchorPreview,
  type ReanchorEnrollmentPreview,
} from "./scheduleReanchor";
import type { Course, CourseEnrollment } from "./types";

export const REANCHOR_ACTOR = "System · re-anchor";
export const REANCHOR_REASON = "Installment 1 never before batch start; subsequent lines shifted by same offset";

export async function applyReanchorEnrollment(opts: {
  enrollment: CourseEnrollment;
  course: Course | undefined;
  now?: number;
  actor?: string;
}): Promise<{
  ok: true;
  snapshotId: string;
  preview: ReanchorEnrollmentPreview;
  nextSchedule: CourseEnrollment["schedule"];
} | { ok: false; error: string; preview?: ReanchorEnrollmentPreview }> {
  const preview = previewReanchorEnrollment(opts.enrollment, opts.course, opts.now);
  if (preview.skipReason || !preview.wouldChange) {
    return { ok: false, error: preview.skipReason || "nothing_to_change", preview };
  }
  const nextSchedule = scheduleFromReanchorPreview(opts.enrollment.schedule || [], preview);
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "db_unavailable", preview };

  const { data, error } = await db.rpc("apply_schedule_reanchor", {
    p_enrollment_id: opts.enrollment.id,
    p_new_schedule: nextSchedule,
    p_expected_amount_paid: opts.enrollment.amount_paid || 0,
    p_batch_start: preview.batchStart,
    p_reason: REANCHOR_REASON,
    p_actor: opts.actor || REANCHOR_ACTOR,
    p_lines: preview.lines,
    p_rupees_moved: preview.rupeesMovingOutOfMonth,
  });
  if (error) return { ok: false, error: error.message, preview };
  return {
    ok: true,
    snapshotId: String(data),
    preview,
    nextSchedule,
  };
}

export async function revertReanchorSnapshot(snapshotId: string, actor = "System · re-anchor revert"): Promise<{
  ok: true;
  enrollmentId: string;
} | { ok: false; error: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "db_unavailable" };
  const { data, error } = await db.rpc("revert_schedule_reanchor", {
    p_snapshot_id: snapshotId,
    p_actor: actor,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, enrollmentId: String(data) };
}
