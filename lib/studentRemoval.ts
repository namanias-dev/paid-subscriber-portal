/**
 * Admin student removal — hard-delete vs archive.
 * Path is chosen by payment history, never by the operator.
 */
import { ARCHIVE_NOTES_PREFIX, archivedPhoneSet, isArchivedStudent } from "./archivedStudents";
import { countsTowardCapacity } from "./enrollmentScope";
import { deleteObject, listAllObjects, r2Configured, installmentProofPrefix } from "./r2";
import { revalidatePublicCourses } from "./publicCache";
import type { CourseEnrollment, Student } from "./types";
import { getSupabaseAdmin } from "./supabase";
import {
  bumpBuyerSessionVersion,
  getAllCourses,
  getStudentById,
  updateCourse,
  updateStudent,
} from "./dataProvider";

export type RemovalPath = "hard_delete" | "archive";
export { isArchivedStudent, archivedPhoneSet, ARCHIVE_NOTES_PREFIX };

export interface RemovalPreview {
  path: RemovalPath;
  reason: string;
  studentId: string;
  name: string;
  phone: string;
  loginCode: string | null;
  lmsAccessCode: string | null;
  enrollments: { id: string; title: string; batch: string | null; status: string; amountPaid: number }[];
  paymentCount: number;
  proofCount: number;
  warning: string;
}

function db() {
  return getSupabaseAdmin();
}

async function countEq(table: string, col: string, val: string): Promise<number> {
  const supabase = db();
  if (!supabase) return 0;
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq(col, val);
  if (error) return 0;
  return count ?? 0;
}

export function decideRemovalPath(input: {
  paymentCount: number;
  proofCount: number;
  enrollmentPaidSignals: number;
}): { path: RemovalPath; reason: string } {
  if (input.paymentCount > 0) {
    return { path: "archive", reason: "Payment rows exist — financial records are kept." };
  }
  if (input.enrollmentPaidSignals > 0) {
    return { path: "archive", reason: "Enrolment shows collected fees without a matching payment row — archive to be safe." };
  }
  if (input.proofCount > 0) {
    return { path: "archive", reason: "Installment proofs exist — archive to be safe." };
  }
  return { path: "hard_delete", reason: "No payment rows, receipts, proofs, or collected enrolment amounts." };
}

/**
 * Any money history → archive. Zero of every kind → hard delete.
 * Ambiguous (enrolment shows paid, no payment row) → archive.
 */
export async function detectRemovalPath(phone: string, studentId: string): Promise<{ path: RemovalPath; paymentCount: number; proofCount: number; reason: string }> {
  const supabase = db();
  const paymentCount = (await countEq("payments", "phone", phone)) + (await countEq("payment_receipts", "phone", phone));
  const proofCount = await countEq("installment_payment_proofs", "student_id", studentId);
  let enrollmentPaidSignals = 0;
  if (supabase) {
    const { data } = await supabase.from("course_enrollments").select("amount_paid,status").eq("phone", phone);
    enrollmentPaidSignals = (data || []).filter((e) => Number(e.amount_paid) > 0 || e.status === "seat_booked" || e.status === "fully_paid" || e.status === "partially_paid").length;
  }
  const decided = decideRemovalPath({ paymentCount, proofCount, enrollmentPaidSignals });
  return { path: decided.path, paymentCount, proofCount, reason: decided.reason };
}

export async function previewStudentRemoval(studentId: string): Promise<RemovalPreview | null> {
  const student = await getStudentById(studentId);
  if (!student || isArchivedStudent(student)) return null;
  const supabase = db();
  const phone = student.phone;
  const detected = await detectRemovalPath(phone, studentId);
  const { data: enrs } = supabase
    ? await supabase.from("course_enrollments").select("id,course_title,batch_label,status,amount_paid").eq("phone", phone).neq("status", "cancelled")
    : { data: [] as CourseEnrollment[] };
  const { data: buyer } = supabase
    ? await supabase.from("buyers").select("login_code").eq("phone", phone).maybeSingle()
    : { data: null };
  return {
    path: detected.path,
    reason: detected.reason,
    studentId,
    name: student.name,
    phone,
    loginCode: (buyer as { login_code?: string } | null)?.login_code ?? null,
    lmsAccessCode: student.access_code || null,
    enrollments: (enrs || []).map((e) => ({
      id: String((e as { id: string }).id),
      title: String((e as { course_title?: string }).course_title || "Course"),
      batch: ((e as { batch_label?: string | null }).batch_label as string | null) ?? null,
      status: String((e as { status?: string }).status || ""),
      amountPaid: Number((e as { amount_paid?: number }).amount_paid || 0),
    })),
    paymentCount: detected.paymentCount,
    proofCount: detected.proofCount,
    warning:
      detected.path === "hard_delete"
        ? "This student has no payment history and will be permanently deleted"
        : "This student has recorded payments and will be archived — financial records are kept.",
  };
}

async function del(table: string, col: string, val: string): Promise<void> {
  const supabase = db();
  if (!supabase) return;
  await supabase.from(table).delete().eq(col, val);
}

async function recalcSeatsLeft(courseIds: string[], skipPhones: Set<string>): Promise<void> {
  if (!courseIds.length) return;
  const courses = await getAllCourses();
  const supabase = db();
  if (!supabase) return;
  const { data: enrs } = await supabase.from("course_enrollments").select("course_id,batch_id,phone,status,amount_paid");
  const live = (enrs || []).filter((e) => !skipPhones.has(String(e.phone)) && countsTowardCapacity(e as Pick<CourseEnrollment, "status" | "amount_paid">));
  for (const cid of [...new Set(courseIds)]) {
    const course = courses.find((c) => c.id === cid);
    if (!course?.batches?.length) continue;
    let changed = false;
    const batches = course.batches.map((b) => {
      if (b.capacity == null || b.capacity <= 0 || b.seats_left == null) return b;
      const filled = live.filter((e) => e.course_id === cid && e.batch_id === b.id).length;
      const next = Math.max(0, b.capacity - filled);
      if (next !== b.seats_left) changed = true;
      return { ...b, seats_left: next };
    });
    if (changed) await updateCourse(cid, { batches });
  }
}

async function purgeR2Proofs(studentId: string): Promise<void> {
  if (!r2Configured()) return;
  try {
    const prefix = installmentProofPrefix(studentId);
    const objs = await listAllObjects(prefix);
    for (const o of objs) await deleteObject(o.key);
  } catch {
    /* best-effort */
  }
}

export async function executeStudentRemoval(opts: {
  studentId: string;
  confirmPhone: string;
}): Promise<{ ok: true; path: RemovalPath; preview: RemovalPreview } | { ok: false; error: string; status: number }> {
  const student = await getStudentById(opts.studentId);
  if (!student) return { ok: false, error: "Not found", status: 404 };
  if (isArchivedStudent(student)) return { ok: false, error: "Already removed.", status: 409 };
  const digits = (opts.confirmPhone || "").replace(/\D/g, "").slice(-10);
  const expect = (student.phone || "").replace(/\D/g, "").slice(-10);
  if (!digits || digits.length !== 10 || digits !== expect) {
    return { ok: false, error: "Type the student's 10-digit phone number to confirm.", status: 400 };
  }
  const preview = await previewStudentRemoval(opts.studentId);
  if (!preview) return { ok: false, error: "Not found", status: 404 };

  const phone = student.phone;
  const supabase = db();
  if (supabase) {
    const { data: en } = await supabase.from("course_enrollments").select("course_id").eq("phone", phone);
    const archived = await archivedPhoneSet();
    archived.add(phone);
    try {
      await recalcSeatsLeft(
        [...new Set((en || []).map((e) => String((e as { course_id: string }).course_id)))],
        archived,
      );
    } catch {
      /* seats_left recalc is best-effort; never block removal */
    }
  }

  await bumpBuyerSessionVersion(phone);

  if (preview.path === "archive") {
    const stamp = new Date().toISOString();
    const notes = `${ARCHIVE_NOTES_PREFIX}${stamp}\n${student.notes || ""}`.slice(0, 8000);
    const patched = await updateStudent(student.id, {
      is_active: false,
      notes,
      archived_at: stamp,
    } as Partial<Student>);
    if (!patched) {
      await updateStudent(student.id, { is_active: false, notes });
    }
    if (supabase) {
      await supabase.from("buyers").update({ archived_at: stamp, updated_at: stamp }).eq("phone", phone);
    }
    try { revalidatePublicCourses(); } catch { /* outside Next request */ }
    return { ok: true, path: "archive", preview };
  }

  // Hard delete — no payment history.
  await purgeR2Proofs(student.id);
  const tablesPhone = [
    "installment_payment_proofs",
    "course_access_overrides",
    "payment_action_log",
    "payment_receipts",
    "payments",
    "webinar_registrations",
    "grandfather_notice_queue",
    "sms_scheduled_sends",
    "enrollment_transfers",
  ];
  for (const t of tablesPhone) {
    try { await del(t, "phone", phone); } catch { /* optional table */ }
  }
  try { await del("installment_payment_proofs", "student_id", student.id); } catch { /* */ }
  try { await del("student_access_events", "student_id", student.id); } catch { /* */ }
  try { await del("access_reminder_caps", "student_id", student.id); } catch { /* */ }
  try { await del("access_reminder_caps", "normalized_mobile", phone); } catch { /* */ }
  try { await del("lecture_watch_progress", "learner_id", student.id); } catch { /* */ }
  try { await del("content_progress", "student_id", student.id); } catch { /* */ }
  try { await del("class_hub_views", "student_id", student.id); } catch { /* */ }
  try { await del("bookmarks", "student_id", student.id); } catch { /* */ }
  try { await del("quiz_attempts", "user_id", student.id); } catch { /* */ }
  try { await del("enrollments", "student_id", student.id); } catch { /* */ }
  try { await del("access_call_tasks", "phone", phone); } catch { /* */ }
  if (supabase) {
    await supabase.from("telegram_subscribers").update({ linked_student_id: null }).eq("linked_student_id", student.id);
    await supabase.from("sms_logs").update({ student_id: null }).eq("student_id", student.id);
    await supabase.from("sms_logs").update({ student_id: null }).eq("normalized_mobile", phone);
  }
  await del("course_enrollments", "phone", phone);
  await del("buyers", "phone", phone);
  await del("students", "id", student.id);
  try { revalidatePublicCourses(); } catch { /* outside Next request */ }
  return { ok: true, path: "hard_delete", preview };
}
