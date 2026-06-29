import { getSupabaseAdmin } from "./supabase";
import * as mock from "./mockData";
import { computeExpiry, isExpired, isExpiringSoon, yesterdayISODate, todayISODate, formatINR, formatISTDate } from "./dates";
import { generateAccessCode } from "./codeGenerator";
import { generateLoginCode } from "./buyerCode";
import { normalizeIndianMobile } from "./phone";
import { verifyFromStoredCallback, eazypayVerify, type VerifyOutcome } from "./eazypay";
import { recordPaymentPaid, recordPaymentInitiated, recordPaymentStatusChanged, recordRegistrationCreated } from "./analytics/server";
import { fireAutoSms } from "./sms/dispatch";
import { TRIGGERS } from "./sms/templates";
import type {
  Buyer,
  Student,
  ContentItem,
  ContentType,
  ClassHubView,
  OrientationAssignment,
  OrientationRole,
  OrientationTargetType,
  AssignedOrientationVideo,
  LectureWatchProgress,
  CourseAccessOverride,
  Bookmark,
  ContentProgress,
  PlanId,
  Course,
  Enrollment,
  Lead,
  LeadActivity,
  LeadFormConfig,
  Webinar,
  WebinarRegistration,
  Payment,
  Referral,
  Staff,
  StaffAccessGrant,
  SiteSettings,
  Question,
  Quiz,
  QuizQuestion,
  QuizAttempt,
  QuizAnswer,
  ImportJob,
  CaArticle,
  CaCategory,
  CaTag,
  CaPdf,
  CaLead,
  CaEvent,
  CaEventType,
  Role,
  AdminAccount,
  LibraryDoc,
  CourseEnrollment,
  PaymentReceipt,
  EnrollmentPlanChangeLog,
  PaymentPlan,
  DuplicateEnrollmentGroup,
  EnrollmentMergeLog,
  InstallmentItem,
} from "./types";
import { deriveEnrollment, enrollmentStatusFromSchedule, installmentsSummary, planCourseEnrollment, resolveEmiConfig, isLineCancelledOrWaived, isActiveEnrollment, isAttemptEnrollment } from "./installments";
import { changePlan, type ChangePlanTarget, type ConvertOptions } from "./paymentPlanChange";
import { mergeSiteSettings } from "./homeDefaults";
import { DEFAULT_ROLES, resolvePermissions, type PermissionSet } from "./permissions";
import { dedupedPaidTotal } from "./paymentsAgg";

/**
 * The switchboard every API route uses.
 * Demo mode: read/write in-memory mock arrays.
 * Live mode: read/write Supabase. Switching is automatic via demoMode().
 */

/**
 * Demo mode is decided at RUNTIME by whether a Supabase admin client is
 * available. This is robust to Next.js inlining NEXT_PUBLIC_* at build time —
 * as soon as the env vars exist in the runtime environment, the app goes live.
 */
function demoMode(): boolean {
  return !getSupabaseAdmin();
}

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

// Generic helpers for live-mode tables (best-effort; demo mode never calls these)
async function dbSelect<T>(table: string, order = "created_at"): Promise<T[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from(table).select("*").order(order, { ascending: false });
  return (data as T[]) ?? [];
}
async function dbInsert<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const db = getSupabaseAdmin();
  if (!db) throw new Error("No database");
  const { data, error } = await db.from(table).insert(row).select().single();
  if (error) throw new Error(error.message);
  return data as T;
}
async function dbUpdate<T>(table: string, id: string, patch: Record<string, unknown>): Promise<T | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from(table).update(patch).eq("id", id).select().single();
  return (data as T) ?? null;
}
async function dbDelete(table: string, id: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { error } = await db.from(table).delete().eq("id", id);
  return !error;
}

// ============================ STUDENTS ============================
export async function getStudents(): Promise<Student[]> {
  if (demoMode()) return [...mock.students];
  const db = getSupabaseAdmin();
  if (!db) return [...mock.students];
  const { data } = await db.from("students").select("*").order("created_at", { ascending: false });
  return (data as Student[]) ?? [];
}

export async function getStudentById(id: string): Promise<Student | null> {
  if (demoMode()) return mock.students.find((s) => s.id === id) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("students").select("*").eq("id", id).maybeSingle();
  return (data as Student) ?? null;
}

export async function findStudentByLogin(phone: string, code: string): Promise<Student | null> {
  const normCode = code.trim().toUpperCase();
  if (demoMode()) {
    return mock.students.find((s) => s.phone === phone.trim() && s.access_code === normCode && s.is_active) ?? null;
  }
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db
    .from("students")
    .select("*")
    .eq("phone", phone.trim())
    .eq("access_code", normCode)
    .eq("is_active", true)
    .maybeSingle();
  return (data as Student) ?? null;
}

export async function findStudentByPhone(phone: string): Promise<Student | null> {
  if (demoMode()) return mock.students.find((s) => s.phone === phone.trim()) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("students").select("*").eq("phone", phone.trim()).maybeSingle();
  return (data as Student) ?? null;
}

export interface NewStudentInput {
  name: string;
  phone: string;
  email?: string | null;
  plan: PlanId;
  months: number | null;
  amount_paid?: number | null;
  start_date?: string;
  target_year?: number | null;
  optional_subject?: string | null;
  notes?: string | null;
  razorpay_payment_id?: string | null;
  razorpay_order_id?: string | null;
}

export async function addStudent(input: NewStudentInput): Promise<Student> {
  const start = input.start_date || new Date().toISOString();
  const expiry = computeExpiry(start, input.months);
  const row: Student = {
    id: uuid(),
    name: input.name,
    phone: input.phone,
    email: input.email ?? null,
    plan: input.plan,
    months: input.months,
    access_code: generateAccessCode(input.name),
    start_date: start,
    expiry_date: expiry,
    amount_paid: input.amount_paid ?? null,
    razorpay_payment_id: input.razorpay_payment_id ?? null,
    razorpay_order_id: input.razorpay_order_id ?? null,
    target_year: input.target_year ?? null,
    optional_subject: input.optional_subject ?? null,
    notes: input.notes ?? null,
    streak_count: 0,
    last_active_date: null,
    is_active: true,
    created_at: new Date().toISOString(),
  };
  if (demoMode()) {
    mock.students.unshift(row);
    return row;
  }
  const db = getSupabaseAdmin();
  if (!db) {
    mock.students.unshift(row);
    return row;
  }
  const { data, error } = await db.from("students").insert(row).select().single();
  if (error) throw new Error(error.message);
  return data as Student;
}

export async function updateStudent(id: string, patch: Partial<Student>): Promise<Student | null> {
  if (demoMode()) {
    const idx = mock.students.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    mock.students[idx] = { ...mock.students[idx], ...patch };
    return mock.students[idx];
  }
  return dbUpdate<Student>("students", id, patch);
}

export async function deleteStudent(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.students.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    mock.students.splice(idx, 1);
    return true;
  }
  return dbDelete("students", id);
}

export async function touchStreakOnLogin(student: Student): Promise<Student> {
  const today = todayISODate();
  const yesterday = yesterdayISODate();
  let streak = student.streak_count || 0;
  if (student.last_active_date === today) {
    // already counted
  } else if (student.last_active_date === yesterday) {
    streak += 1;
  } else {
    streak = 1;
  }
  const updated = await updateStudent(student.id, { streak_count: streak, last_active_date: today });
  return updated ?? { ...student, streak_count: streak, last_active_date: today };
}

// ============================ CONTENT ============================
export async function getAllContent(): Promise<ContentItem[]> {
  if (demoMode()) return [...mock.contentItems];
  const db = getSupabaseAdmin();
  if (!db) return [...mock.contentItems];
  const { data } = await db.from("content_items").select("*").order("date", { ascending: false });
  return (data as ContentItem[]) ?? [];
}

export async function getPublishedContent(): Promise<ContentItem[]> {
  if (demoMode()) return mock.contentItems.filter((c) => c.is_published);
  const db = getSupabaseAdmin();
  if (!db) return mock.contentItems.filter((c) => c.is_published);
  const { data } = await db
    .from("content_items")
    .select("*")
    .eq("is_published", true)
    .order("date", { ascending: false });
  return (data as ContentItem[]) ?? [];
}

export interface NewContentInput {
  type: ContentType;
  subject?: string | null;
  paper?: string | null;
  title: string;
  description?: string | null;
  drive_link?: string | null;
  youtube_link?: string | null;
  telegram_link?: string | null;
  date?: string | null;
  duration?: string | null;
  is_published?: boolean;
  course_id?: string | null;
  course_ids?: string[];
  class_no?: number | null;
  drip_date?: string | null;
  source_type?: ContentItem["source_type"];
  visibility?: ContentItem["visibility"];
  upload_status?: ContentItem["upload_status"];
}

export async function addContent(input: NewContentInput): Promise<ContentItem> {
  const courseIds = input.course_ids ?? (input.course_id ? [input.course_id] : []);
  const row: ContentItem = {
    id: uuid(),
    type: input.type,
    subject: input.subject ?? null,
    paper: input.paper ?? null,
    title: input.title,
    description: input.description ?? null,
    drive_link: input.drive_link ?? null,
    youtube_link: input.youtube_link ?? null,
    telegram_link: input.telegram_link ?? null,
    date: input.date ?? todayISODate(),
    duration: input.duration ?? null,
    is_published: input.is_published ?? false,
    course_id: input.course_id ?? (courseIds[0] ?? null),
    course_ids: courseIds,
    class_no: input.class_no ?? null,
    drip_date: input.drip_date ?? null,
    source_type: input.source_type ?? "link",
    visibility: input.visibility ?? "enrolled",
    upload_status: input.upload_status ?? (input.source_type === "hosted" ? "idle" : undefined),
    created_at: new Date().toISOString(),
  };
  if (demoMode()) {
    mock.contentItems.unshift(row);
    return row;
  }
  const db = getSupabaseAdmin();
  if (!db) {
    mock.contentItems.unshift(row);
    return row;
  }
  const { data, error } = await db.from("content_items").insert(row).select().single();
  if (error) throw new Error(error.message);
  return data as ContentItem;
}

export async function updateContent(id: string, patch: Partial<ContentItem>): Promise<ContentItem | null> {
  if (demoMode()) {
    const idx = mock.contentItems.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    mock.contentItems[idx] = { ...mock.contentItems[idx], ...patch };
    return mock.contentItems[idx];
  }
  return dbUpdate<ContentItem>("content_items", id, patch);
}

export async function deleteContent(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.contentItems.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    mock.contentItems.splice(idx, 1);
    return true;
  }
  return dbDelete("content_items", id);
}

/** True when a content item is assigned to the given course (new course_ids or legacy course_id). */
function contentAssignedTo(item: ContentItem, courseId: string): boolean {
  const ids = item.course_ids && item.course_ids.length ? item.course_ids : item.course_id ? [item.course_id] : [];
  return ids.includes(courseId);
}

/**
 * Published content items assigned to a course/batch (newest first). Drives the
 * Class Hub. Drip + entitlement + expiry gating happens in the caller so we keep
 * this query simple and reuse the existing publish flag as the single source.
 */
export async function getCourseContent(courseId: string): Promise<ContentItem[]> {
  const published = await getPublishedContent();
  return published.filter((c) => contentAssignedTo(c, courseId));
}

// ============ ORIENTATION / STARTER VIDEO ASSIGNMENTS (reusable) ============
// A library video (content_items) linked to the "After Registration" section of
// many courses/webinars via content_orientation_assignments. The media is never
// duplicated — only the join row is per course/webinar. Service-role only.

const ORIENTATION_TABLE = "content_orientation_assignments";

/** Raw join rows for one course/webinar, ordered for display. */
export async function getOrientationAssignmentsForTarget(
  targetType: OrientationTargetType,
  targetId: string,
): Promise<OrientationAssignment[]> {
  if (!targetId) return [];
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db
    .from(ORIENTATION_TABLE)
    .select("*")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  return (data as OrientationAssignment[]) ?? [];
}

/** Every assignment for one library video (used to show "assigned to N places"). */
export async function getOrientationAssignmentsForContent(contentId: string): Promise<OrientationAssignment[]> {
  if (!contentId) return [];
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from(ORIENTATION_TABLE).select("*").eq("content_id", contentId);
  return (data as OrientationAssignment[]) ?? [];
}

/**
 * Assignments for a course/webinar resolved with the underlying library video.
 * `publishedOnly` (student-facing) drops unpublished / not-yet-ready videos so a
 * draft library item never leaks into a Class Hub.
 */
export async function getOrientationVideosForTarget(
  targetType: OrientationTargetType,
  targetId: string,
  opts?: { publishedOnly?: boolean },
): Promise<AssignedOrientationVideo[]> {
  const rows = await getOrientationAssignmentsForTarget(targetType, targetId);
  if (rows.length === 0) return [];
  const db = getSupabaseAdmin();
  if (!db) return [];
  const ids = Array.from(new Set(rows.map((r) => r.content_id)));
  const { data } = await db.from("content_items").select("*").in("id", ids);
  const byId = new Map<string, ContentItem>((data as ContentItem[] | null || []).map((c) => [c.id, c]));
  const out: AssignedOrientationVideo[] = [];
  for (const r of rows) {
    const content = byId.get(r.content_id);
    if (!content) continue;
    if (opts?.publishedOnly) {
      if (!content.is_published) continue;
      // Hosted videos must have finished processing to be watchable.
      if (content.source_type === "hosted" && content.upload_status && content.upload_status !== "completed") continue;
    }
    out.push({ assignment_id: r.id, content, role: r.role, sort_order: r.sort_order });
  }
  return out;
}

/** Create or update one assignment (idempotent on content+target). */
export async function assignOrientationVideo(input: {
  contentId: string;
  targetType: OrientationTargetType;
  targetId: string;
  role?: OrientationRole;
  sortOrder?: number;
}): Promise<OrientationAssignment | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  // Append to the end by default so a new pick lands after existing ones.
  let sortOrder = input.sortOrder;
  if (sortOrder == null) {
    const existing = await getOrientationAssignmentsForTarget(input.targetType, input.targetId);
    sortOrder = existing.length;
  }
  const row = {
    content_id: input.contentId,
    target_type: input.targetType,
    target_id: input.targetId,
    role: input.role ?? "orientation",
    sort_order: sortOrder,
  };
  const { data, error } = await db
    .from(ORIENTATION_TABLE)
    .upsert(row, { onConflict: "content_id,target_type,target_id" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as OrientationAssignment;
}

/** Remove one link. Never touches the library video or other courses/webinars. */
export async function unassignOrientationVideo(input: {
  contentId: string;
  targetType: OrientationTargetType;
  targetId: string;
}): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { error } = await db
    .from(ORIENTATION_TABLE)
    .delete()
    .eq("content_id", input.contentId)
    .eq("target_type", input.targetType)
    .eq("target_id", input.targetId);
  if (error) throw new Error(error.message);
  return true;
}

/** Persist a new display order for a course/webinar's orientation videos. */
export async function reorderOrientationVideos(
  targetType: OrientationTargetType,
  targetId: string,
  orderedContentIds: string[],
): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  await Promise.all(
    orderedContentIds.map((contentId, i) =>
      db
        .from(ORIENTATION_TABLE)
        .update({ sort_order: i })
        .eq("content_id", contentId)
        .eq("target_type", targetType)
        .eq("target_id", targetId),
    ),
  );
  return true;
}

/**
 * From the Content tab: make this library video's assignments exactly match the
 * selected targets for the given role. Adds new links, removes de-selected ones,
 * and leaves links to OTHER content untouched.
 */
export async function setOrientationTargetsForContent(
  contentId: string,
  role: OrientationRole,
  targets: { type: OrientationTargetType; id: string }[],
): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const current = await getOrientationAssignmentsForContent(contentId);
  const want = new Set(targets.map((t) => `${t.type}:${t.id}`));
  const have = new Set(current.map((a) => `${a.target_type}:${a.target_id}`));

  // Remove links that are no longer selected.
  const toRemove = current.filter((a) => !want.has(`${a.target_type}:${a.target_id}`));
  for (const a of toRemove) {
    await db.from(ORIENTATION_TABLE).delete().eq("id", a.id);
  }
  // Add newly selected links (append to the end of each target's list).
  for (const t of targets) {
    if (have.has(`${t.type}:${t.id}`)) {
      // Keep role in sync for an already-linked target.
      await db.from(ORIENTATION_TABLE).update({ role }).eq("content_id", contentId).eq("target_type", t.type).eq("target_id", t.id);
      continue;
    }
    await assignOrientationVideo({ contentId, targetType: t.type, targetId: t.id, role });
  }
  return true;
}

// ====================== CLASS HUB VIEWS (NEW badge) ======================
export async function getClassHubViews(studentId: string): Promise<ClassHubView[]> {
  if (!studentId) return [];
  if (demoMode()) return mock.classHubViews.filter((v) => v.student_id === studentId);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("class_hub_views").select("*").eq("student_id", studentId);
  return (data as ClassHubView[]) ?? [];
}

/** Upsert the "last seen" timestamp for a (student, course, section) — clears NEW badges. */
export async function markClassHubSeen(studentId: string, courseId: string, section: string): Promise<void> {
  if (!studentId || !courseId || !section) return;
  const nowISO = new Date().toISOString();
  if (demoMode()) {
    const existing = mock.classHubViews.find(
      (v) => v.student_id === studentId && v.course_id === courseId && v.section === section,
    );
    if (existing) existing.last_seen_at = nowISO;
    else mock.classHubViews.push({ id: uuid(), student_id: studentId, course_id: courseId, section, last_seen_at: nowISO });
    return;
  }
  const db = getSupabaseAdmin();
  if (!db) return;
  await db
    .from("class_hub_views")
    .upsert({ student_id: studentId, course_id: courseId, section, last_seen_at: nowISO }, { onConflict: "student_id,course_id,section" });
}

// ====================== HOSTED LECTURES ======================
export async function getContentById(id: string): Promise<ContentItem | null> {
  if (!id) return null;
  if (demoMode()) return mock.contentItems.find((c) => c.id === id) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return mock.contentItems.find((c) => c.id === id) ?? null;
  const { data } = await db.from("content_items").select("*").eq("id", id).maybeSingle();
  return (data as ContentItem) ?? null;
}

export async function getLectureProgress(learnerId: string, recordingId: string): Promise<LectureWatchProgress | null> {
  if (!learnerId || !recordingId) return null;
  if (demoMode()) return mock.lectureWatchProgress.find((p) => p.learner_id === learnerId && p.recording_id === recordingId) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("lecture_watch_progress").select("*").eq("learner_id", learnerId).eq("recording_id", recordingId).maybeSingle();
  return (data as LectureWatchProgress) ?? null;
}

export async function getLectureProgressByLearner(learnerId: string): Promise<LectureWatchProgress[]> {
  if (!learnerId) return [];
  if (demoMode()) return mock.lectureWatchProgress.filter((p) => p.learner_id === learnerId);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("lecture_watch_progress").select("*").eq("learner_id", learnerId);
  return (data as LectureWatchProgress[]) ?? [];
}

export async function upsertLectureProgress(
  learnerId: string,
  recordingId: string,
  patch: { last_position_seconds?: number; completed?: boolean; durationSeconds?: number | null },
): Promise<void> {
  if (!learnerId || !recordingId) return;
  const nowISO = new Date().toISOString();
  const completed = patch.completed === true;
  if (demoMode()) {
    const existing = mock.lectureWatchProgress.find((p) => p.learner_id === learnerId && p.recording_id === recordingId);
    if (existing) {
      if (patch.last_position_seconds != null) existing.last_position_seconds = Math.floor(patch.last_position_seconds);
      if (completed && !existing.completed) { existing.completed = true; existing.completed_at = nowISO; }
      existing.last_watched_at = nowISO;
      existing.updated_at = nowISO;
    } else {
      mock.lectureWatchProgress.push({
        id: uuid(), learner_id: learnerId, recording_id: recordingId,
        last_position_seconds: Math.floor(patch.last_position_seconds ?? 0),
        completed, completed_at: completed ? nowISO : null, watch_count: 1,
        last_watched_at: nowISO, created_at: nowISO, updated_at: nowISO,
      });
    }
    return;
  }
  const db = getSupabaseAdmin();
  if (!db) return;
  const existing = await getLectureProgress(learnerId, recordingId);
  const row: Record<string, unknown> = {
    learner_id: learnerId,
    recording_id: recordingId,
    last_watched_at: nowISO,
    updated_at: nowISO,
    watch_count: (existing?.watch_count ?? 0) + (existing ? 0 : 1),
  };
  if (patch.last_position_seconds != null) row.last_position_seconds = Math.floor(patch.last_position_seconds);
  if (completed) { row.completed = true; row.completed_at = existing?.completed_at ?? nowISO; }
  await db.from("lecture_watch_progress").upsert(row, { onConflict: "learner_id,recording_id" });
}

// ---- Admin manual access overrides (grant / revoke per phone per course) ----
export async function getAccessOverridesByPhone(phone: string): Promise<CourseAccessOverride[]> {
  const p = (phone || "").trim();
  if (!p) return [];
  if (demoMode()) return mock.accessOverrides.filter((o) => o.phone === p);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("course_access_overrides").select("*").eq("phone", p);
  return (data as CourseAccessOverride[]) ?? [];
}

export async function getAllAccessOverrides(): Promise<CourseAccessOverride[]> {
  if (demoMode()) return [...mock.accessOverrides];
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("course_access_overrides").select("*");
  return (data as CourseAccessOverride[]) ?? [];
}

export async function upsertAccessOverride(input: {
  phone: string; course_id: string; mode: "grant" | "revoke"; expires_at?: string | null; note?: string | null; created_by?: string | null;
}): Promise<void> {
  const phone = (input.phone || "").trim();
  if (!phone || !input.course_id) return;
  const nowISO = new Date().toISOString();
  if (demoMode()) {
    const existing = mock.accessOverrides.find((o) => o.phone === phone && o.course_id === input.course_id);
    if (existing) {
      existing.mode = input.mode; existing.expires_at = input.expires_at ?? null; existing.note = input.note ?? null; existing.updated_at = nowISO;
    } else {
      mock.accessOverrides.push({ id: uuid(), phone, course_id: input.course_id, mode: input.mode, expires_at: input.expires_at ?? null, note: input.note ?? null, created_by: input.created_by ?? null, created_at: nowISO, updated_at: nowISO });
    }
    return;
  }
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.from("course_access_overrides").upsert(
    { phone, course_id: input.course_id, mode: input.mode, expires_at: input.expires_at ?? null, note: input.note ?? null, created_by: input.created_by ?? null, updated_at: nowISO },
    { onConflict: "phone,course_id" },
  );
}

export async function deleteAccessOverride(phone: string, courseId: string): Promise<void> {
  const p = (phone || "").trim();
  if (!p || !courseId) return;
  if (demoMode()) {
    const idx = mock.accessOverrides.findIndex((o) => o.phone === p && o.course_id === courseId);
    if (idx !== -1) mock.accessOverrides.splice(idx, 1);
    return;
  }
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.from("course_access_overrides").delete().eq("phone", p).eq("course_id", courseId);
}

// ============================ BOOKMARKS ============================
export async function getBookmarks(studentId: string): Promise<Bookmark[]> {
  if (demoMode()) return mock.bookmarks.filter((b) => b.student_id === studentId);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("bookmarks").select("*").eq("student_id", studentId);
  return (data as Bookmark[]) ?? [];
}

export async function addBookmark(studentId: string, contentId: string): Promise<Bookmark> {
  if (demoMode()) {
    const existing = mock.bookmarks.find((b) => b.student_id === studentId && b.content_id === contentId);
    if (existing) return existing;
    const row: Bookmark = { id: uuid(), student_id: studentId, content_id: contentId, created_at: new Date().toISOString() };
    mock.bookmarks.push(row);
    return row;
  }
  const db = getSupabaseAdmin();
  if (!db) throw new Error("No database");
  const { data, error } = await db.from("bookmarks").insert({ student_id: studentId, content_id: contentId }).select().single();
  if (error) throw new Error(error.message);
  return data as Bookmark;
}

export async function removeBookmark(studentId: string, contentId: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.bookmarks.findIndex((b) => b.student_id === studentId && b.content_id === contentId);
    if (idx === -1) return false;
    mock.bookmarks.splice(idx, 1);
    return true;
  }
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { error } = await db.from("bookmarks").delete().eq("student_id", studentId).eq("content_id", contentId);
  return !error;
}

// ============================ PROGRESS ============================
export async function getProgress(studentId: string): Promise<ContentProgress[]> {
  if (demoMode()) return mock.contentProgress.filter((p) => p.student_id === studentId);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("content_progress").select("*").eq("student_id", studentId);
  return (data as ContentProgress[]) ?? [];
}

export async function markProgress(studentId: string, contentId: string, completed: boolean): Promise<ContentProgress> {
  if (demoMode()) {
    const existing = mock.contentProgress.find((p) => p.student_id === studentId && p.content_id === contentId);
    if (existing) {
      existing.completed = completed;
      existing.completed_at = completed ? new Date().toISOString() : null;
      return existing;
    }
    const row: ContentProgress = { id: uuid(), student_id: studentId, content_id: contentId, completed, completed_at: completed ? new Date().toISOString() : null };
    mock.contentProgress.push(row);
    return row;
  }
  const db = getSupabaseAdmin();
  if (!db) throw new Error("No database");
  const { data, error } = await db
    .from("content_progress")
    .upsert({ student_id: studentId, content_id: contentId, completed, completed_at: completed ? new Date().toISOString() : null }, { onConflict: "student_id,content_id" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ContentProgress;
}

// ============================ ADMIN AUTH + RBAC ============================

export interface AdminAuthResult {
  id: string;
  username: string;
  role: string;
  role_id: string | null;
  role_name: string;
  permissions: PermissionSet;
  must_change_password: boolean;
}

/** In-memory accounts created during a demo session (login works without a DB). */
const demoExtraAccounts: (AdminAccount & { password: string })[] = [];
/** Mutable demo roles store (seeded from the canonical defaults). */
const demoRoles: Role[] = DEFAULT_ROLES.map((r) => ({
  id: r.id,
  name: r.name,
  description: r.description,
  permissions: { ...r.permissions },
  is_system: r.is_system,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}));

function rolePermsById(roleId: string | null | undefined, roles: Role[]): PermissionSet {
  const r = roleId ? roles.find((x) => x.id === roleId) : undefined;
  return r ? r.permissions : {};
}

export async function verifyAdminCredentials(username: string, password: string): Promise<AdminAuthResult | null> {
  if (demoMode()) {
    const admin = mock.adminUsers.find((a) => a.username === username);
    if (admin && admin.plaintext_password === password) {
      const perms = resolvePermissions(rolePermsById("super_admin", demoRoles));
      return { id: admin.id, username: admin.username, role: admin.role, role_id: "super_admin", role_name: "Super Admin", permissions: perms, must_change_password: false };
    }
    const extra = demoExtraAccounts.find((a) => a.username === username && a.password === password);
    if (extra && extra.status === "active") {
      const perms = resolvePermissions(rolePermsById(extra.role_id, demoRoles), extra.permissions_override);
      const roleName = demoRoles.find((r) => r.id === extra.role_id)?.name || extra.role || "Staff";
      return { id: extra.id, username: extra.username, role: extra.role || roleName, role_id: extra.role_id, role_name: roleName, permissions: perms, must_change_password: extra.must_change_password };
    }
    return null;
  }
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("admin_users").select("*").eq("username", username).maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  if ((row.status as string) === "disabled") return null;
  const bcrypt = await import("bcryptjs");
  const ok = await bcrypt.compare(password, (row.password_hash as string) || "");
  if (!ok) return null;
  const roles = await getRoles();
  const roleId = (row.role_id as string) || "super_admin";
  const role = roles.find((r) => r.id === roleId);
  const perms = resolvePermissions(role?.permissions, (row.permissions_override as PermissionSet) || null);
  // best-effort last-login stamp
  try { await db.from("admin_users").update({ last_login_at: new Date().toISOString() }).eq("id", row.id as string); } catch { /* ignore */ }
  return {
    id: row.id as string,
    username,
    role: (row.role as string) || role?.name || "Super Admin",
    role_id: roleId,
    role_name: role?.name || "Super Admin",
    permissions: perms,
    must_change_password: !!row.must_change_password,
  };
}

// ---- Roles ----
export async function getRoles(): Promise<Role[]> {
  if (demoMode()) return demoRoles.map((r) => ({ ...r }));
  const db = getSupabaseAdmin();
  if (!db) return demoRoles.map((r) => ({ ...r }));
  const { data } = await db.from("roles").select("*").order("is_system", { ascending: false });
  const rows = (data as Role[]) ?? [];
  return rows.length ? rows : demoRoles.map((r) => ({ ...r }));
}
export async function getRoleById(id: string): Promise<Role | null> {
  const all = await getRoles();
  return all.find((r) => r.id === id) ?? null;
}
export async function createRole(input: { name: string; description?: string; permissions: PermissionSet }): Promise<Role> {
  const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `role_${Date.now()}`;
  const ts = new Date().toISOString();
  const row: Role = { id: slug, name: input.name, description: input.description || "", permissions: input.permissions, is_system: false, created_at: ts, updated_at: ts };
  if (demoMode()) { demoRoles.push({ ...row }); return row; }
  const db = getSupabaseAdmin();
  if (!db) { demoRoles.push({ ...row }); return row; }
  return dbInsert<Role>("roles", row as unknown as Record<string, unknown>);
}
export async function updateRole(id: string, patch: Partial<Role>): Promise<Role | null> {
  if (demoMode()) {
    const r = demoRoles.find((x) => x.id === id);
    if (!r) return null;
    Object.assign(r, patch, { updated_at: new Date().toISOString() });
    return { ...r };
  }
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("roles").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select().single();
  return (data as Role) ?? null;
}
export async function deleteRole(id: string): Promise<{ ok: boolean; error?: string }> {
  const role = await getRoleById(id);
  if (!role) return { ok: false, error: "Role not found." };
  if (role.is_system) return { ok: false, error: "System roles cannot be deleted." };
  // Block deletion if any account still uses this role.
  const accounts = await getAdminAccounts();
  if (accounts.some((a) => a.role_id === id)) return { ok: false, error: "Role is assigned to staff; reassign them first." };
  if (demoMode()) {
    const idx = demoRoles.findIndex((x) => x.id === id);
    if (idx >= 0) demoRoles.splice(idx, 1);
    return { ok: true };
  }
  const ok = await dbDelete("roles", id);
  return ok ? { ok: true } : { ok: false, error: "Delete failed." };
}

// ---- Admin accounts (staff logins) ----
function mapDbAccount(row: Record<string, unknown>): AdminAccount {
  return {
    id: row.id as string,
    username: (row.username as string) || "",
    name: (row.name as string) ?? null,
    email: (row.email as string) ?? null,
    phone: (row.phone as string) ?? null,
    role_id: (row.role_id as string) ?? null,
    role: (row.role as string) ?? null,
    status: ((row.status as string) === "disabled" ? "disabled" : "active"),
    must_change_password: !!row.must_change_password,
    permissions_override: (row.permissions_override as PermissionSet) ?? null,
    created_by: (row.created_by as string) ?? null,
    last_login_at: (row.last_login_at as string) ?? null,
    created_at: (row.created_at as string) || new Date().toISOString(),
  };
}

export async function getAdminAccounts(): Promise<AdminAccount[]> {
  if (demoMode()) {
    const base: AdminAccount[] = mock.adminUsers.map((a) => ({
      id: a.id, username: a.username, name: "Naman Sir", email: "admin@example.com", phone: null,
      role_id: "super_admin", role: a.role, status: "active", must_change_password: false,
      permissions_override: null, created_by: null, last_login_at: null, created_at: a.created_at,
    }));
    return [...base, ...demoExtraAccounts.map(({ password, ...rest }) => rest)];
  }
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("admin_users").select("id,username,name,email,phone,role_id,role,status,must_change_password,permissions_override,created_by,last_login_at,created_at").order("created_at", { ascending: true });
  return ((data as Record<string, unknown>[]) ?? []).map(mapDbAccount);
}
export async function getAdminAccountById(id: string): Promise<AdminAccount | null> {
  const all = await getAdminAccounts();
  return all.find((a) => a.id === id) ?? null;
}

// ----------------------------- STAFF COMP ACCESS -----------------------------
// Internal access grants (staff → course/webinar). A separate table that NEVER
// touches payments/course_enrollments/webinar_registrations, so it can't affect
// any revenue, seat or "registrations today" metric. Idempotent everywhere.

let _demoStaffGrants: StaffAccessGrant[] = [];

const grantActive = (g: StaffAccessGrant, now = Date.now()): boolean =>
  !g.expires_at || Date.parse(g.expires_at) > now;

/** All grants for one staff member (admin_users.id). */
export async function getStaffAccessGrants(adminId: string): Promise<StaffAccessGrant[]> {
  const id = (adminId || "").trim();
  if (!id) return [];
  if (demoMode()) return _demoStaffGrants.filter((g) => g.admin_id === id);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("staff_access_grants").select("*").eq("admin_id", id);
  return (data as StaffAccessGrant[]) ?? [];
}

/** Every grant across all staff — for admin badges/summary. */
export async function getAllStaffAccessGrants(): Promise<StaffAccessGrant[]> {
  if (demoMode()) return [..._demoStaffGrants];
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("staff_access_grants").select("*");
  return (data as StaffAccessGrant[]) ?? [];
}

/** Course ids a staff member currently has ACTIVE (non-expired) comp access to. */
export async function getActiveStaffCourseIds(adminId: string): Promise<string[]> {
  const grants = await getStaffAccessGrants(adminId);
  const now = Date.now();
  return grants.filter((g) => g.kind === "course" && grantActive(g, now)).map((g) => g.ref_id);
}

/** Webinar ids a staff member currently has ACTIVE (non-expired) comp access to. */
export async function getActiveStaffWebinarIds(adminId: string): Promise<string[]> {
  const grants = await getStaffAccessGrants(adminId);
  const now = Date.now();
  return grants.filter((g) => g.kind === "webinar" && grantActive(g, now)).map((g) => g.ref_id);
}

/** The staff member (admin account) linked to a USER-PORTAL phone, if any. */
export async function getAdminAccountByPhone(phone: string): Promise<AdminAccount | null> {
  const n = normalizeIndianMobile(phone);
  if (!n.ok || !n.digits10) return null;
  const accounts = await getAdminAccounts();
  return accounts.find((a) => a.phone === n.digits10) ?? null;
}

/**
 * Bridge: the comp courses/webinars a USER-PORTAL phone is entitled to via STAFF
 * access. Maps phone → linked staff account → existing staff_access_grants. Empty
 * when the phone isn't a staff phone. This is how a staff member, logged into the
 * normal student portal, sees exactly the items comped to them — no new auth.
 */
export async function getActiveStaffGrantsByPhone(
  phone: string,
): Promise<{ adminId: string | null; courseIds: string[]; webinarIds: string[] }> {
  const admin = await getAdminAccountByPhone(phone);
  if (!admin) return { adminId: null, courseIds: [], webinarIds: [] };
  const grants = await getStaffAccessGrants(admin.id);
  const now = Date.now();
  return {
    adminId: admin.id,
    courseIds: grants.filter((g) => g.kind === "course" && grantActive(g, now)).map((g) => g.ref_id),
    webinarIds: grants.filter((g) => g.kind === "webinar" && grantActive(g, now)).map((g) => g.ref_id),
  };
}

/** Course ids a USER-PORTAL phone has via staff comp access (entitlement merge helper). */
export async function getActiveStaffCourseIdsByPhone(phone: string): Promise<string[]> {
  return (await getActiveStaffGrantsByPhone(phone)).courseIds;
}

/** Idempotently add grants for a staff member (no-op for ones already present). */
async function addStaffGrants(
  adminId: string,
  kind: "course" | "webinar",
  refIds: string[],
  grantedBy: string | null,
): Promise<void> {
  const ids = [...new Set(refIds.map((r) => (r || "").trim()).filter(Boolean))];
  if (!ids.length) return;
  if (demoMode()) {
    for (const ref_id of ids) {
      if (!_demoStaffGrants.some((g) => g.admin_id === adminId && g.kind === kind && g.ref_id === ref_id)) {
        _demoStaffGrants.push({
          id: uuid(), admin_id: adminId, kind, ref_id, granted_by: grantedBy,
          expires_at: null, created_at: new Date().toISOString(),
        });
      }
    }
    return;
  }
  const db = getSupabaseAdmin();
  if (!db) return;
  const rows = ids.map((ref_id) => ({ admin_id: adminId, kind, ref_id, granted_by: grantedBy }));
  // ON CONFLICT (admin_id, kind, ref_id) DO NOTHING — safe to re-run.
  await db.from("staff_access_grants").upsert(rows, { onConflict: "admin_id,kind,ref_id", ignoreDuplicates: true });
}

/** Remove specific grants. Removing one that doesn't exist is a no-op. */
async function removeStaffGrants(adminId: string, kind: "course" | "webinar", refIds: string[]): Promise<void> {
  const ids = [...new Set(refIds.map((r) => (r || "").trim()).filter(Boolean))];
  if (!ids.length) return;
  if (demoMode()) {
    _demoStaffGrants = _demoStaffGrants.filter(
      (g) => !(g.admin_id === adminId && g.kind === kind && ids.includes(g.ref_id)),
    );
    return;
  }
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.from("staff_access_grants").delete().eq("admin_id", adminId).eq("kind", kind).in("ref_id", ids);
}

/**
 * Reconcile a staff member's grants to EXACTLY the desired selection (adds
 * missing, removes unselected). Powers the modal's single Save = grant + revoke.
 */
export async function setStaffAccess(
  adminId: string,
  desired: { courseIds: string[]; webinarIds: string[] },
  grantedBy: string | null,
): Promise<void> {
  const id = (adminId || "").trim();
  if (!id) return;
  const existing = await getStaffAccessGrants(id);
  const curCourses = new Set(existing.filter((g) => g.kind === "course").map((g) => g.ref_id));
  const curWebinars = new Set(existing.filter((g) => g.kind === "webinar").map((g) => g.ref_id));
  const wantCourses = new Set((desired.courseIds || []).map((r) => r.trim()).filter(Boolean));
  const wantWebinars = new Set((desired.webinarIds || []).map((r) => r.trim()).filter(Boolean));

  await Promise.all([
    addStaffGrants(id, "course", [...wantCourses].filter((c) => !curCourses.has(c)), grantedBy),
    addStaffGrants(id, "webinar", [...wantWebinars].filter((w) => !curWebinars.has(w)), grantedBy),
    removeStaffGrants(id, "course", [...curCourses].filter((c) => !wantCourses.has(c))),
    removeStaffGrants(id, "webinar", [...curWebinars].filter((w) => !wantWebinars.has(w))),
  ]);
  // Access changed → refresh this staff member's portal across all their devices.
  await bumpStaffPortalSession(id);
}

/** Additively grant the same courses/webinars to MANY staff at once (idempotent). */
export async function bulkGrantStaffAccess(
  adminIds: string[],
  add: { courseIds: string[]; webinarIds: string[] },
  grantedBy: string | null,
): Promise<{ staff: number }> {
  const ids = [...new Set(adminIds.map((a) => (a || "").trim()).filter(Boolean))];
  for (const adminId of ids) {
    await addStaffGrants(adminId, "course", add.courseIds || [], grantedBy);
    await addStaffGrants(adminId, "webinar", add.webinarIds || [], grantedBy);
    await bumpStaffPortalSession(adminId);
  }
  return { staff: ids.length };
}

/** Remove ALL grants for a staff member (Revoke all). */
export async function revokeAllStaffAccess(adminId: string): Promise<void> {
  const id = (adminId || "").trim();
  if (!id) return;
  if (demoMode()) {
    _demoStaffGrants = _demoStaffGrants.filter((g) => g.admin_id !== id);
    await bumpStaffPortalSession(id);
    return;
  }
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.from("staff_access_grants").delete().eq("admin_id", id);
  await bumpStaffPortalSession(id);
}

function genPassword(): string {
  const lower = "abcdefghijkmnpqrstuvwxyz", upper = "ABCDEFGHJKLMNPQRSTUVWXYZ", nums = "23456789", sym = "!@#$%*";
  const all = lower + upper + nums + sym;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let out = pick(lower) + pick(upper) + pick(nums) + pick(sym);
  for (let i = 0; i < 8; i++) out += pick(all);
  return out.split("").sort(() => Math.random() - 0.5).join("");
}

export async function createAdminAccount(input: {
  name: string; username: string; email?: string | null; phone?: string | null; role_id: string;
  password?: string; must_change_password?: boolean; permissions_override?: PermissionSet | null; created_by?: string | null;
}): Promise<{ ok: boolean; account?: AdminAccount; password?: string; error?: string }> {
  const username = input.username.trim().toLowerCase();
  if (!username) return { ok: false, error: "Username required." };
  const password = input.password && input.password.length >= 8 ? input.password : genPassword();
  const role = await getRoleById(input.role_id);
  if (!role) return { ok: false, error: "Invalid role." };
  const ts = new Date().toISOString();

  // Optional staff phone — validated to a canonical 10-digit form; enforced unique.
  let phone: string | null = null;
  if (input.phone != null && String(input.phone).trim() !== "") {
    const n = normalizeIndianMobile(String(input.phone));
    if (!n.ok || !n.digits10) return { ok: false, error: n.error || "Enter a valid 10-digit mobile number." };
    phone = n.digits10;
  }

  if (demoMode()) {
    if (mock.adminUsers.some((a) => a.username === username) || demoExtraAccounts.some((a) => a.username === username)) return { ok: false, error: "Username already exists." };
    if (phone && demoExtraAccounts.some((a) => a.phone === phone)) return { ok: false, error: "That phone number is already used by another staff member." };
    const account: AdminAccount = {
      id: uuid(), username, name: input.name || username, email: input.email ?? null, phone, role_id: input.role_id, role: role.name,
      status: "active", must_change_password: input.must_change_password ?? true, permissions_override: input.permissions_override ?? null,
      created_by: input.created_by ?? null, last_login_at: null, created_at: ts,
    };
    demoExtraAccounts.push({ ...account, password });
    return { ok: true, account, password };
  }
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "No database." };
  const existing = await db.from("admin_users").select("id").eq("username", username).maybeSingle();
  if (existing.data) return { ok: false, error: "Username already exists." };
  if (phone) {
    const dupe = await db.from("admin_users").select("id").eq("phone", phone).maybeSingle();
    if (dupe.data) return { ok: false, error: "That phone number is already used by another staff member." };
  }
  const bcrypt = await import("bcryptjs");
  const password_hash = await bcrypt.hash(password, 10);
  const row = {
    id: uuid(), username, password_hash, name: input.name || username, email: input.email ?? null, phone,
    role_id: input.role_id, role: role.name, status: "active", must_change_password: input.must_change_password ?? true,
    permissions_override: input.permissions_override ?? null, created_by: input.created_by ?? null, created_at: ts,
  };
  const { data, error } = await db.from("admin_users").insert(row).select("id,username,name,email,phone,role_id,role,status,must_change_password,permissions_override,created_by,last_login_at,created_at").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, account: mapDbAccount(data as Record<string, unknown>), password };
}

export async function updateAdminAccount(id: string, patch: { name?: string; email?: string | null; phone?: string | null; role_id?: string; status?: "active" | "disabled"; permissions_override?: PermissionSet | null }): Promise<{ ok: boolean; account?: AdminAccount | null; error?: string }> {
  const clean: Record<string, unknown> = {};
  if (patch.name !== undefined) clean.name = patch.name;
  if (patch.email !== undefined) clean.email = patch.email;
  if (patch.phone !== undefined) {
    if (patch.phone == null || String(patch.phone).trim() === "") {
      clean.phone = null;
    } else {
      const n = normalizeIndianMobile(String(patch.phone));
      if (!n.ok || !n.digits10) return { ok: false, error: n.error || "Enter a valid 10-digit mobile number." };
      clean.phone = n.digits10;
    }
  }
  if (patch.role_id !== undefined) { clean.role_id = patch.role_id; const r = await getRoleById(patch.role_id); if (r) clean.role = r.name; }
  if (patch.status !== undefined) clean.status = patch.status;
  if (patch.permissions_override !== undefined) clean.permissions_override = patch.permissions_override;
  if (demoMode()) {
    const a = demoExtraAccounts.find((x) => x.id === id);
    if (!a) return { ok: false, error: "Account not found." };
    if (clean.phone && demoExtraAccounts.some((x) => x.id !== id && x.phone === clean.phone)) {
      return { ok: false, error: "That phone number is already used by another staff member." };
    }
    Object.assign(a, clean);
    const { password, ...rest } = a; void password;
    return { ok: true, account: rest };
  }
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "No database." };
  if (clean.phone) {
    const dupe = await db.from("admin_users").select("id").eq("phone", clean.phone as string).neq("id", id).maybeSingle();
    if (dupe.data) return { ok: false, error: "That phone number is already used by another staff member." };
  }
  const { data, error } = await db.from("admin_users").update(clean).eq("id", id).select("id,username,name,email,phone,role_id,role,status,must_change_password,permissions_override,created_by,last_login_at,created_at").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, account: data ? mapDbAccount(data as Record<string, unknown>) : null };
}

export async function resetAdminPassword(id: string, newPassword?: string): Promise<{ ok: boolean; password?: string; error?: string }> {
  const password = newPassword && newPassword.length >= 8 ? newPassword : genPassword();
  if (demoMode()) {
    const a = demoExtraAccounts.find((x) => x.id === id);
    if (!a) return { ok: false, error: "Account not found (demo: only newly-created staff can be reset)." };
    a.password = password; a.must_change_password = true;
    return { ok: true, password };
  }
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "No database." };
  const bcrypt = await import("bcryptjs");
  const password_hash = await bcrypt.hash(password, 10);
  const { error } = await db.from("admin_users").update({ password_hash, must_change_password: true }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true, password };
}

/** Self-service password change (clears the must-change flag). */
export async function changeOwnPassword(id: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  if (newPassword.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  if (demoMode()) {
    const a = demoExtraAccounts.find((x) => x.id === id);
    if (a) { a.password = newPassword; a.must_change_password = false; }
    return { ok: true };
  }
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "No database." };
  const bcrypt = await import("bcryptjs");
  const password_hash = await bcrypt.hash(newPassword, 10);
  const { error } = await db.from("admin_users").update({ password_hash, must_change_password: false }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteAdminAccount(id: string): Promise<{ ok: boolean; error?: string }> {
  const accounts = await getAdminAccounts();
  const target = accounts.find((a) => a.id === id);
  if (!target) return { ok: false, error: "Account not found." };
  // Never remove the last active Super Admin.
  const superAdmins = accounts.filter((a) => a.role_id === "super_admin" && a.status === "active");
  if (target.role_id === "super_admin" && superAdmins.length <= 1) return { ok: false, error: "Cannot remove the last Super Admin." };
  if (demoMode()) {
    const idx = demoExtraAccounts.findIndex((x) => x.id === id);
    if (idx >= 0) { demoExtraAccounts.splice(idx, 1); return { ok: true }; }
    return { ok: false, error: "Demo: seeded admin cannot be removed." };
  }
  const ok = await dbDelete("admin_users", id);
  return ok ? { ok: true } : { ok: false, error: "Delete failed." };
}

// ============================ COURSES ============================
/** Stable sort: explicit display_order ascending (nulls last), then newest first. */
function sortCoursesByOrder(list: Course[]): Course[] {
  return [...list].sort((a, b) => {
    const ao = a.display_order ?? Number.POSITIVE_INFINITY;
    const bo = b.display_order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
}

export async function getAllCourses(): Promise<Course[]> {
  if (demoMode()) return sortCoursesByOrder(mock.courses);
  const rows = await dbSelect<Course>("courses");
  return sortCoursesByOrder(rows.length ? rows : [...mock.courses]);
}
export async function getPublishedCourses(): Promise<Course[]> {
  const all = await getAllCourses();
  // Public site: only published AND not disabled (Task 7).
  return all.filter((c) => c.status === "published" && c.active !== false);
}
export async function getCourseBySlug(slug: string): Promise<Course | null> {
  const all = await getAllCourses();
  return all.find((c) => c.slug === slug) ?? null;
}
/** Next display_order for a brand-new course (append to the end of the list). */
async function nextCourseOrder(): Promise<number> {
  if (demoMode()) {
    return mock.courses.reduce((m, c) => Math.max(m, c.display_order ?? 0), 0) + 1;
  }
  const db = getSupabaseAdmin();
  if (!db) return 1;
  const { data } = await db.from("courses").select("display_order").order("display_order", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  return ((data?.display_order as number | null) ?? 0) + 1;
}

export async function addCourse(input: Partial<Course>): Promise<Course> {
  const display_order = input.display_order ?? (await nextCourseOrder());
  const row = {
    id: uuid(),
    display_order,
    slug: input.slug || (input.title || "course").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
    title: input.title || "Untitled Course",
    category: input.category || "Foundation",
    description: input.description || "",
    long_description: input.long_description ?? null,
    image: input.image ?? null,
    modes: input.modes || ["Online"],
    language: input.language || "Hinglish (Bilingual)",
    target_years: input.target_years || "2026/27",
    batch_start: input.batch_start ?? null,
    duration: input.duration ?? null,
    price: input.price ?? 0,
    original_price: input.original_price ?? null,
    pay_in_full_price: input.pay_in_full_price ?? null,
    gst: input.gst ?? false,
    emi_amount: input.emi_amount ?? null,
    emi_months: input.emi_months ?? null,
    faculty: input.faculty || "Naman Sir",
    capacity: input.capacity ?? null,
    seats_left: input.seats_left ?? null,
    status: input.status || "draft",
    brochure_link: input.brochure_link ?? null,
    demo_video: input.demo_video ?? null,
    razorpay_link: input.razorpay_link ?? null,
    included: input.included || [],
    not_included: input.not_included || [],
    curriculum: input.curriculum || [],
    schedule: input.schedule ?? null,
    featured: input.featured ?? false,
    cover_image_url: input.cover_image_url ?? null,
    mobile_image_url: input.mobile_image_url ?? null,
    faqs: input.faqs ?? [],
    contact_links: input.contact_links ?? [],
    pdf_resources: input.pdf_resources ?? [],
    coupons: input.coupons ?? [],
    active: input.active ?? true,
    about_html: input.about_html ?? null,
    badge_label: input.badge_label ?? null,
    seat_config: input.seat_config ?? {},
    whatsapp_config: input.whatsapp_config ?? {},
    video_config: input.video_config ?? {},
    mentor: input.mentor ?? {},
    seo: input.seo ?? {},
    what_you_learn: input.what_you_learn ?? [],
    who_should_attend: input.who_should_attend ?? [],
    what_you_get: input.what_you_get ?? [],
    reviews: input.reviews ?? [],
    sections: input.sections ?? [],
    brochure_ids: input.brochure_ids ?? [],
    batch_timings: input.batch_timings ?? [],
    after_registration: input.after_registration ?? {},
    emi_config: input.emi_config ?? {},
    entitlements: input.entitlements ?? {},
    created_at: new Date().toISOString(),
  } as Course;
  if (demoMode()) {
    mock.courses.unshift(row);
    return row;
  }
  return dbInsert<Course>("courses", row as unknown as Record<string, unknown>);
}
export async function updateCourse(id: string, patch: Partial<Course>): Promise<Course | null> {
  if (demoMode()) {
    const idx = mock.courses.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    mock.courses[idx] = { ...mock.courses[idx], ...patch };
    return mock.courses[idx];
  }
  return dbUpdate<Course>("courses", id, patch as Record<string, unknown>);
}
export async function deleteCourse(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.courses.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    mock.courses.splice(idx, 1);
    return true;
  }
  return dbDelete("courses", id);
}

/**
 * Persist a new ordering for courses. `orderedIds` is the full list of course ids
 * in their desired top-to-bottom order. Only rows whose order actually changes are
 * written (efficient + concurrency-friendly).
 */
export async function reorderCourses(orderedIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const targets = orderedIds.map((id, i) => ({ id, display_order: i + 1 }));
  if (demoMode()) {
    for (const t of targets) {
      const c = mock.courses.find((x) => x.id === t.id);
      if (c) c.display_order = t.display_order;
    }
    return { ok: true };
  }
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "No database" };
  // Only update rows whose order changed.
  const current = await dbSelect<Course>("courses");
  const currentMap = new Map(current.map((c) => [c.id, c.display_order ?? null]));
  const changed = targets.filter((t) => currentMap.get(t.id) !== t.display_order);
  for (const t of changed) {
    const { error } = await db.from("courses").update({ display_order: t.display_order }).eq("id", t.id);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

// ============================ LIBRARY (brochures / resources) ============================
const demoLibraryDocs: LibraryDoc[] = [];

export async function getLibraryDocs(): Promise<LibraryDoc[]> {
  if (demoMode()) return [...demoLibraryDocs];
  const db = getSupabaseAdmin();
  if (!db) return [...demoLibraryDocs];
  const { data } = await db.from("library_docs").select("*").order("created_at", { ascending: false });
  return (data as LibraryDoc[]) ?? [];
}

export async function getLibraryDocsByIds(ids?: string[] | null): Promise<LibraryDoc[]> {
  const wanted = (ids || []).filter(Boolean);
  if (!wanted.length) return [];
  const all = await getLibraryDocs();
  // Preserve the caller's order.
  const map = new Map(all.map((d) => [d.id, d]));
  return wanted.map((id) => map.get(id)).filter((d): d is LibraryDoc => !!d);
}

export async function addLibraryDoc(input: Partial<LibraryDoc>): Promise<LibraryDoc> {
  const now = new Date().toISOString();
  const row = {
    id: uuid(),
    title: input.title || "Untitled document",
    category: input.category ?? null,
    file_url: input.file_url || "",
    file_size: input.file_size ?? null,
    description: input.description ?? null,
    created_at: now,
    updated_at: now,
  } as LibraryDoc;
  if (demoMode()) { demoLibraryDocs.unshift(row); return row; }
  return dbInsert<LibraryDoc>("library_docs", row as unknown as Record<string, unknown>);
}

export async function updateLibraryDoc(id: string, patch: Partial<LibraryDoc>): Promise<LibraryDoc | null> {
  if (demoMode()) {
    const idx = demoLibraryDocs.findIndex((d) => d.id === id);
    if (idx === -1) return null;
    demoLibraryDocs[idx] = { ...demoLibraryDocs[idx], ...patch, updated_at: new Date().toISOString() };
    return demoLibraryDocs[idx];
  }
  return dbUpdate<LibraryDoc>("library_docs", id, { ...patch, updated_at: new Date().toISOString() } as Record<string, unknown>);
}

/** Where a library document is referenced (so we can warn before deleting). */
export async function getLibraryDocUsage(id: string): Promise<{ courses: string[]; webinars: string[] }> {
  const [courses, webinars] = await Promise.all([getAllCourses(), getWebinars()]);
  const refs = (c: Course) => [...(c.brochure_ids || []), ...(c.after_registration?.doc_ids || [])];
  return {
    courses: courses.filter((c) => refs(c).includes(id)).map((c) => c.title),
    webinars: webinars.filter((w) => (w.brochure_ids || []).includes(id)).map((w) => w.title),
  };
}

export async function deleteLibraryDoc(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = demoLibraryDocs.findIndex((d) => d.id === id);
    if (idx === -1) return false;
    demoLibraryDocs.splice(idx, 1);
    return true;
  }
  return dbDelete("library_docs", id);
}

// ============================ ENROLLMENTS ============================
export async function getEnrollments(studentId?: string): Promise<Enrollment[]> {
  const all = demoMode() ? [...mock.enrollments] : await dbSelect<Enrollment>("enrollments", "enrolled_at");
  const list = all.length ? all : [...mock.enrollments];
  return studentId ? list.filter((e) => e.student_id === studentId) : list;
}

// ============================ LEADS / CRM ============================
export async function getLeads(): Promise<Lead[]> {
  if (demoMode()) return [...mock.leads];
  const rows = await dbSelect<Lead>("leads");
  return rows.length ? rows : [...mock.leads];
}
export async function addLead(input: Partial<Lead>): Promise<Lead> {
  const row = {
    id: uuid(),
    name: input.name || "New Lead",
    phone: input.phone || "",
    city: input.city ?? null,
    state: input.state ?? null,
    source: input.source || "Website",
    campaign: input.campaign ?? null,
    course_interest: input.course_interest ?? null,
    target_year: input.target_year ?? null,
    mode_pref: input.mode_pref ?? null,
    called: false,
    status: input.status || "New",
    temperature: input.temperature || "Interested",
    demo_booked: false,
    demo_attended: false,
    webinar_registered: input.webinar_registered ?? false,
    webinar_attended: false,
    admitted: false,
    course: null,
    total_fee: null,
    amount_collected: null,
    pending_balance: null,
    follow_up_date: input.follow_up_date ?? null,
    counsellor: input.counsellor ?? null,
    created_at: new Date().toISOString(),
  } as Lead;
  // Only attach email when provided — keeps inserts working even if the
  // `email` column hasn't been added yet (migration applied separately).
  if (input.email) row.email = input.email;
  if (demoMode()) {
    mock.leads.unshift(row);
    return row;
  }
  return dbInsert<Lead>("leads", row as unknown as Record<string, unknown>);
}
export async function updateLead(id: string, patch: Partial<Lead>): Promise<Lead | null> {
  if (demoMode()) {
    const idx = mock.leads.findIndex((l) => l.id === id);
    if (idx === -1) return null;
    mock.leads[idx] = { ...mock.leads[idx], ...patch };
    return mock.leads[idx];
  }
  return dbUpdate<Lead>("leads", id, patch as Record<string, unknown>);
}
export async function deleteLead(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.leads.findIndex((l) => l.id === id);
    if (idx === -1) return false;
    mock.leads.splice(idx, 1);
    return true;
  }
  return dbDelete("leads", id);
}
export async function getLeadActivities(leadId: string): Promise<LeadActivity[]> {
  if (demoMode()) return mock.leadActivities.filter((a) => a.lead_id === leadId);
  const rows = await dbSelect<LeadActivity>("lead_activities", "timestamp");
  return rows.filter((a) => a.lead_id === leadId);
}
export async function addLeadActivity(input: Partial<LeadActivity>): Promise<LeadActivity> {
  const row = {
    id: uuid(),
    lead_id: input.lead_id || "",
    type: input.type || "note",
    note: input.note || "",
    counsellor: input.counsellor ?? null,
    timestamp: new Date().toISOString(),
  } as LeadActivity;
  if (demoMode()) {
    mock.leadActivities.unshift(row);
    return row;
  }
  return dbInsert<LeadActivity>("lead_activities", row as unknown as Record<string, unknown>);
}

// ============================ LEAD FORMS ============================
export async function getLeadForms(): Promise<LeadFormConfig[]> {
  if (demoMode()) return [...mock.leadForms];
  const rows = await dbSelect<LeadFormConfig>("lead_forms");
  return rows.length ? rows : [...mock.leadForms];
}
export async function addLeadForm(input: Partial<LeadFormConfig>): Promise<LeadFormConfig> {
  const row = {
    id: uuid(),
    name: input.name || "New Form",
    slug: input.slug || (input.name || "form").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    campaign: input.campaign || "General",
    fields: input.fields || ["name", "phone"],
    submissions: 0,
    created_at: new Date().toISOString(),
  } as LeadFormConfig;
  if (demoMode()) {
    mock.leadForms.unshift(row);
    return row;
  }
  return dbInsert<LeadFormConfig>("lead_forms", row as unknown as Record<string, unknown>);
}

// ============================ WEBINARS ============================
export async function getWebinars(): Promise<Webinar[]> {
  if (demoMode()) return [...mock.webinars];
  const rows = await dbSelect<Webinar>("webinars");
  return rows.length ? rows : [...mock.webinars];
}

// Lightweight "is any webinar upcoming?" check for the public-nav NEW badge, which
// renders on EVERY public page. Avoids the full getWebinars() select(*) by reading
// only two columns, and caches the boolean for 60s across requests/pages.
let _upcomingWebinarCache: { v: boolean; exp: number } | null = null;
const UPCOMING_TTL_MS = 60000;
const _isUpcomingWebinar = (w: { status?: string | null; datetime?: string | null }): boolean =>
  w.status !== "completed" && (!w.datetime || new Date(w.datetime).getTime() > Date.now());

export async function hasUpcomingWebinars(): Promise<boolean> {
  const now = Date.now();
  if (_upcomingWebinarCache && _upcomingWebinarCache.exp > now) return _upcomingWebinarCache.v;
  let v = false;
  if (demoMode()) {
    v = mock.webinars.some(_isUpcomingWebinar);
  } else {
    const db = getSupabaseAdmin();
    if (!db) {
      v = mock.webinars.some(_isUpcomingWebinar);
    } else {
      try {
        const { data } = await db.from("webinars").select("status,datetime");
        const rows = (data as { status: string | null; datetime: string | null }[]) ?? [];
        // Parity with getWebinars(): an empty table falls back to the mock set.
        v = rows.length ? rows.some(_isUpcomingWebinar) : mock.webinars.some(_isUpcomingWebinar);
      } catch {
        v = mock.webinars.some(_isUpcomingWebinar);
      }
    }
  }
  _upcomingWebinarCache = { v, exp: now + UPCOMING_TTL_MS };
  return v;
}
/** Public webinars only — hides disabled items (Task 7). */
export async function getPublicWebinars(): Promise<Webinar[]> {
  const all = await getWebinars();
  return all.filter((w) => w.active !== false);
}
export async function getWebinarBySlug(slug: string): Promise<Webinar | null> {
  const all = await getWebinars();
  return all.find((w) => w.slug === slug) ?? null;
}
export async function addWebinar(input: Partial<Webinar>): Promise<Webinar> {
  const row = {
    id: uuid(),
    slug: input.slug || (input.title || "webinar").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title: input.title || "New Webinar",
    description: input.description || "",
    datetime: input.datetime || new Date().toISOString(),
    link: input.link ?? null,
    price: input.price ?? 0,
    capacity: input.capacity ?? null,
    registrations: 0,
    recording_link: input.recording_link ?? null,
    status: input.status || "upcoming",
    end_datetime: input.end_datetime ?? null,
    long_description: input.long_description ?? null,
    cover_image_url: input.cover_image_url ?? null,
    mobile_image_url: input.mobile_image_url ?? null,
    faqs: input.faqs ?? [],
    contact_links: input.contact_links ?? [],
    pdf_resources: input.pdf_resources ?? [],
    coupons: input.coupons ?? [],
    active: input.active ?? true,
    about_html: input.about_html ?? null,
    badge_label: input.badge_label ?? null,
    seat_config: input.seat_config ?? {},
    whatsapp_config: input.whatsapp_config ?? {},
    video_config: input.video_config ?? {},
    mentor: input.mentor ?? {},
    seo: input.seo ?? {},
    what_you_learn: input.what_you_learn ?? [],
    who_should_attend: input.who_should_attend ?? [],
    what_you_get: input.what_you_get ?? [],
    reviews: input.reviews ?? [],
    sections: input.sections ?? [],
    session_type: input.session_type ?? "live",
    join_note: input.join_note ?? null,
    materials: input.materials ?? [],
    cross_sell: input.cross_sell ?? {},
    brochure_ids: input.brochure_ids ?? [],
    created_at: new Date().toISOString(),
  } as Webinar;
  if (demoMode()) {
    mock.webinars.unshift(row);
    return row;
  }
  return dbInsert<Webinar>("webinars", row as unknown as Record<string, unknown>);
}
export async function updateWebinar(id: string, patch: Partial<Webinar>): Promise<Webinar | null> {
  if (demoMode()) {
    const idx = mock.webinars.findIndex((w) => w.id === id);
    if (idx === -1) return null;
    mock.webinars[idx] = { ...mock.webinars[idx], ...patch };
    return mock.webinars[idx];
  }
  return dbUpdate<Webinar>("webinars", id, patch as Record<string, unknown>);
}
export async function deleteWebinar(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.webinars.findIndex((w) => w.id === id);
    if (idx === -1) return false;
    mock.webinars.splice(idx, 1);
    return true;
  }
  return dbDelete("webinars", id);
}
export async function registerWebinar(webinarId: string, name: string, phone: string): Promise<{ ok: boolean }> {
  if (demoMode()) {
    const w = mock.webinars.find((x) => x.id === webinarId);
    if (w) w.registrations += 1;
    // also push into CRM as a lead
    await addLead({ name, phone, source: "Webinar", webinar_registered: true, campaign: w?.title });
    await ensureBuyer(phone, name).catch(() => null);
    fireAutoSms({ trigger: TRIGGERS.registration_created, phone, name, vars: { item_short: w?.title || "your webinar" }, entity: { webinar_id: webinarId }, entityId: webinarId });
    return { ok: true };
  }
  const db = getSupabaseAdmin();
  if (db) {
    try {
      await db.from("webinar_registrations").insert({ webinar_id: webinarId, name, phone });
    } catch {
      /* ignore */
    }
  }
  // Analytics (best-effort, idempotent): a webinar registration milestone.
  void recordRegistrationCreated({ webinar_id: webinarId, phone, is_free: true }).catch(() => {});
  // Auto-SMS (disabled by default): webinar registered. Title fetched cheaply.
  let webinarTitle: string | null = null;
  if (db) { try { const { data } = await db.from("webinars").select("title").eq("id", webinarId).maybeSingle(); webinarTitle = (data?.title as string) ?? null; } catch { /* ignore */ } }
  fireAutoSms({ trigger: TRIGGERS.registration_created, phone, name, vars: { item_short: webinarTitle || "your webinar" }, entity: { webinar_id: webinarId }, entityId: webinarId });
  await addLead({ name, phone, source: "Webinar", webinar_registered: true });
  // UNIFIED IDENTITY: a webinar registrant (free or paid) becomes a first-class
  // student + buyer so they appear in Students & Enrollments and can open their
  // portal (webinar materials). Idempotent — one person stays one student.
  await ensureBuyer(phone, name).catch(() => null);
  return { ok: true };
}

/** All webinar registrations (admin/reporting). Empty in demo mode. */
export async function getAllWebinarRegistrations(): Promise<WebinarRegistration[]> {
  if (demoMode()) return [];
  const db = getSupabaseAdmin();
  if (!db) return [];
  try {
    const { data } = await db
      .from("webinar_registrations")
      .select("*")
      .order("created_at", { ascending: false });
    return (data as WebinarRegistration[]) ?? [];
  } catch {
    return [];
  }
}

/** Set of webinar IDs this phone has registered for (free or paid). Best-effort. */
export async function getWebinarRegistrationIdsByPhone(phone: string): Promise<Set<string>> {
  const p = (phone || "").trim();
  if (!p) return new Set();
  if (demoMode()) return new Set();
  const db = getSupabaseAdmin();
  if (!db) return new Set();
  try {
    const { data } = await db.from("webinar_registrations").select("webinar_id").eq("phone", p);
    return new Set(((data as { webinar_id: string }[]) ?? []).map((r) => r.webinar_id).filter(Boolean));
  } catch {
    return new Set();
  }
}

// ============================ COUPONS ============================
/**
 * Best-effort increment of a coupon's usage counter on a course/webinar.
 * Called when a paid checkout that used the coupon is initiated.
 */
export async function incrementCouponUsage(
  itemType: "course" | "webinar",
  id: string,
  code: string
): Promise<void> {
  try {
    const normalized = code.trim().toLowerCase();
    if (itemType === "course") {
      const all = await getAllCourses();
      const item = all.find((c) => c.id === id);
      if (!item?.coupons) return;
      const coupons = item.coupons.map((c) =>
        c.code.trim().toLowerCase() === normalized ? { ...c, used: (c.used || 0) + 1 } : c
      );
      await updateCourse(id, { coupons });
    } else {
      const all = await getWebinars();
      const item = all.find((w) => w.id === id);
      if (!item?.coupons) return;
      const coupons = item.coupons.map((c) =>
        c.code.trim().toLowerCase() === normalized ? { ...c, used: (c.used || 0) + 1 } : c
      );
      await updateWebinar(id, { coupons });
    }
  } catch {
    /* non-fatal */
  }
}

// ============================ PAYMENTS ============================
/**
 * Demo payments are kept on `globalThis` so the in-memory store is a single
 * process-wide singleton: it survives Next.js dev HMR recompiles and is shared
 * across separate route-handler bundles (otherwise create-payment and the
 * status/callback routes would each see their own empty copy, causing
 * "Payment not found"). NOTE: this is per-instance only — real ICICI payments
 * still require Supabase, because the bank callback can hit a different
 * serverless instance than the one that created the record.
 */
function demoPayments(): Payment[] {
  const g = globalThis as unknown as { __namanDemoPayments?: Payment[] };
  if (!g.__namanDemoPayments) g.__namanDemoPayments = [...mock.payments];
  return g.__namanDemoPayments;
}

export async function getPayments(): Promise<Payment[]> {
  if (demoMode()) return demoPayments().filter((p) => !p.deleted_at);
  const db = getSupabaseAdmin();
  if (!db) return demoPayments().filter((p) => !p.deleted_at);
  // Exclude soft-deleted rows (Trash) from every money/access read. Restore/Trash
  // views use getPaymentById / getDeletedPayments which intentionally include them.
  const { data } = await db.from("payments").select("*").is("deleted_at", null).order("created_at", { ascending: false });
  const rows = (data as Payment[]) ?? [];
  return rows.length ? rows : demoPayments().filter((p) => !p.deleted_at);
}

/** Soft-deleted payments only — powers the super-admin recoverable Trash view. */
export async function getDeletedPayments(): Promise<Payment[]> {
  if (demoMode()) return demoPayments().filter((p) => !!p.deleted_at);
  const db = getSupabaseAdmin();
  if (!db) return demoPayments().filter((p) => !!p.deleted_at);
  const { data } = await db.from("payments").select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false });
  return (data as Payment[]) ?? [];
}

// ============================ PAYMENT VERIFICATION ENGINE (ICICI-truth) ============================
//
// CORE PRINCIPLE: a TIMER NEVER marks a payment FAILED. Only ICICI does — via the
// signed return-URL callback (stored evidence) OR the Verify URL (live status).
// A timer may only move PENDING -> VERIFYING (a label, not a terminal state).
// ICICI success ALWAYS upgrades any non-paid row -> PAID, even days later.

/** Statuses that already grant access — never re-verified, never downgraded. */
const PAID_STATUSES = ["PAID", "captured"];
/** Non-paid statuses eligible for (re)verification against ICICI. */
const NONPAID_STATUSES = ["PENDING", "pending", "VERIFYING", "ABANDONED", "FAILED"];

/**
 * Window (minutes) a fresh PENDING waits before we move it to VERIFYING.
 * Default 120 (2 hours) so slow UPI/netbanking callbacks have ample time to land
 * and we never prematurely move a real-but-unconfirmed payment off PENDING.
 * Override with env WEBINAR_PENDING_WINDOW_MINUTES.
 */
function pendingWindowMinutes(): number {
  const v = Number(process.env.WEBINAR_PENDING_WINDOW_MINUTES);
  return Number.isFinite(v) && v > 0 ? v : 120;
}

/** Backoff schedule (minutes after created_at) for verify attempt #index. */
const VERIFY_SCHEDULE_MIN = [2, 5, 10, 30, 60, 360];
/** ICICI may flip to success up to T+3 days; after that the status is final. */
const VERIFY_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/** Is a row due for another ICICI verify, per the backoff schedule? */
function isVerifyDue(row: Pick<Payment, "created_at" | "verify_attempts" | "last_verify_at">): boolean {
  const created = new Date(row.created_at).getTime();
  if (!Number.isFinite(created)) return true;
  const now = Date.now();
  const age = now - created;
  if (age > VERIFY_MAX_AGE_MS) return false; // ICICI won't change after T+3
  const attempts = row.verify_attempts ?? 0;
  if (attempts < VERIFY_SCHEDULE_MIN.length) {
    return now >= created + VERIFY_SCHEDULE_MIN[attempts] * 60_000;
  }
  // Steady state: at most once every 6h until the T+3 cutoff.
  const last = row.last_verify_at ? new Date(row.last_verify_at).getTime() : 0;
  return now - last >= 6 * 60 * 60 * 1000;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Map a verification outcome to the persisted status (null = leave unchanged). */
function statusForOutcome(outcome: VerifyOutcome): Payment["status"] | null {
  if (outcome === "paid") return "PAID";
  if (outcome === "failed") return "FAILED";
  if (outcome === "abandoned") return "ABANDONED";
  return null; // unknown
}

export interface ReverifyResult {
  scanned: number;
  /** Rows where ICICI (live or stored) gave a definitive answer. */
  reachable: number;
  /** Rows we could not get a definitive ICICI answer for. */
  unreachable: number;
  toPaid: number;
  toFailed: number;
  toAbandoned: number;
  toVerifying: number;
  unchanged: number;
  /** Optional per-row detail (dry-run / small batches). */
  details?: {
    reference_no: string | null;
    from: string;
    to: string;
    source: "callback" | "verify" | "none";
    rawStatus: string | null;
  }[];
}

export interface ReverifyOptions {
  /** Verify ONLY these references (per-row button / targeted recovery). */
  referenceNos?: string[];
  /** Status filter when references aren't given (default: all non-paid). */
  statuses?: string[];
  /** item_type filter (default webinar + course). */
  itemTypes?: string[];
  /** Report only — never write. */
  dryRun?: boolean;
  /** Apply the backoff schedule (cron / lazy sweep). Ignored when referenceNos set. */
  onlyDue?: boolean;
  /** Max rows to process in one run. */
  limit?: number;
  /** Delay between ICICI calls to respect gateway limits. */
  rateLimitMs?: number;
  /** Skip the live Verify URL and use stored callback evidence only. */
  storedOnly?: boolean;
  /** Collect per-row details (for dry-run / recovery report). */
  withDetails?: boolean;
}

/**
 * Per-row decision: stored ICICI callback evidence first (free), then the live
 * Verify URL. Never throws; returns "unknown" when ICICI can't confirm.
 */
async function decidePaymentOutcome(
  row: Payment,
  storedOnly: boolean,
): Promise<{ outcome: VerifyOutcome; source: "callback" | "verify" | "none"; rawStatus: string | null; gatewayRef: string | null }> {
  const stored = verifyFromStoredCallback(row);
  if (stored === "paid") return { outcome: "paid", source: "callback", rawStatus: row.response_code ?? null, gatewayRef: row.gateway_ref ?? null };

  if (!storedOnly && row.reference_no) {
    const live = await eazypayVerify(row.reference_no);
    if (live.reachable) return { outcome: live.outcome, source: "verify", rawStatus: live.rawStatus, gatewayRef: live.gatewayRef };
  }
  // No live answer — fall back to stored evidence (callback failure IS ICICI).
  if (stored === "failed") return { outcome: "failed", source: "callback", rawStatus: row.response_code ?? null, gatewayRef: null };
  return { outcome: "unknown", source: "none", rawStatus: null, gatewayRef: null };
}

/**
 * The SINGLE shared re-verification engine. Powers: Step-0 recovery, the admin
 * global/per-row "Re-verify" buttons, the cron sweep, and the lazy on-read sweep.
 *
 * Safety: selects only NON-paid rows (PAID/captured are never touched, never
 * downgraded). Idempotent + re-runnable. A timer never produces FAILED here —
 * FAILED/ABANDONED come only from an ICICI answer (live or stored callback).
 */
export async function reverifyPayments(opts: ReverifyOptions = {}): Promise<ReverifyResult> {
  const result: ReverifyResult = {
    scanned: 0, reachable: 0, unreachable: 0, toPaid: 0, toFailed: 0, toAbandoned: 0, toVerifying: 0, unchanged: 0,
    details: opts.withDetails ? [] : undefined,
  };
  if (demoMode()) return result;
  const db = getSupabaseAdmin();
  if (!db) return result;

  const itemTypes = opts.itemTypes ?? ["webinar", "course"];
  const limit = opts.limit ?? 500;
  const rateLimitMs = opts.rateLimitMs ?? 200;
  const dryRun = opts.dryRun ?? false;
  const storedOnly = opts.storedOnly ?? false;

  // Select candidate rows.
  let query = db.from("payments").select("*").order("created_at", { ascending: true }).limit(limit);
  if (opts.referenceNos?.length) {
    query = query.in("reference_no", opts.referenceNos);
  } else {
    const statuses = (opts.statuses ?? NONPAID_STATUSES).filter((s) => !PAID_STATUSES.includes(s));
    query = query.in("status", statuses).in("item_type", itemTypes);
  }
  const { data } = await query;
  let rows = (data as Payment[] | null) ?? [];
  // Hard guard: never operate on a paid row, even if asked by reference.
  rows = rows.filter((r) => !PAID_STATUSES.includes(r.status));
  if (opts.onlyDue && !opts.referenceNos?.length) rows = rows.filter((r) => isVerifyDue(r));

  for (const row of rows) {
    result.scanned += 1;
    const { outcome, source, rawStatus, gatewayRef } = await decidePaymentOutcome(row, storedOnly);
    if (source === "verify") await sleep(rateLimitMs);

    let target = statusForOutcome(outcome);
    // Unknown: never terminal. Promote a past-window PENDING to VERIFYING so the
    // UI/admin reflect "we're actively checking" — but a timer never FAILs it.
    if (target === null) {
      result.unreachable += 1;
      const ageMs = Date.now() - new Date(row.created_at).getTime();
      const pastWindow = ageMs >= pendingWindowMinutes() * 60_000;
      const isPending = row.status === "PENDING" || row.status === "pending";
      target = isPending && pastWindow ? "VERIFYING" : null;
    } else {
      result.reachable += 1;
    }

    // Tally the intended transition for the report.
    const willChange = !!target && target !== row.status;
    if (willChange) {
      if (target === "PAID") result.toPaid += 1;
      else if (target === "FAILED") result.toFailed += 1;
      else if (target === "ABANDONED") result.toAbandoned += 1;
      else if (target === "VERIFYING") result.toVerifying += 1;
    }
    result.details?.push({ reference_no: row.reference_no ?? null, from: row.status, to: target ?? row.status, source, rawStatus });

    if (dryRun) continue;

    // Persist. Only a real LIVE ICICI call bumps the verify counters / timestamp
    // (so blind-mode stored-evidence sweeps never consume the backoff budget or
    // write a misleading "last verified" time). Status changes always persist.
    const patch: Partial<Payment> = {};
    if (source === "verify") {
      patch.verify_attempts = (row.verify_attempts ?? 0) + 1;
      patch.last_verify_at = new Date().toISOString();
      if (rawStatus) patch.verify_status = rawStatus;
    }
    if (gatewayRef && !row.gateway_ref) patch.gateway_ref = gatewayRef;
    if (willChange && target) patch.status = target;
    if (Object.keys(patch).length === 0) continue; // nothing to write

    const { data: upd } = await db
      .from("payments")
      .update(patch as Record<string, unknown>)
      .eq("id", row.id)
      .not("status", "in", `(${PAID_STATUSES.join(",")})`) // never touch a paid row
      .select("id,phone,student_name,reference_no,item_type,status")
      .maybeSingle();

    // Paid-side effects (idempotent): create the buyer + finalize course payment.
    if (willChange && target === "PAID" && upd) {
      const r = upd as Pick<Payment, "phone" | "student_name" | "reference_no" | "item_type">;
      await ensureBuyer(r.phone, r.student_name).catch(() => null);
      if (r.item_type === "course" && r.reference_no) await finalizeCoursePaymentByReference(r.reference_no).catch(() => null);
    }
  }

  // `unchanged` may have been double-counted above; recompute cleanly.
  result.unchanged = result.scanned - result.toPaid - result.toFailed - result.toAbandoned - result.toVerifying;
  return result;
}

export interface ReconcileResult {
  /** Rows looked at. */
  selected: number;
  toPaid: number;
  toFailed: number;
  toAbandoned: number;
  toVerifying: number;
}

/**
 * Lazy / cron sweep. Re-verifies DUE non-paid payments against ICICI on a
 * backoff schedule and promotes past-window PENDING to VERIFYING. NEVER marks a
 * row FAILED on a timer — FAILED/ABANDONED only come from an ICICI answer.
 * Idempotent; never downgrades a paid row. Signature kept for existing callers.
 */
export async function reconcileStalePendingPayments(opts?: {
  timeoutMinutes?: number;
  itemTypes?: string[];
}): Promise<ReconcileResult> {
  const empty: ReconcileResult = { selected: 0, toPaid: 0, toFailed: 0, toAbandoned: 0, toVerifying: 0 };
  if (demoMode()) return empty;
  const db = getSupabaseAdmin();
  if (!db) return empty;

  // Automated sweeps only hit ICICI's Verify URL when a whitelisted egress proxy
  // is configured (avoids slow/unreachable calls on unconfigured environments).
  // Stored callback evidence is always applied. Manual admin/student verify calls
  // always attempt live regardless of this guard.
  const liveConfigured = !!(process.env.EAZYPAY_VERIFY_PROXY_URL || "").trim();
  const r = await reverifyPayments({
    statuses: NONPAID_STATUSES,
    itemTypes: opts?.itemTypes ?? ["webinar", "course"],
    onlyDue: true,
    limit: 300,
    storedOnly: !liveConfigured,
  });
  return { selected: r.scanned, toPaid: r.toPaid, toFailed: r.toFailed, toAbandoned: r.toAbandoned, toVerifying: r.toVerifying };
}

let _lastReconcileAt = 0;

/**
 * Throttled, fire-safe wrapper used on read paths (admin Payments tab, student
 * status page) so verification advances regardless of the external scheduler.
 * Runs at most once per `minIntervalMs` per server instance; never throws.
 */
export async function maybeReconcilePendingPayments(minIntervalMs = 60_000): Promise<void> {
  const now = Date.now();
  if (now - _lastReconcileAt < minIntervalMs) return;
  _lastReconcileAt = now;
  try {
    await reconcileStalePendingPayments();
  } catch (e) {
    console.error("[reconcile] lazy sweep failed (non-fatal):", (e as Error).message);
  }
}

export type CreatePaymentInput = Omit<Payment, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

export async function createPayment(input: CreatePaymentInput): Promise<Payment> {
  const row: Payment = {
    ...input,
    id: input.id ?? uuid(),
    created_at: input.created_at ?? new Date().toISOString(),
  } as Payment;
  if (demoMode()) {
    demoPayments().unshift(row);
    // Issue the portal login code at payment INITIATION (idempotent, phone-keyed).
    // A buyer row grants NO content access on its own (access stays gated by PAID /
    // amount_paid / grants) — it only lets a pending student log in to upload proof
    // and track status, which the proof-recovery flow + payment_pending SMS assume.
    await ensureBuyer(row.phone, row.student_name).catch(() => null);
    return row;
  }
  try {
    const saved = await dbInsert<Payment>("payments", row as unknown as Record<string, unknown>);
    // Issue the portal login code at payment INITIATION (idempotent, phone-keyed) so
    // PENDING/VERIFYING students can log in to upload proof. Access is still gated by
    // PAID/amount_paid — a buyer row never grants course/webinar content by itself.
    await ensureBuyer(saved.phone, saved.student_name).catch(() => null);
    // Analytics (best-effort, idempotent, never throws): a brand-new PAID row is a
    // completed purchase; a PENDING row is an initiated checkout.
    if (isPaidStatus(saved.status)) void recordPaymentPaid(saved, "checkout").catch(() => {});
    else if (saved.status === "PENDING") void recordPaymentInitiated(saved).catch(() => {});
    return saved;
  } catch {
    // Best-effort: fall back to in-memory so the flow still works pre-migration.
    demoPayments().unshift(row);
    return row;
  }
}

/** ALL payments for a phone (every status) — drives the proof-recovery engine. */
export async function getPaymentsByPhone(phone: string): Promise<Payment[]> {
  const p = (phone || "").trim();
  if (!p) return [];
  if (demoMode()) return demoPayments().filter((x) => x.phone === p && !x.deleted_at);
  const db = getSupabaseAdmin();
  if (!db) return demoPayments().filter((x) => x.phone === p && !x.deleted_at);
  const { data } = await db.from("payments").select("*").eq("phone", p).is("deleted_at", null).order("created_at", { ascending: false });
  return (data as Payment[]) ?? [];
}

export async function getPaymentByReference(referenceNo: string): Promise<Payment | null> {
  // Soft-deleted rows are excluded so a callback/verify/finalize never resurrects a
  // payment the super-admin moved to Trash. Restore clears deleted_at first.
  if (demoMode()) {
    return demoPayments().find((p) => p.reference_no === referenceNo && !p.deleted_at) ?? null;
  }
  const db = getSupabaseAdmin();
  if (!db) return demoPayments().find((p) => p.reference_no === referenceNo && !p.deleted_at) ?? null;
  const { data } = await db.from("payments").select("*").eq("reference_no", referenceNo).is("deleted_at", null).maybeSingle();
  if (data) return data as Payment;
  return demoPayments().find((p) => p.reference_no === referenceNo && !p.deleted_at) ?? null;
}

export async function getPaymentById(id: string): Promise<Payment | null> {
  const pid = (id || "").trim();
  if (!pid) return null;
  if (demoMode()) return demoPayments().find((p) => p.id === pid) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return demoPayments().find((p) => p.id === pid) ?? null;
  const { data } = await db.from("payments").select("*").eq("id", pid).maybeSingle();
  return (data as Payment) ?? null;
}

export async function updatePaymentByReference(
  referenceNo: string,
  patch: Partial<Payment>
): Promise<Payment | null> {
  const updateDemo = () => {
    const store = demoPayments();
    const idx = store.findIndex((p) => p.reference_no === referenceNo);
    if (idx === -1) return null;
    store[idx] = { ...store[idx], ...patch };
    return store[idx];
  };
  if (demoMode()) {
    const row = updateDemo();
    if (row && isPaidStatus(patch.status)) await ensureBuyer(row.phone, row.student_name).catch(() => null);
    return row;
  }
  const db = getSupabaseAdmin();
  if (db) {
    const { data } = await db
      .from("payments")
      .update(patch as Record<string, unknown>)
      .eq("reference_no", referenceNo)
      .select()
      .maybeSingle();
    if (data) {
      const row = data as Payment;
      if (isPaidStatus(patch.status)) await ensureBuyer(row.phone, row.student_name).catch(() => null);
      // Analytics (best-effort): record the transition. PAID funnels through the
      // idempotent paid emitter (callback / verify / cron / demo all converge).
      if (patch.status) {
        if (isPaidStatus(patch.status)) void recordPaymentPaid(row, "verify").catch(() => {});
        else void recordPaymentStatusChanged(row, String(patch.status), "verify").catch(() => {});
      }
      return row;
    }
  }
  return updateDemo();
}

// ============================ BUYERS (post-payment portal) ============================
/** A payment "counts" (grants access) once it reaches a paid status. */
export function isPaidStatus(status: string | null | undefined): boolean {
  return status === "PAID" || status === "captured";
}

export type WebinarPayClass = "PAID" | "PENDING" | "FAILED";
/** Normalize any gateway status to the webinar lifecycle. PAID/captured -> PAID,
 *  FAILED/refunded -> FAILED, everything else (incl. legacy "pending") -> PENDING. */
export function webinarPayClass(status: string | null | undefined): WebinarPayClass {
  const s = (status || "").toUpperCase();
  if (s === "PAID" || s === "CAPTURED") return "PAID";
  // ABANDONED (never completed) is, for the student, a retry-able non-payment.
  if (s === "FAILED" || s === "REFUNDED" || s === "ABANDONED") return "FAILED";
  // PENDING + VERIFYING -> still confirming.
  return "PENDING";
}
const PAY_RANK: Record<WebinarPayClass, number> = { PAID: 3, PENDING: 2, FAILED: 1 };

/**
 * Latest webinar payment outcome per webinar SLUG for a phone (PAID wins, then
 * PENDING, then FAILED). The single source of truth for "did this person pay for
 * this paid webinar?" — a free `webinar_registrations` lead row is NOT payment.
 */
export async function getWebinarPaymentStatusMap(phone: string): Promise<Map<string, WebinarPayClass>> {
  const p = (phone || "").trim();
  const out = new Map<string, WebinarPayClass>();
  if (!p) return out;
  const add = (slug: string | null | undefined, status: string | null | undefined) => {
    const s = (slug || "").trim();
    if (!s) return;
    const cls = webinarPayClass(status);
    const prev = out.get(s);
    if (!prev || PAY_RANK[cls] > PAY_RANK[prev]) out.set(s, cls);
  };
  const db = demoMode() ? null : getSupabaseAdmin();
  if (!db) {
    for (const x of demoPayments()) if (x.phone === p && x.item_type === "webinar") add(x.item_slug, x.status);
    return out;
  }
  const { data } = await db.from("payments").select("item_slug,status").eq("phone", p).eq("item_type", "webinar");
  for (const r of (data as { item_slug: string | null; status: string | null }[]) ?? []) add(r.item_slug, r.status);
  return out;
}

/** Latest webinar payment outcome per PHONE for a single webinar slug (admin list). */
export async function getWebinarPaymentStatusesForSlug(slug: string): Promise<Map<string, WebinarPayClass>> {
  const s = (slug || "").trim();
  const out = new Map<string, WebinarPayClass>();
  if (!s) return out;
  const add = (phone: string | null | undefined, status: string | null | undefined) => {
    const ph = (phone || "").trim();
    if (!ph) return;
    const cls = webinarPayClass(status);
    const prev = out.get(ph);
    if (!prev || PAY_RANK[cls] > PAY_RANK[prev]) out.set(ph, cls);
  };
  const db = demoMode() ? null : getSupabaseAdmin();
  if (!db) {
    for (const x of demoPayments()) if (x.item_type === "webinar" && x.item_slug === s) add(x.phone, x.status);
    return out;
  }
  const { data } = await db.from("payments").select("phone,status").eq("item_type", "webinar").eq("item_slug", s);
  for (const r of (data as { phone: string | null; status: string | null }[]) ?? []) add(r.phone, r.status);
  return out;
}

/** Registrations for a single webinar (admin registrant list). Newest first. */
export async function getWebinarRegistrationsByWebinar(webinarId: string): Promise<WebinarRegistration[]> {
  if (demoMode()) return [];
  const db = getSupabaseAdmin();
  if (!db) return [];
  try {
    const { data } = await db
      .from("webinar_registrations")
      .select("*")
      .eq("webinar_id", webinarId)
      .order("created_at", { ascending: false });
    return (data as WebinarRegistration[]) ?? [];
  } catch {
    return [];
  }
}

function demoBuyers(): Buyer[] {
  const g = globalThis as unknown as { __namanDemoBuyers?: Buyer[] };
  if (!g.__namanDemoBuyers) g.__namanDemoBuyers = [];
  return g.__namanDemoBuyers;
}

async function loginCodeExists(code: string): Promise<boolean> {
  if (demoMode()) return demoBuyers().some((b) => b.login_code === code);
  const db = getSupabaseAdmin();
  if (!db) return demoBuyers().some((b) => b.login_code === code);
  const { data } = await db.from("buyers").select("id").eq("login_code", code).maybeSingle();
  return !!data;
}

async function uniqueLoginCode(): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const code = generateLoginCode(7);
    if (!(await loginCodeExists(code))) return code;
  }
  // Extremely unlikely fallback: longer code.
  return generateLoginCode(9);
}

export async function getBuyers(): Promise<Buyer[]> {
  if (demoMode()) return [...demoBuyers()];
  const db = getSupabaseAdmin();
  if (!db) return [...demoBuyers()];
  const { data } = await db.from("buyers").select("*").order("created_at", { ascending: false });
  return (data as Buyer[]) ?? [];
}

export async function getBuyerByPhone(phone: string): Promise<Buyer | null> {
  const p = (phone || "").trim();
  if (!p) return null;
  if (demoMode()) return demoBuyers().find((b) => b.phone === p) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return demoBuyers().find((b) => b.phone === p) ?? null;
  const { data } = await db.from("buyers").select("*").eq("phone", p).maybeSingle();
  return (data as Buyer) ?? null;
}

/**
 * Create the buyer for this phone if it doesn't exist yet (idempotent), assigning
 * a unique login code. Called whenever a payment becomes PAID. One phone → one
 * login code → access to all that phone's purchases.
 */
export async function ensureBuyer(phone: string, name?: string | null): Promise<Buyer | null> {
  const p = (phone || "").trim();
  if (!p) return null;
  const buyer = await ensureBuyerRow(p, name);
  if (buyer) {
    // Conversion: a former quiz LEAD with a confirmed PAID purchase is no longer a
    // lead — drop the marker AND bump their session version so every device that
    // was logged in as a lead re-authenticates and sees their new paid access.
    // (Gated on an actual paid purchase so a FREE webinar registration, which also
    // routes through ensureBuyer, never mis-clears the lead marker.)
    if (buyer.is_lead) {
      const paid = await getBuyerPurchases(p);
      if (paid.length > 0) {
        await markBuyerLead(buyer.id, false);
        buyer.is_lead = false;
        await bumpBuyerSessionVersion(p);
      }
    }
    // UNIFIED IDENTITY: every paying/registered person is also a first-class student
    // so they ALWAYS surface in Students & Enrollments. Idempotent (keyed by phone),
    // and the student carries the SAME login code as access code (one code per person).
    await ensureStudentForCustomer(p, name, buyer.login_code).catch(() => null);
  }
  return buyer;
}

/**
 * Idempotent backfill: every phone that has a payment or course enrollment but no
 * buyer row gets one (with a login code) so they can log into the portal — e.g.
 * pending/verifying students who booked a seat before login codes were issued at
 * initiation. Never creates duplicates (ensureBuyer is keyed by phone). Returns
 * how many buyers were created. Read-only on phones that already have a buyer.
 */
export async function backfillMissingBuyers(): Promise<{ scanned: number; created: number }> {
  const db = getSupabaseAdmin();
  if (!db) return { scanned: 0, created: 0 };

  const namesByPhone = new Map<string, string | null>();
  const addRows = (rows: { phone?: string | null; student_name?: string | null; name?: string | null }[] | null) => {
    for (const r of rows ?? []) {
      const p = (r.phone || "").trim();
      if (!p) continue;
      if (!namesByPhone.has(p) || !namesByPhone.get(p)) {
        namesByPhone.set(p, (r.student_name || r.name || null));
      }
    }
  };
  const [{ data: pays }, { data: enrs }] = await Promise.all([
    db.from("payments").select("phone,student_name"),
    db.from("course_enrollments").select("phone,student_name"),
  ]);
  addRows(pays as { phone?: string | null; student_name?: string | null }[] | null);
  addRows(enrs as { phone?: string | null; student_name?: string | null }[] | null);

  const phones = [...namesByPhone.keys()];
  let created = 0;
  for (const p of phones) {
    const existing = await getBuyerByPhone(p);
    if (existing) continue;
    const b = await ensureBuyer(p, namesByPhone.get(p) ?? null).catch(() => null);
    if (b) created += 1;
  }
  return { scanned: phones.length, created };
}

/**
 * Current session/access version for a buyer. Returns null when it can't be
 * determined (no DB / not found) so callers can FAIL-OPEN — we never mass-logout
 * users because of an infra hiccup.
 */
// Short-TTL in-memory cache for the session-version check. getBuyerSession() runs
// on EVERY authenticated render, so without this each render would hit the DB just
// to read one integer. Trade-off (accepted): after a real access change on one
// serverless instance, OTHER instances may serve the previous version for up to
// SV_TTL_MS before re-reading — so a forced re-auth can lag by a few seconds
// cross-instance. bumpBuyerSessionVersion() refreshes the cache on the LOCAL
// instance immediately. Fail-open semantics (null = "couldn't read") are preserved.
const SV_TTL_MS = 15000;
const _svCache = new Map<string, { v: number | null; exp: number }>();

async function readBuyerSessionVersion(id: string): Promise<number | null> {
  if (demoMode()) {
    const b = demoBuyers().find((x) => x.id === id);
    return b ? (b.session_version ?? 0) : null;
  }
  const db = getSupabaseAdmin();
  if (!db) return null;
  try {
    const { data, error } = await db.from("buyers").select("session_version").eq("id", id).maybeSingle();
    if (error || !data) return null;
    return (data as { session_version: number | null }).session_version ?? 0;
  } catch {
    return null;
  }
}

export async function getBuyerSessionVersion(buyerId: string): Promise<number | null> {
  const id = (buyerId || "").trim();
  if (!id) return null;
  const now = Date.now();
  const hit = _svCache.get(id);
  if (hit && hit.exp > now) return hit.v;
  const v = await readBuyerSessionVersion(id);
  _svCache.set(id, { v, exp: now + SV_TTL_MS });
  return v;
}

/**
 * Bump a buyer's session/access version — TARGETED cross-device invalidation.
 * Call ONLY on a real access/role change (lead->paid, admin payment accept, staff
 * access change, login-code regen). Every existing session token for this phone
 * then mismatches and is forced to re-authenticate; no other user is affected.
 */
export async function bumpBuyerSessionVersion(phone: string): Promise<void> {
  const p = (phone || "").trim();
  if (!p) return;
  if (demoMode()) {
    const b = demoBuyers().find((x) => x.phone === p);
    if (b) { b.session_version = (b.session_version ?? 0) + 1; _svCache.set(b.id, { v: b.session_version, exp: Date.now() + SV_TTL_MS }); }
    return;
  }
  const db = getSupabaseAdmin();
  if (!db) {
    const b = demoBuyers().find((x) => x.phone === p);
    if (b) { b.session_version = (b.session_version ?? 0) + 1; _svCache.set(b.id, { v: b.session_version, exp: Date.now() + SV_TTL_MS }); }
    return;
  }
  try {
    const { data } = await db.from("buyers").select("id,session_version").eq("phone", p).maybeSingle();
    if (!data) return;
    const row = data as { id: string; session_version: number | null };
    const next = (row.session_version ?? 0) + 1;
    await db.from("buyers").update({ session_version: next, updated_at: new Date().toISOString() }).eq("id", row.id);
    // Reflect the new version on THIS instance immediately so the short-TTL cache
    // can't serve the stale (still-valid) version right after a real access change.
    _svCache.set(row.id, { v: next, exp: Date.now() + SV_TTL_MS });
  } catch {
    /* best-effort — never throw on housekeeping */
  }
}

/**
 * Current status of an admin account, for per-request session re-validation.
 * Returns:
 *   • "active" / "disabled" / other → the live DB status
 *   • "missing" → the row no longer exists (deny)
 *   • null → couldn't determine (no DB / error) → callers FAIL-OPEN so an infra
 *     hiccup never locks every admin out at once.
 */
export async function getAdminStatus(id: string): Promise<string | null> {
  const a = (id || "").trim();
  if (!a) return null;
  if (demoMode()) return "active";
  const db = getSupabaseAdmin();
  if (!db) return null;
  try {
    const { data, error } = await db.from("admin_users").select("status").eq("id", a).maybeSingle();
    if (error) return null;
    if (!data) return "missing";
    return (data as { status: string | null }).status || "active";
  } catch {
    return null;
  }
}

/** Bump the portal session of the buyer linked to a staff member's phone (if any). */
export async function bumpStaffPortalSession(adminId: string): Promise<void> {
  try {
    const accounts = await getAdminAccounts();
    const acc = accounts.find((a) => a.id === adminId);
    if (acc?.phone) await bumpBuyerSessionVersion(acc.phone);
  } catch {
    /* best-effort */
  }
}

/** Best-effort toggle of the lead marker. No-op if the `is_lead` column isn't present yet. */
async function markBuyerLead(id: string, value: boolean): Promise<void> {
  if (demoMode()) {
    const b = demoBuyers().find((x) => x.id === id);
    if (b) b.is_lead = value;
    return;
  }
  const db = getSupabaseAdmin();
  if (!db) {
    const b = demoBuyers().find((x) => x.id === id);
    if (b) b.is_lead = value;
    return;
  }
  try {
    await db.from("buyers").update({ is_lead: value, updated_at: new Date().toISOString() }).eq("id", id);
  } catch { /* column may not exist yet — best-effort, never fatal */ }
}

/**
 * Create-or-reuse a non-paying LEAD account for a quiz-taker's phone so they can
 * log back in (phone + login code) to retake quizzes and see results. Reuses the
 * SAME buyer/login-code primitive as paying users — deduped by phone:
 *   • existing buyer (paid OR prior lead) → returned AS-IS (code never regenerated,
 *     a real buyer's flags are never altered)
 *   • new phone → fresh buyer + unique login code, marked is_lead.
 * Deliberately does NOT create a student row — that happens lazily on first login
 * (so the Students table isn't polluted by leads who never return). Idempotent.
 * Carries ZERO entitlements: the central access gate default-denies all paid content.
 */
export async function ensureLeadBuyer(phone: string, name?: string | null): Promise<Buyer | null> {
  const n = normalizeIndianMobile(phone);
  if (!n.ok || !n.digits10) return null;
  const p = n.digits10;
  const existing = await getBuyerByPhone(p);
  if (existing) return existing;
  const created = await ensureBuyerRow(p, name);
  if (created) { await markBuyerLead(created.id, true); created.is_lead = true; }
  return created;
}

/**
 * All non-paying LEAD accounts (is_lead = true) for admin visibility. These are
 * quiz/marketing leads with a portal login code; they carry zero entitlements and
 * never appear in seats/finance (those derive from payments/enrolments). A lead
 * that converts to paid is dropped from this list automatically (flag cleared).
 */
export async function getLeadBuyers(): Promise<Buyer[]> {
  if (demoMode()) return demoBuyers().filter((b) => b.is_lead);
  const db = getSupabaseAdmin();
  if (!db) return [];
  try {
    const { data } = await db.from("buyers").select("*").eq("is_lead", true).order("created_at", { ascending: false });
    return (data as Buyer[]) ?? [];
  } catch {
    return [];
  }
}

async function ensureBuyerRow(p: string, name?: string | null): Promise<Buyer | null> {
  const existing = await getBuyerByPhone(p);
  if (existing) return existing;

  const code = await uniqueLoginCode();
  const now = new Date().toISOString();
  const row: Buyer = { id: uuid(), phone: p, name: name?.trim() || null, login_code: code, created_at: now, updated_at: now };

  if (demoMode()) {
    demoBuyers().unshift(row);
    return row;
  }
  const db = getSupabaseAdmin();
  if (!db) {
    demoBuyers().unshift(row);
    return row;
  }
  try {
    // Upsert on phone to be safe against races; ignore conflict and re-read.
    const { data, error } = await db
      .from("buyers")
      .insert({ phone: p, name: row.name, login_code: code })
      .select()
      .single();
    if (error) {
      // Likely a unique-phone race — return the now-existing row.
      return (await getBuyerByPhone(p)) ?? null;
    }
    return data as Buyer;
  } catch {
    return (await getBuyerByPhone(p)) ?? null;
  }
}

/**
 * Provision a USER-PORTAL account for a STAFF member's phone so they can log in
 * and test the real student view. Deliberately a BUYER-ONLY row (no student,
 * payment, enrollment or registration rows are ever created) — that keeps staff
 * test logins out of revenue, seat counts and "real student" analytics entirely.
 * Idempotent: links to an existing buyer if the phone already has one (and never
 * downgrades a real buyer to a staff flag). Returns the buyer with its login code.
 */
export async function ensureStaffPortalAccount(phone: string, name?: string | null): Promise<Buyer | null> {
  const n = normalizeIndianMobile(phone);
  if (!n.ok || !n.digits10) return null;
  const p = n.digits10;

  const existing = await getBuyerByPhone(p);
  if (existing) return existing; // link — do not flip a real buyer's is_staff flag

  const code = await uniqueLoginCode();
  const now = new Date().toISOString();
  const row: Buyer = { id: uuid(), phone: p, name: name?.trim() || null, login_code: code, is_staff: true, created_at: now, updated_at: now };

  if (demoMode()) { demoBuyers().unshift(row); return row; }
  const db = getSupabaseAdmin();
  if (!db) { demoBuyers().unshift(row); return row; }
  try {
    const { data, error } = await db
      .from("buyers")
      .insert({ phone: p, name: row.name, login_code: code, is_staff: true })
      .select()
      .single();
    if (error) return (await getBuyerByPhone(p)) ?? null; // unique-phone race
    return data as Buyer;
  } catch {
    return (await getBuyerByPhone(p)) ?? null;
  }
}

/** Issue a fresh login code for a phone's portal account (creates a staff account if missing). */
export async function regenerateStaffPortalCode(phone: string, name?: string | null): Promise<Buyer | null> {
  const n = normalizeIndianMobile(phone);
  if (!n.ok || !n.digits10) return null;
  const p = n.digits10;
  await ensureStaffPortalAccount(p, name);
  const code = await uniqueLoginCode();
  const updatedAt = new Date().toISOString();
  if (demoMode()) {
    const b = demoBuyers().find((x) => x.phone === p);
    if (b) { b.login_code = code; b.updated_at = updatedAt; }
    return b ?? null;
  }
  const db = getSupabaseAdmin();
  if (!db) {
    const b = demoBuyers().find((x) => x.phone === p);
    if (b) { b.login_code = code; b.updated_at = updatedAt; }
    return b ?? null;
  }
  const { data } = await db.from("buyers").update({ login_code: code, updated_at: updatedAt }).eq("phone", p).select().maybeSingle();
  // A new code invalidates the old one — bump so any device on the old session re-auths.
  await bumpBuyerSessionVersion(p);
  return (data as Buyer) ?? (await getBuyerByPhone(p));
}

/**
 * Ensure the staff member (by admin id) has a portal test login IF they have a
 * phone set. Called after comp access is granted so the account is ready to use.
 * No-op (returns null) when the staff member has no phone. Idempotent.
 */
export async function provisionStaffPortalAccount(adminId: string): Promise<Buyer | null> {
  const admin = await getAdminAccountById(adminId);
  if (!admin?.phone) return null;
  return ensureStaffPortalAccount(admin.phone, admin.name);
}

/**
 * Ensure a master {@link Student} record exists for a paying/registered person.
 * Idempotent by phone — a person with many purchases stays ONE student row.
 * Course/webinar customers carry `plan = null` (no LMS subscription) and reuse
 * their buyer login code as the access code, so there is exactly one credential
 * per person. Returns the existing or newly-created student.
 */
export async function ensureStudentForCustomer(
  phone: string,
  name?: string | null,
  accessCode?: string | null,
  createdAt?: string | null
): Promise<Student | null> {
  const p = (phone || "").trim();
  if (!p) return null;

  // Existence check (tolerant of legacy duplicate phones — take the first).
  const findExisting = async (): Promise<Student | null> => {
    if (demoMode()) return mock.students.find((s) => s.phone === p) ?? null;
    const db = getSupabaseAdmin();
    if (!db) return mock.students.find((s) => s.phone === p) ?? null;
    const { data } = await db.from("students").select("*").eq("phone", p).limit(1);
    return ((data as Student[]) ?? [])[0] ?? null;
  };

  const existing = await findExisting();
  if (existing) return existing;

  let code = (accessCode || "").trim().toUpperCase();
  if (!code) {
    const buyer = await getBuyerByPhone(p);
    code = (buyer?.login_code || generateAccessCode(name || "Student")).toUpperCase();
  }
  const now = createdAt || new Date().toISOString();
  const row: Student = {
    id: uuid(),
    name: (name || "").trim() || "Student",
    phone: p,
    email: null,
    plan: null, // course/webinar customer — no LMS subscription
    months: null,
    access_code: code,
    start_date: now,
    expiry_date: null, // course access is governed by enrollments, not an LMS expiry
    amount_paid: null, // revenue is tracked in the payments ledger, never double-counted here
    razorpay_payment_id: null,
    razorpay_order_id: null,
    target_year: null,
    optional_subject: null,
    notes: null,
    streak_count: 0,
    last_active_date: null,
    is_active: true,
    created_at: now,
  };

  if (demoMode()) {
    mock.students.unshift(row);
    return row;
  }
  const db = getSupabaseAdmin();
  if (!db) {
    mock.students.unshift(row);
    return row;
  }
  try {
    const { data, error } = await db.from("students").insert(row).select().single();
    if (error) {
      // Unique-phone race, or an access_code collision: re-read by phone first.
      const again = await findExisting();
      if (again) return again;
      // Access-code collision (extremely unlikely): retry once with a fresh code.
      const retry = { ...row, id: uuid(), access_code: generateAccessCode(name || "Student").toUpperCase() };
      const { data: d2 } = await db.from("students").insert(retry).select().single();
      return (d2 as Student) ?? (await findExisting());
    }
    return data as Student;
  } catch {
    return (await findExisting()) ?? null;
  }
}

export async function findBuyerByLogin(phone: string, code: string): Promise<Buyer | null> {
  const buyer = await getBuyerByPhone(phone);
  if (!buyer) return null;
  return buyer.login_code.toUpperCase() === code.toUpperCase() ? buyer : null;
}

/** All paid purchases for a phone (the buyer's entitlements). */
export async function getBuyerPurchases(phone: string): Promise<Payment[]> {
  const p = (phone || "").trim();
  if (!p) return [];
  if (demoMode()) {
    return demoPayments().filter((x) => x.phone === p && isPaidStatus(x.status));
  }
  const db = getSupabaseAdmin();
  if (!db) return demoPayments().filter((x) => x.phone === p && isPaidStatus(x.status));
  const { data } = await db
    .from("payments")
    .select("*")
    .eq("phone", p)
    .in("status", ["PAID", "captured"])
    .order("created_at", { ascending: false });
  return (data as Payment[]) ?? [];
}

/** A single paid purchase by reference, scoped to a phone (server-side entitlement check). */
export async function getPaidPurchaseForPhone(referenceNo: string, phone: string): Promise<Payment | null> {
  const payment = await getPaymentByReference(referenceNo);
  if (!payment) return null;
  if (!isPaidStatus(payment.status)) return null;
  if ((payment.phone || "").trim() !== (phone || "").trim()) return null;
  return payment;
}

// ==================== COURSE ENROLLMENTS + EMI + RECEIPTS (Phase 2) ====================

function demoEnrollments(): CourseEnrollment[] {
  const g = globalThis as unknown as { __namanCourseEnrollments?: CourseEnrollment[] };
  if (!g.__namanCourseEnrollments) g.__namanCourseEnrollments = [];
  return g.__namanCourseEnrollments;
}
function demoReceipts(): PaymentReceipt[] {
  const g = globalThis as unknown as { __namanReceipts?: PaymentReceipt[] };
  if (!g.__namanReceipts) g.__namanReceipts = [];
  return g.__namanReceipts;
}

export async function addCourseEnrollment(input: Omit<CourseEnrollment, "id" | "created_at" | "updated_at"> & { id?: string }): Promise<CourseEnrollment> {
  const now = new Date().toISOString();
  const row: CourseEnrollment = { ...input, id: input.id ?? uuid(), created_at: now, updated_at: now } as CourseEnrollment;
  if (demoMode()) { demoEnrollments().unshift(row); return row; }
  try {
    return await dbInsert<CourseEnrollment>("course_enrollments", row as unknown as Record<string, unknown>);
  } catch {
    demoEnrollments().unshift(row);
    return row;
  }
}

export async function getCourseEnrollmentById(id: string): Promise<CourseEnrollment | null> {
  if (demoMode()) return demoEnrollments().find((e) => e.id === id) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return demoEnrollments().find((e) => e.id === id) ?? null;
  const { data } = await db.from("course_enrollments").select("*").eq("id", id).maybeSingle();
  return (data as CourseEnrollment) ?? demoEnrollments().find((e) => e.id === id) ?? null;
}

export async function getCourseEnrollmentsByPhone(phone: string): Promise<CourseEnrollment[]> {
  const p = (phone || "").trim();
  if (!p) return [];
  if (demoMode()) return demoEnrollments().filter((e) => e.phone === p);
  const db = getSupabaseAdmin();
  if (!db) return demoEnrollments().filter((e) => e.phone === p);
  const { data } = await db.from("course_enrollments").select("*").eq("phone", p).order("created_at", { ascending: false });
  return (data as CourseEnrollment[]) ?? [];
}

export async function getAllCourseEnrollments(): Promise<CourseEnrollment[]> {
  if (demoMode()) return [...demoEnrollments()];
  const db = getSupabaseAdmin();
  if (!db) return [...demoEnrollments()];
  const { data } = await db.from("course_enrollments").select("*").order("created_at", { ascending: false });
  return (data as CourseEnrollment[]) ?? [];
}

export async function updateCourseEnrollment(id: string, patch: Partial<CourseEnrollment>): Promise<CourseEnrollment | null> {
  const next = { ...patch, updated_at: new Date().toISOString() };
  if (demoMode()) {
    const list = demoEnrollments();
    const idx = list.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...next };
    return list[idx];
  }
  return dbUpdate<CourseEnrollment>("course_enrollments", id, next as Record<string, unknown>);
}

/** Course ids the phone has actively paid for (seat or full) — drives Class Hub access. */
export async function paidCourseIdsForPhone(phone: string): Promise<string[]> {
  const [list, staffCourseIds] = await Promise.all([
    getCourseEnrollmentsByPhone(phone),
    getActiveStaffCourseIdsByPhone(phone),
  ]);
  // amount_paid > 0 covers paid seats/installments/full; status "fully_paid"
  // additionally unlocks complimentary (₹0) enrollments granted by an admin.
  const ids = new Set(
    list
      .filter((e) => (e.amount_paid > 0 || e.status === "fully_paid") && e.status !== "cancelled")
      .map((e) => e.course_id),
  );
  // Staff comp access: internal-only, never a purchase — unlocks the Class Hub the
  // same way without any payment/enrollment row.
  for (const id of staffCourseIds) ids.add(id);
  return [...ids];
}

async function nextReceiptNo(): Promise<string> {
  const db = getSupabaseAdmin();
  if (db) {
    try {
      const { data, error } = await db.rpc("next_receipt_no");
      if (!error && typeof data === "string" && data) return data;
    } catch { /* fall through */ }
  }
  // Demo / fallback: timestamp-based, still unique & traceable.
  return `NSA/DEMO/${Date.now().toString(36).toUpperCase()}`;
}

export async function getReceiptByNo(receiptNo: string): Promise<PaymentReceipt | null> {
  if (demoMode()) return demoReceipts().find((r) => r.receipt_no === receiptNo) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return demoReceipts().find((r) => r.receipt_no === receiptNo) ?? null;
  const { data } = await db.from("payment_receipts").select("*").eq("receipt_no", receiptNo).maybeSingle();
  return (data as PaymentReceipt) ?? null;
}

export async function getReceiptByReference(referenceNo: string): Promise<PaymentReceipt | null> {
  if (!referenceNo) return null;
  if (demoMode()) return demoReceipts().find((r) => r.reference_no === referenceNo) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return demoReceipts().find((r) => r.reference_no === referenceNo) ?? null;
  const { data } = await db.from("payment_receipts").select("*").eq("reference_no", referenceNo).maybeSingle();
  return (data as PaymentReceipt) ?? null;
}

export async function getReceiptsByPhone(phone: string): Promise<PaymentReceipt[]> {
  const p = (phone || "").trim();
  if (!p) return [];
  if (demoMode()) return demoReceipts().filter((r) => r.phone === p);
  const db = getSupabaseAdmin();
  if (!db) return demoReceipts().filter((r) => r.phone === p);
  const { data } = await db.from("payment_receipts").select("*").eq("phone", p).order("issued_at", { ascending: false });
  return (data as PaymentReceipt[]) ?? [];
}

async function insertReceipt(row: PaymentReceipt): Promise<PaymentReceipt> {
  if (demoMode()) { demoReceipts().unshift(row); return row; }
  try {
    return await dbInsert<PaymentReceipt>("payment_receipts", row as unknown as Record<string, unknown>);
  } catch {
    demoReceipts().unshift(row);
    return row;
  }
}

/**
 * Idempotently apply a PAID course EMI/seat payment to its enrollment:
 * marks the schedule item(s) paid, recomputes status + amount_paid, and issues
 * an immutable receipt (one per payment reference). Safe to call multiple times
 * (callback + status poll). Returns null for non-EMI / one-time payments so the
 * existing one-time flow is untouched.
 */
export async function finalizeCoursePaymentByReference(
  referenceNo: string
): Promise<{ enrollment: CourseEnrollment; receipt: PaymentReceipt } | null> {
  const payment = await getPaymentByReference(referenceNo);
  if (!payment || !isPaidStatus(payment.status)) return null;
  if (!payment.enrollment_id) return null; // one-time payment — leave untouched

  const enrollment = await getCourseEnrollmentById(payment.enrollment_id);
  if (!enrollment) return null;

  // Idempotency: a receipt already exists for this reference => already finalized.
  const existing = await getReceiptByReference(referenceNo);
  if (existing) {
    return { enrollment, receipt: existing };
  }

  const kind = (payment.payment_kind || "full") as "seat" | "installment" | "full";
  const gatewayRef = payment.gateway_ref || payment.razorpay_payment_id || null;
  const paidAt = new Date().toISOString();
  const schedule = [...(enrollment.schedule || [])];

  const markPaid = (i: number) => {
    schedule[i] = { ...schedule[i], paid: true, paid_at: paidAt, reference_no: referenceNo, gateway_ref: gatewayRef };
  };

  let paymentLabel = "Payment";
  if (kind === "full") {
    // Pay full / pay remaining: settle every outstanding line in one payment.
    schedule.forEach((s, i) => { if (!s.paid) markPaid(i); });
    paymentLabel = enrollment.plan_type === "full" ? "Full Payment" : "Full Remaining Payment";
  } else {
    const idx = schedule.findIndex((s) => s.no === (payment.installment_no ?? (kind === "seat" ? 0 : -1)) && !s.paid);
    const fallbackIdx = idx === -1 ? schedule.findIndex((s) => s.kind === kind && !s.paid) : idx;
    if (fallbackIdx >= 0) {
      markPaid(fallbackIdx);
      paymentLabel = schedule[fallbackIdx].label;
    }
  }

  const derived = deriveEnrollment({ total_fee: enrollment.total_fee, schedule });
  const status = enrollmentStatusFromSchedule({ total_fee: enrollment.total_fee, schedule, plan_type: enrollment.plan_type });

  const updated = (await updateCourseEnrollment(enrollment.id, {
    schedule,
    amount_paid: derived.paid,
    status,
  })) || { ...enrollment, schedule, amount_paid: derived.paid, status };

  // Build the immutable receipt from the ledger-consistent derived values.
  const summary = installmentsSummary({ total_fee: updated.total_fee, schedule }, formatINR, formatISTDate);
  const statusLabel: PaymentReceipt["status"] =
    derived.isFullyPaid ? "Fully Paid" : status === "seat_booked" ? "Seat Booked" : "Partially Paid";

  const receipt: PaymentReceipt = {
    id: uuid(),
    receipt_no: await nextReceiptNo(),
    enrollment_id: enrollment.id,
    payment_id: payment.id,
    reference_no: referenceNo,
    phone: enrollment.phone,
    student_name: enrollment.student_name,
    email: enrollment.email,
    course_title: enrollment.course_title,
    batch_label: enrollment.batch_label,
    payment_kind: kind,
    payment_label: paymentLabel,
    amount: payment.amount,
    gateway_ref: gatewayRef,
    total_fee: updated.total_fee,
    paid_to_date: derived.paid,
    remaining: derived.remaining,
    installments_summary: summary,
    status: statusLabel,
    method: payment.payment_mode || payment.mode || null,
    issued_at: paidAt,
  };
  const saved = await insertReceipt(receipt);
  await updatePaymentByReference(referenceNo, { receipt_no: saved.receipt_no }).catch(() => null);

  // Optional, best-effort receipt email (no-op without RESEND_API_KEY).
  if (saved.email) {
    import("./email")
      .then(({ sendReceiptEmail }) =>
        sendReceiptEmail({
          to: saved.email!,
          name: saved.student_name,
          receiptNo: saved.receipt_no,
          courseTitle: saved.course_title,
          paymentLabel: saved.payment_label,
          amount: formatINR(saved.amount),
          paidToDate: formatINR(saved.paid_to_date),
          remaining: saved.remaining <= 0 ? "₹0 — Fully paid" : formatINR(saved.remaining),
          installmentsSummary: saved.installments_summary,
          status: saved.status,
        })
      )
      .catch(() => null);
  }

  return { enrollment: updated, receipt: saved };
}

// ==================== ADMIN: MANUAL ENROLL + OFFLINE/CASH PAYMENTS ====================
// These reuse the EXACT same enrollment schedule + finalize + receipt logic the
// online flow uses, so a manually-added student is indistinguishable from a
// self-registered one (same ledger, EMI math, receipts, Class Hub access).

/** A short, unique, human-traceable reference for offline (cash/bank) payments. */
async function uniqueOfflineRef(): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const ref = `OFF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    if (!(await getPaymentByReference(ref))) return ref;
  }
  return `OFF-${Date.now().toString(36).toUpperCase()}-${uuid().slice(0, 4).toUpperCase()}`;
}

export interface EnrollStudentInCourseInput {
  phone: string;
  name: string;
  email?: string | null;
  courseSlug: string;
  /** "full" | "emi" | "complimentary" */
  plan: "full" | "emi" | "complimentary";
  bookSeat?: boolean;
  seatAmount?: number | null;
  installmentCount?: number | null;
}

/**
 * Create a course enrollment for a student exactly like the public checkout does
 * (same schedule), but WITHOUT a gateway redirect. Complimentary = free, fully
 * unlocked at ₹0. Always ensures the buyer/login-code exists so the student can
 * reach the portal + Class Hub immediately.
 */
export async function enrollStudentInCourse(
  input: EnrollStudentInCourseInput
): Promise<{ ok: true; enrollment: CourseEnrollment } | { ok: false; error: string }> {
  const phone = (input.phone || "").trim();
  if (!/^\d{10}$/.test(phone)) return { ok: false, error: "Valid 10-digit phone required." };
  const course = await getCourseBySlug(input.courseSlug);
  if (!course) return { ok: false, error: "Course not found." };

  // Don't double-enroll the same phone into the same course. Only a REAL active
  // enrollment (confirmed payment / comp grant) blocks; a stale PENDING attempt
  // does NOT — instead we REUSE that one booking intent so manually enrolling a
  // student who has abandoned attempts activates a single enrollment with no
  // duplicate card (test case D).
  const courseEnrollments = (await getCourseEnrollmentsByPhone(phone)).filter(
    (e) => e.course_id === course.id && e.status !== "cancelled",
  );
  const activeExisting = courseEnrollments.find(isActiveEnrollment);
  if (activeExisting) return { ok: false, error: `Already enrolled in ${course.title}.` };
  const attemptToReuse = courseEnrollments.find(isAttemptEnrollment) || null;

  const now = new Date().toISOString();

  if (input.plan === "complimentary") {
    if (attemptToReuse) {
      // Convert the abandoned attempt into the single comp enrollment.
      const enrollment = await updateCourseEnrollment(attemptToReuse.id, {
        plan_type: "full",
        total_fee: 0,
        amount_paid: 0,
        installment_count: 0,
        status: "fully_paid",
        schedule: [{ no: 0, kind: "full", label: "Complimentary access", amount: 0, due: null, paid: true, paid_at: now }],
      });
      await ensureBuyer(phone, input.name).catch(() => null);
      return { ok: true, enrollment: enrollment || attemptToReuse };
    }
    const enrollment = await addCourseEnrollment({
      phone,
      student_name: input.name,
      email: input.email || null,
      course_id: course.id,
      course_slug: course.slug,
      course_title: course.title,
      batch_label: null,
      plan_type: "full",
      total_fee: 0,
      amount_paid: 0,
      installment_count: 0,
      status: "fully_paid",
      schedule: [{ no: 0, kind: "full", label: "Complimentary access", amount: 0, due: null, paid: true, paid_at: now }],
    });
    await ensureBuyer(phone, input.name).catch(() => null);
    return { ok: true, enrollment };
  }

  const planned = planCourseEnrollment({
    course,
    plan: input.plan,
    bookSeat: !!input.bookSeat,
    seatAmount: input.seatAmount ?? null,
    installmentCount: input.installmentCount ?? null,
  });
  if (!planned.ok) return { ok: false, error: planned.error };

  if (attemptToReuse) {
    // Re-plan the abandoned attempt to the new selection (no duplicate row). It
    // stays an attempt (₹0) until a payment is recorded, which activates it.
    const enrollment = await updateCourseEnrollment(attemptToReuse.id, {
      batch_label: planned.plan.batchLabel,
      plan_type: planned.plan.planType,
      total_fee: planned.plan.totalFee,
      amount_paid: 0,
      installment_count: planned.plan.installmentCount,
      status: "pending",
      schedule: planned.plan.schedule,
    });
    await ensureBuyer(phone, input.name).catch(() => null);
    return { ok: true, enrollment: enrollment || attemptToReuse };
  }

  const enrollment = await addCourseEnrollment({
    phone,
    student_name: input.name,
    email: input.email || null,
    course_id: course.id,
    course_slug: course.slug,
    course_title: course.title,
    batch_label: planned.plan.batchLabel,
    plan_type: planned.plan.planType,
    total_fee: planned.plan.totalFee,
    amount_paid: 0,
    installment_count: planned.plan.installmentCount,
    status: "pending",
    schedule: planned.plan.schedule,
  });
  await ensureBuyer(phone, input.name).catch(() => null);
  return { ok: true, enrollment };
}

export interface OfflineCoursePaymentInput {
  enrollmentId: string;
  /** Which schedule line to settle. "full" pays the entire remaining balance. */
  kind: "seat" | "installment" | "full";
  /** Required for kind="installment" when a specific installment is targeted. */
  installmentNo?: number | null;
  method: string;
  /** IST-correct ISO instant of the payment (defaults to now). */
  dateISO?: string;
  note?: string | null;
}

/**
 * Record a cash/offline payment against an enrollment. Creates a PAID payment in
 * the SAME ledger, then runs the SAME finalize routine (advances the schedule,
 * recomputes paid/total/status, issues the branded receipt). Amounts are taken
 * from the schedule (or exact remaining for "full"), so totals always reconcile.
 */
export async function recordOfflineCoursePayment(
  input: OfflineCoursePaymentInput
): Promise<{ ok: true; enrollment: CourseEnrollment; receipt: PaymentReceipt } | { ok: false; error: string }> {
  const enrollment = await getCourseEnrollmentById(input.enrollmentId);
  if (!enrollment) return { ok: false, error: "Enrollment not found." };
  const schedule = enrollment.schedule || [];
  const method = (input.method || "Cash").trim();

  let amount: number;
  let kind = input.kind;
  let installmentNo = 0;
  let label = "";

  if (kind === "full") {
    const remaining = deriveEnrollment(enrollment).remaining;
    if (remaining <= 0) return { ok: false, error: "This enrollment is already fully paid." };
    amount = remaining;
    installmentNo = 0;
  } else if (kind === "seat") {
    const item = schedule.find((s) => s.kind === "seat" && !s.paid);
    if (!item) return { ok: false, error: "No outstanding seat payment." };
    amount = item.amount;
    installmentNo = item.no;
    label = item.label;
  } else {
    const item =
      input.installmentNo != null
        ? schedule.find((s) => s.kind === "installment" && s.no === input.installmentNo && !s.paid)
        : schedule.find((s) => s.kind === "installment" && !s.paid);
    if (!item) return { ok: false, error: "No outstanding installment to record." };
    amount = item.amount;
    installmentNo = item.no;
    label = item.label;
  }

  const ref = await uniqueOfflineRef();
  const dateISO = input.dateISO || new Date().toISOString();
  const itemLabel =
    kind === "full"
      ? `${enrollment.course_title} — Remaining balance`
      : `${enrollment.course_title} — ${label || (kind === "seat" ? "Book Your Seat" : "Installment")}`;

  await createPayment({
    student_name: enrollment.student_name,
    phone: enrollment.phone,
    email: enrollment.email,
    item: itemLabel,
    item_type: "course",
    item_slug: enrollment.course_slug,
    amount,
    status: "PAID",
    gateway: "offline",
    reference_no: ref,
    gateway_ref: input.note ? `${method} · ${input.note}` : method,
    payment_mode: method,
    mode: method,
    transaction_amount: amount,
    transaction_date: dateISO,
    created_at: dateISO,
    razorpay_payment_id: null,
    enrollment_id: enrollment.id,
    payment_kind: kind,
    installment_no: installmentNo,
  });

  const finalized = await finalizeCoursePaymentByReference(ref);
  if (!finalized) return { ok: false, error: "Could not apply the payment." };
  return { ok: true, enrollment: finalized.enrollment, receipt: finalized.receipt };
}

// ==================== ADMIN: PAYMENT-PLAN CONVERSION + INSTALLMENT MANAGEMENT ====================
// Convert an existing enrollment between FULL / EMI / CUSTOM_INSTALLMENTS after
// enrollment, preserving every paid amount and feeding the SAME 15-day access
// rule. The installment "table" is the course_enrollments.schedule JSONB — we
// extend it, never fork it.

const PLAN_DAY_MS = 86_400_000;

function demoPlanLogs(): EnrollmentPlanChangeLog[] {
  const g = globalThis as unknown as { __namanPlanLogs?: EnrollmentPlanChangeLog[] };
  if (!g.__namanPlanLogs) g.__namanPlanLogs = [];
  return g.__namanPlanLogs;
}

/** All payments tied to an enrollment (any status). */
export async function getPaymentsByEnrollmentId(enrollmentId: string): Promise<Payment[]> {
  const id = (enrollmentId || "").trim();
  if (!id) return [];
  if (demoMode()) return demoPayments().filter((p) => p.enrollment_id === id && !p.deleted_at);
  const db = getSupabaseAdmin();
  if (!db) return demoPayments().filter((p) => p.enrollment_id === id && !p.deleted_at);
  const { data } = await db.from("payments").select("*").eq("enrollment_id", id).is("deleted_at", null).order("created_at", { ascending: false });
  return (data as Payment[]) ?? [];
}

/** Every payment row for an enrollment INCLUDING soft-deleted (for comp-detection in recompute). */
export async function getAllPaymentRowsByEnrollmentId(enrollmentId: string): Promise<Payment[]> {
  const id = (enrollmentId || "").trim();
  if (!id) return [];
  if (demoMode()) return demoPayments().filter((p) => p.enrollment_id === id);
  const db = getSupabaseAdmin();
  if (!db) return demoPayments().filter((p) => p.enrollment_id === id);
  const { data } = await db.from("payments").select("*").eq("enrollment_id", id).order("created_at", { ascending: false });
  return (data as Payment[]) ?? [];
}

/** Expire stale PENDING/VERIFYING payment attempts for an enrollment. Never touches PAID. */
export async function cancelStalePendingPayments(enrollmentId: string): Promise<number> {
  const id = (enrollmentId || "").trim();
  if (!id) return 0;
  if (demoMode()) {
    let n = 0;
    for (const p of demoPayments()) {
      if (p.enrollment_id === id && (p.status === "PENDING" || p.status === "VERIFYING")) { p.status = "ABANDONED"; n++; }
    }
    return n;
  }
  const db = getSupabaseAdmin();
  if (!db) return 0;
  try {
    const { data } = await db
      .from("payments")
      .update({ status: "ABANDONED" })
      .eq("enrollment_id", id)
      .in("status", ["PENDING", "VERIFYING"])
      .select("id");
    return (data || []).length;
  } catch { return 0; }
}

// ==================== ENROLLMENT RECOMPUTE (ledger-from-payments, comp-safe) ====================
//
// Rebuilds a course enrollment's schedule paid-flags + amount_paid + status purely
// from its NON-DELETED PAID payment rows. Used by the duplicate-merge tool and by
// payment edit/delete/restore so the ledger always reflects real money.
//
// COMP-SAFE: an enrollment with ZERO payment rows (manual/complimentary grant) is
// left untouched — we never zero out an admin-granted ₹0 enrollment.
// Waived/cancelled schedule lines are preserved (the plan-change tool owns them).

function applyPaidPaymentToSchedule(schedule: InstallmentItem[], payment: Payment): void {
  const kind = (payment.payment_kind || "full") as "one_time" | "seat" | "installment" | "full";
  if (kind === "one_time") return; // not tied to the EMI schedule
  const gatewayRef = payment.gateway_ref || payment.razorpay_payment_id || null;
  const paidAt = payment.transaction_date || payment.created_at || new Date().toISOString();
  const ref = payment.reference_no || null;
  const mark = (i: number) => {
    schedule[i] = { ...schedule[i], paid: true, paid_at: paidAt, reference_no: ref, gateway_ref: gatewayRef, payment_id: payment.id };
  };
  if (kind === "full") {
    schedule.forEach((s, i) => { if (!s.paid && !isLineCancelledOrWaived(s)) mark(i); });
    return;
  }
  const exact = schedule.findIndex((s) => s.no === (payment.installment_no ?? (kind === "seat" ? 0 : -1)) && !s.paid && !isLineCancelledOrWaived(s));
  const idx = exact === -1 ? schedule.findIndex((s) => s.kind === kind && !s.paid && !isLineCancelledOrWaived(s)) : exact;
  if (idx >= 0) mark(idx);
}

/**
 * Recompute a course enrollment from its non-deleted PAID payments. Returns the
 * updated enrollment (or the untouched one for comp/manual enrollments with no
 * payment rows). Idempotent.
 */
export async function recomputeCourseEnrollment(enrollmentId: string): Promise<CourseEnrollment | null> {
  const enr = await getCourseEnrollmentById(enrollmentId);
  if (!enr) return null;
  const all = await getAllPaymentRowsByEnrollmentId(enrollmentId);
  if (all.length === 0) return enr; // comp/manual — nothing payment-driven to recompute
  const paid = all
    .filter((p) => !p.deleted_at && isPaidStatus(p.status))
    .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
  const schedule = (enr.schedule || []).map((s) =>
    isLineCancelledOrWaived(s)
      ? { ...s }
      : { ...s, paid: false, paid_at: null, reference_no: null, gateway_ref: null, payment_id: null },
  );
  for (const p of paid) applyPaidPaymentToSchedule(schedule, p);
  const derived = deriveEnrollment({ total_fee: enr.total_fee, schedule });
  const status = enrollmentStatusFromSchedule({ total_fee: enr.total_fee, schedule, plan_type: enr.plan_type });
  const updated = await updateCourseEnrollment(enrollmentId, { schedule, amount_paid: derived.paid, status });
  if (enr.phone) await bumpBuyerSessionVersion(enr.phone).catch(() => null);
  return updated || { ...enr, schedule, amount_paid: derived.paid, status };
}

// ==================== DUPLICATE-ENROLLMENT DETECTION + MERGE (super-admin) ====================

/** Outstanding for one enrollment (total_fee minus paid lines). */
function enrollmentOutstanding(e: CourseEnrollment): number {
  return deriveEnrollment({ total_fee: e.total_fee, schedule: e.schedule || [] }).remaining;
}

/**
 * On-demand detection of duplicate ACTIVE enrollments (same phone + course).
 * "Active" = not cancelled. Query-based (no cron). Lightweight; capped.
 */
export async function findDuplicateEnrollmentGroups(limitGroups = 200): Promise<DuplicateEnrollmentGroup[]> {
  const all = await getAllCourseEnrollments();
  // Only REAL enrollments (confirmed payment or comp grant) can be "duplicates".
  // Multiple PENDING ₹0 attempts are not duplicates — they're one booking intent
  // and are surfaced as "Pending/Attempted", not flagged here. This keeps the
  // dashboard badge quiet now that attempts no longer count as enrollments.
  const active = all.filter(isActiveEnrollment);
  const byKey = new Map<string, CourseEnrollment[]>();
  for (const e of active) {
    const phone = (e.phone || "").trim();
    if (!phone || !e.course_id) continue;
    const key = `${phone}|${e.course_id}`;
    const arr = byKey.get(key) || byKey.set(key, []).get(key)!;
    arr.push(e);
  }
  const groups: DuplicateEnrollmentGroup[] = [];
  for (const [, arr] of byKey) {
    if (arr.length < 2) continue;
    const sorted = [...arr].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    const paidCount = sorted.filter((e) => (e.amount_paid || 0) > 0).length;
    groups.push({
      phone: sorted[0].phone,
      course_id: sorted[0].course_id,
      course_title: sorted[0].course_title,
      student_name: sorted.find((e) => e.student_name)?.student_name || sorted[0].student_name,
      count: sorted.length,
      hasMultiplePaid: paidCount > 1,
      enrollments: sorted.map((e) => ({
        id: e.id,
        status: e.status,
        total_fee: e.total_fee,
        amount_paid: e.amount_paid || 0,
        created_at: e.created_at,
      })),
    });
  }
  return groups.sort((a, b) => b.count - a.count).slice(0, limitGroups);
}

export interface AttemptBackfillAction {
  phone: string;
  course_id: string;
  course_title: string;
  /** The active enrollment we keep (if any) — null when the whole group is attempts. */
  keptId: string | null;
  /** Attempt/provisional enrollments superseded (status→cancelled, superseded_by). */
  supersededIds: string[];
  /** Open payments on superseded rows marked ABANDONED (never deleted). */
  abandonedPaymentIds: string[];
  reason: string;
}

export interface AttemptBackfillResult {
  ok: boolean;
  dryRun: boolean;
  scannedGroups: number;
  changedGroups: number;
  actions: AttemptBackfillAction[];
}

/**
 * Safe, reversible cleanup of provisional/duplicate course enrollments so that
 * payment ATTEMPTS never count as enrollments. For each phone+course group of
 * non-cancelled enrollments:
 *   • If a REAL active enrollment exists (confirmed payment / comp), keep ONE
 *     (the most-paid, else newest) and supersede every OTHER attempt sibling
 *     (status→cancelled, superseded_by=keptId). Open payments on the superseded
 *     rows are marked ABANDONED (never deleted) so receipts/history survive.
 *   • If the group is ALL attempts (no confirmed payment), keep the NEWEST
 *     attempt as the single "Pending/Attempted" intent and supersede the older
 *     duplicate attempts. Nothing is activated; outstanding stays ₹0.
 * Single-row groups are untouched. Idempotent. Pass dryRun=true to preview.
 * Reconciles with the Merge tool (same supersede mechanism + audit log).
 */
export async function backfillProvisionalEnrollments(opts: {
  dryRun?: boolean;
  actor?: { id?: string; name?: string; role?: string };
} = {}): Promise<AttemptBackfillResult> {
  const dryRun = opts.dryRun !== false; // default to dry-run for safety
  const all = await getAllCourseEnrollments();
  const live = all.filter((e) => e.status !== "cancelled" && (e.phone || "").trim() && e.course_id);

  const byKey = new Map<string, CourseEnrollment[]>();
  for (const e of live) {
    const key = `${(e.phone || "").trim()}|${e.course_id}`;
    const arr = byKey.get(key) || byKey.set(key, []).get(key)!;
    arr.push(e);
  }

  const actions: AttemptBackfillAction[] = [];
  for (const [, arr] of byKey) {
    if (arr.length < 2) continue; // single row — nothing to dedupe
    const actives = arr.filter(isActiveEnrollment);
    const attempts = arr.filter(isAttemptEnrollment);

    // Choose the canonical row to KEEP.
    let kept: CourseEnrollment;
    let supersede: CourseEnrollment[];
    if (actives.length >= 1) {
      kept = [...actives].sort(
        (a, b) => (b.amount_paid || 0) - (a.amount_paid || 0) || (b.created_at || "").localeCompare(a.created_at || ""),
      )[0];
      // Supersede every NON-active attempt; if multiple actives exist that's a real
      // duplicate — leave the extra active rows for the Merge tool (don't auto-cancel money).
      supersede = attempts;
    } else {
      // All attempts: keep the newest intent, supersede the older ones.
      const sorted = [...attempts].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      kept = sorted[0];
      supersede = sorted.slice(1);
    }
    if (supersede.length === 0) continue;

    const abandonedPaymentIds: string[] = [];
    const reason = actives.length >= 1 ? "Superseded attempt (active enrollment exists)" : "Superseded duplicate attempt";

    if (!dryRun) {
      for (const dup of supersede) {
        await updateCourseEnrollment(dup.id, { status: "cancelled", superseded_by: kept.id }).catch(() => null);
        const pays = await getPaymentsByEnrollmentId(dup.id).catch(() => [] as Payment[]);
        for (const p of pays) {
          if (!isPaidStatus(p.status) && p.status !== "ABANDONED" && p.reference_no) {
            await updatePaymentByReference(p.reference_no, { status: "ABANDONED" }).catch(() => null);
            abandonedPaymentIds.push(p.id);
          }
        }
      }
      const db = getSupabaseAdmin();
      if (db) {
        try {
          await db.from("enrollment_merge_log").insert({
            id: uuid(),
            phone: kept.phone,
            course_id: kept.course_id,
            course_title: kept.course_title,
            kept_enrollment_id: kept.id,
            cancelled_enrollment_ids: supersede.map((e) => e.id),
            repointed_payment_ids: [],
            abandoned_payment_ids: abandonedPaymentIds,
            old_outstanding: 0,
            new_outstanding: 0,
            old_enrollment_count: arr.length,
            reason: `backfill: ${reason}`,
            actor_id: opts.actor?.id ?? "system",
            actor_name: opts.actor?.name ?? "Attempt backfill",
            actor_role: opts.actor?.role ?? "system",
            metadata: { backfill: true, actives: actives.length, attempts: attempts.length },
            created_at: new Date().toISOString(),
          });
        } catch { /* best-effort audit */ }
      }
    } else {
      // Preview only: still enumerate which payments WOULD be abandoned.
      for (const dup of supersede) {
        const pays = await getPaymentsByEnrollmentId(dup.id).catch(() => [] as Payment[]);
        for (const p of pays) if (!isPaidStatus(p.status) && p.status !== "ABANDONED") abandonedPaymentIds.push(p.id);
      }
    }

    actions.push({
      phone: kept.phone,
      course_id: kept.course_id,
      course_title: kept.course_title,
      keptId: actives.length >= 1 ? kept.id : null,
      supersededIds: supersede.map((e) => e.id),
      abandonedPaymentIds,
      reason,
    });
  }

  return { ok: true, dryRun, scannedGroups: byKey.size, changedGroups: actions.length, actions };
}

export interface MergeDuplicatesResult {
  ok: boolean;
  error?: string;
  keptId?: string;
  cancelledIds?: string[];
  repointedPaymentIds?: string[];
  abandonedPaymentIds?: string[];
  oldOutstanding?: number;
  newOutstanding?: number;
  oldCount?: number;
  noop?: boolean;
}

/**
 * Merge duplicate active enrollments for one phone+course into a single canonical
 * row. Keeps ONE enrollment, cancels the rest (status=cancelled, superseded_by),
 * re-points any PAID payments to the canonical row, marks the duplicates' non-paid
 * payments ABANDONED (never deletes a payment), recomputes the canonical balance,
 * and writes an immutable enrollment_merge_log row. Idempotent.
 */
export async function mergeDuplicateEnrollments(input: {
  phone: string;
  courseId: string;
  keepId?: string | null;
  reason?: string | null;
  actor?: { id?: string | null; name?: string | null; role?: string | null } | null;
}): Promise<MergeDuplicatesResult> {
  const phone = (input.phone || "").trim();
  const courseId = (input.courseId || "").trim();
  if (!phone || !courseId) return { ok: false, error: "phone and courseId are required." };

  const db = getSupabaseAdmin();
  const all = await getCourseEnrollmentsByPhone(phone);
  const dups = all.filter((e) => e.course_id === courseId && e.status !== "cancelled");
  if (dups.length < 2) {
    return { ok: true, noop: true, keptId: dups[0]?.id, cancelledIds: [], oldCount: dups.length };
  }

  // Choose canonical: most money paid wins; tie-break = earliest created.
  const ranked = [...dups].sort((a, b) => {
    const pa = a.amount_paid || 0;
    const pb = b.amount_paid || 0;
    if (pb !== pa) return pb - pa;
    return (a.created_at || "").localeCompare(b.created_at || "");
  });
  const requested = input.keepId ? dups.find((e) => e.id === input.keepId) : null;
  const canonical = requested || ranked[0];
  const others = dups.filter((e) => e.id !== canonical.id);

  const oldOutstanding = dups.reduce((sum, e) => sum + enrollmentOutstanding(e), 0);

  const repointedPaymentIds: string[] = [];
  const abandonedPaymentIds: string[] = [];

  for (const dup of others) {
    const pays = await getAllPaymentRowsByEnrollmentId(dup.id);
    for (const p of pays) {
      if (p.deleted_at) continue; // leave trashed rows alone
      if (isPaidStatus(p.status)) {
        // Real money — re-point to the canonical enrollment (never lost).
        if (db) {
          try { await db.from("payments").update({ enrollment_id: canonical.id }).eq("id", p.id); } catch { /* best-effort */ }
          if (p.reference_no) {
            try { await db.from("payment_receipts").update({ enrollment_id: canonical.id }).eq("reference_no", p.reference_no); } catch { /* best-effort */ }
          }
        }
        repointedPaymentIds.push(p.id);
      } else if (p.status === "PENDING" || p.status === "VERIFYING") {
        // Stale attempt on a soon-to-be-cancelled duplicate — abandon (preserve row).
        if (db) {
          try { await db.from("payments").update({ status: "ABANDONED" }).eq("id", p.id); } catch { /* best-effort */ }
        }
        abandonedPaymentIds.push(p.id);
      }
    }
    await updateCourseEnrollment(dup.id, {
      status: "cancelled",
      superseded_by: canonical.id,
      payment_plan_change_reason: (input.reason || "Merged duplicate enrollment").slice(0, 500),
    }).catch(() => null);
  }

  // Recompute the canonical row from its (now possibly re-pointed) PAID payments.
  const recomputed = await recomputeCourseEnrollment(canonical.id);
  const newOutstanding = recomputed ? enrollmentOutstanding(recomputed) : enrollmentOutstanding(canonical);
  await bumpBuyerSessionVersion(phone).catch(() => null);

  // ---- Immutable audit ----
  if (db) {
    const logRow = {
      id: uuid(),
      phone,
      course_id: courseId,
      course_title: canonical.course_title,
      kept_enrollment_id: canonical.id,
      cancelled_enrollment_ids: others.map((e) => e.id),
      repointed_payment_ids: repointedPaymentIds,
      abandoned_payment_ids: abandonedPaymentIds,
      old_outstanding: Math.round(oldOutstanding),
      new_outstanding: Math.round(newOutstanding),
      old_enrollment_count: dups.length,
      reason: (input.reason || "").trim() || null,
      actor_id: input.actor?.id ?? null,
      actor_name: input.actor?.name ?? null,
      actor_role: input.actor?.role ?? null,
      metadata: { repointed: repointedPaymentIds.length, abandoned: abandonedPaymentIds.length },
      created_at: new Date().toISOString(),
    };
    try { await db.from("enrollment_merge_log").insert(logRow); } catch { /* best-effort */ }
  }

  return {
    ok: true,
    keptId: canonical.id,
    cancelledIds: others.map((e) => e.id),
    repointedPaymentIds,
    abandonedPaymentIds,
    oldOutstanding: Math.round(oldOutstanding),
    newOutstanding: Math.round(newOutstanding),
    oldCount: dups.length,
  };
}

export async function getEnrollmentMergeLogs(limit = 200): Promise<EnrollmentMergeLog[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("enrollment_merge_log").select("*").order("created_at", { ascending: false }).limit(limit);
  return (data as EnrollmentMergeLog[]) ?? [];
}

// ==================== CHECKOUT GUARDS: resume + idempotency dedupe ====================

/**
 * Find an existing non-cancelled, not-fully-paid enrollment for this phone+course
 * the checkout flow should RESUME instead of creating a duplicate. Returns the most
 * recently-created match (so the latest in-progress booking is reused).
 */
export async function findResumableCourseEnrollment(phone: string, courseId: string): Promise<CourseEnrollment | null> {
  const p = (phone || "").trim();
  const c = (courseId || "").trim();
  if (!p || !c) return null;
  const list = await getCourseEnrollmentsByPhone(p);
  const candidates = list
    .filter((e) => e.course_id === c && e.status !== "cancelled" && e.status !== "fully_paid")
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return candidates[0] || null;
}

/** Is this phone fully paid for this course already? (overpayment / re-pay guard) */
export async function isCourseFullyPaidForPhone(phone: string, courseId: string): Promise<boolean> {
  const p = (phone || "").trim();
  const c = (courseId || "").trim();
  if (!p || !c) return false;
  const list = await getCourseEnrollmentsByPhone(p);
  return list.some((e) => e.course_id === c && e.status !== "cancelled" && enrollmentOutstanding(e) <= 0 && (e.amount_paid || 0) > 0);
}

/**
 * Short-window idempotency: return the most recent still-open (PENDING/VERIFYING)
 * course payment attempt for this phone+course created within `withinMs`. Lets the
 * server re-hand-back the SAME payment instead of minting a new row on a double-click
 * / refresh / back-button.
 */
export async function findRecentOpenCoursePayment(phone: string, courseSlug: string, withinMs = 120000): Promise<Payment | null> {
  return findRecentOpenPaymentForItem(phone, "course", courseSlug, withinMs);
}

/**
 * Generic short-window idempotency for ANY item type (course/webinar/plan): the
 * most recent still-open (PENDING/VERIFYING) attempt for this phone+item within
 * `withinMs`. Lets a checkout re-hand-back the same payment on a double-submit.
 */
export async function findRecentOpenPaymentForItem(
  phone: string,
  itemType: "course" | "webinar" | "plan",
  itemSlug: string,
  withinMs = 120000,
): Promise<Payment | null> {
  const p = (phone || "").trim();
  const slug = (itemSlug || "").trim();
  if (!p || !slug) return null;
  const db = getSupabaseAdmin();
  if (!db) return null;
  const since = new Date(Date.now() - withinMs).toISOString();
  const { data } = await db
    .from("payments")
    .select("*")
    .eq("phone", p)
    .eq("item_type", itemType)
    .eq("item_slug", slug)
    .is("deleted_at", null)
    .in("status", ["PENDING", "VERIFYING"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Payment) ?? null;
}

/** Recent open payment attempt for a specific installment on an enrollment (dedupe). */
export async function findRecentOpenInstallmentPayment(
  enrollmentId: string,
  installmentNo: number,
  withinMs = 120000,
): Promise<Payment | null> {
  const id = (enrollmentId || "").trim();
  if (!id) return null;
  const db = getSupabaseAdmin();
  if (!db) return null;
  const since = new Date(Date.now() - withinMs).toISOString();
  const { data } = await db
    .from("payments")
    .select("*")
    .eq("enrollment_id", id)
    .eq("installment_no", installmentNo)
    .is("deleted_at", null)
    .in("status", ["PENDING", "VERIFYING"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Payment) ?? null;
}

// ==================== PAYMENT EDIT / SOFT-DELETE / RESTORE (super-admin) ====================

export interface PaymentMutationResult {
  ok: boolean;
  error?: string;
  payment?: Payment;
  oldValues?: Partial<Payment>;
  newValues?: Partial<Payment>;
  enrollmentId?: string | null;
  noop?: boolean;
}

const EDITABLE_PAYMENT_FIELDS: (keyof Payment)[] = ["amount", "status", "reference_no", "student_name", "payment_mode"];

/** Edit safe fields on a payment and re-sync the affected course enrollment. */
export async function editPaymentById(
  paymentId: string,
  patch: Partial<Pick<Payment, "amount" | "status" | "reference_no" | "student_name" | "payment_mode">>,
): Promise<PaymentMutationResult> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Storage unavailable." };
  const existing = await getPaymentById(paymentId);
  if (!existing) return { ok: false, error: "Payment not found." };
  if (existing.deleted_at) return { ok: false, error: "Restore this payment from Trash before editing it." };

  const next: Record<string, unknown> = {};
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  const existingRec = existing as unknown as Record<string, unknown>;
  const patchRec = patch as Record<string, unknown>;
  for (const f of EDITABLE_PAYMENT_FIELDS) {
    const key = f as string;
    if (key in patchRec && patchRec[key] !== undefined && patchRec[key] !== existingRec[key]) {
      next[key] = patchRec[key];
      oldValues[key] = existingRec[key];
      newValues[key] = patchRec[key];
    }
  }
  if (typeof next.amount === "number" && (next.amount < 0 || !Number.isFinite(next.amount))) {
    return { ok: false, error: "Amount must be a non-negative number." };
  }
  if (Object.keys(next).length === 0) return { ok: true, noop: true, payment: existing, enrollmentId: existing.enrollment_id ?? null };

  let updated: Payment = existing;
  try {
    const { data, error } = await db.from("payments").update(next).eq("id", paymentId).select().maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (data) updated = data as Payment;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Update failed." };
  }

  // Re-sync the course enrollment whenever money-affecting fields changed.
  const affectsLedger = "status" in next || "amount" in next || "reference_no" in next;
  if (affectsLedger && updated.item_type === "course" && updated.enrollment_id) {
    if (isPaidStatus(updated.status) && updated.reference_no) {
      await finalizeCoursePaymentByReference(updated.reference_no).catch(() => null);
    }
    await recomputeCourseEnrollment(updated.enrollment_id).catch(() => null);
  }
  if (updated.phone) await bumpBuyerSessionVersion(updated.phone).catch(() => null);
  return { ok: true, payment: updated, oldValues, newValues, enrollmentId: updated.enrollment_id ?? null };
}

/** Soft-delete a payment to Trash (recoverable). Re-syncs the enrollment. */
export async function softDeletePaymentById(paymentId: string, reason: string, deletedBy: string | null): Promise<PaymentMutationResult> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Storage unavailable." };
  const existing = await getPaymentById(paymentId);
  if (!existing) return { ok: false, error: "Payment not found." };
  if (existing.deleted_at) return { ok: true, noop: true, payment: existing, enrollmentId: existing.enrollment_id ?? null };

  const patch = { deleted_at: new Date().toISOString(), deleted_by: deletedBy, deleted_reason: (reason || "").trim() || null };
  let updated: Payment = existing;
  try {
    const { data, error } = await db.from("payments").update(patch).eq("id", paymentId).select().maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (data) updated = data as Payment;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
  }

  // If this was a PAID course payment, drop its receipt and recompute (re-locks access).
  if (existing.item_type === "course" && existing.enrollment_id) {
    if (isPaidStatus(existing.status) && existing.reference_no) {
      const receipt = await getReceiptByReference(existing.reference_no).catch(() => null);
      if (receipt) { try { await db.from("payment_receipts").delete().eq("id", receipt.id); } catch { /* best-effort */ } }
    }
    await recomputeCourseEnrollment(existing.enrollment_id).catch(() => null);
  }
  if (existing.phone) await bumpBuyerSessionVersion(existing.phone).catch(() => null);
  return { ok: true, payment: updated, enrollmentId: existing.enrollment_id ?? null };
}

/** Restore a soft-deleted payment from Trash. Re-applies its ledger effect. */
export async function restorePaymentById(paymentId: string): Promise<PaymentMutationResult> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Storage unavailable." };
  const existing = await getPaymentById(paymentId);
  if (!existing) return { ok: false, error: "Payment not found." };
  if (!existing.deleted_at) return { ok: true, noop: true, payment: existing, enrollmentId: existing.enrollment_id ?? null };

  let updated: Payment = existing;
  try {
    const { data, error } = await db.from("payments").update({ deleted_at: null, deleted_by: null, deleted_reason: null }).eq("id", paymentId).select().maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (data) updated = data as Payment;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Restore failed." };
  }

  if (updated.item_type === "course" && updated.enrollment_id) {
    if (isPaidStatus(updated.status) && updated.reference_no) {
      await finalizeCoursePaymentByReference(updated.reference_no).catch(() => null);
    }
    await recomputeCourseEnrollment(updated.enrollment_id).catch(() => null);
  }
  if (updated.phone) await bumpBuyerSessionVersion(updated.phone).catch(() => null);
  return { ok: true, payment: updated, enrollmentId: updated.enrollment_id ?? null };
}

/** Permanent (hard) delete — SUPER ADMIN ONLY, only allowed for already-trashed rows. */
export async function permanentDeletePaymentById(paymentId: string): Promise<PaymentMutationResult> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "Storage unavailable." };
  const existing = await getPaymentById(paymentId);
  if (!existing) return { ok: false, error: "Payment not found." };
  if (!existing.deleted_at) return { ok: false, error: "Move the payment to Trash first (soft-delete) before permanent deletion." };
  try {
    await db.from("payments").delete().eq("id", paymentId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Permanent delete failed." };
  }
  return { ok: true, payment: existing, enrollmentId: existing.enrollment_id ?? null };
}

export async function addEnrollmentPlanChangeLog(
  input: Omit<EnrollmentPlanChangeLog, "id" | "created_at"> & { id?: string; created_at?: string },
): Promise<EnrollmentPlanChangeLog> {
  const row = {
    id: input.id ?? uuid(),
    created_at: input.created_at ?? new Date().toISOString(),
    ...input,
  } as EnrollmentPlanChangeLog;
  if (demoMode()) { demoPlanLogs().unshift(row); return row; }
  try {
    return await dbInsert<EnrollmentPlanChangeLog>("enrollment_plan_change_log", row as unknown as Record<string, unknown>);
  } catch {
    demoPlanLogs().unshift(row);
    return row;
  }
}

export async function getEnrollmentPlanChangeLogs(enrollmentId: string): Promise<EnrollmentPlanChangeLog[]> {
  const id = (enrollmentId || "").trim();
  if (!id) return [];
  if (demoMode()) return demoPlanLogs().filter((l) => l.enrollment_id === id);
  const db = getSupabaseAdmin();
  if (!db) return demoPlanLogs().filter((l) => l.enrollment_id === id);
  const { data } = await db
    .from("enrollment_plan_change_log")
    .select("*")
    .eq("enrollment_id", id)
    .order("created_at", { ascending: false });
  return (data as EnrollmentPlanChangeLog[]) ?? [];
}

export interface ChangeEnrollmentPlanInput {
  enrollmentId: string;
  target: ChangePlanTarget;
  reason?: string | null;
  changedBy?: string | null;
  confirmBackdated?: boolean;
  confirmDifference?: boolean;
}

/**
 * Convert an enrollment's payment plan. Preserves all paid lines, recomputes
 * outstanding from the new schedule, expires stale pending requests, writes an
 * audit row, flags the student notice, and fires the (default-OFF) SMS hook.
 */
export async function changeEnrollmentPaymentPlan(
  input: ChangeEnrollmentPlanInput,
): Promise<{ ok: true; enrollment: CourseEnrollment; warnings: string[] } | { ok: false; error: string }> {
  const enrollment = await getCourseEnrollmentById(input.enrollmentId);
  if (!enrollment) return { ok: false, error: "Enrollment not found." };
  if (enrollment.status === "cancelled") return { ok: false, error: "This enrollment is cancelled." };

  const before = deriveEnrollment(enrollment);
  const oldPlan: PaymentPlan = enrollment.payment_plan || (enrollment.plan_type === "emi" ? "EMI" : "FULL");

  // Course-driven interval defaults for the EMI builder (fall back to sensible defaults).
  let firstIntervalDays = 7;
  let intervalMonths = 1;
  try {
    const course = await getCourseBySlug(enrollment.course_slug);
    if (course) { const cfg = resolveEmiConfig(course); firstIntervalDays = cfg.firstIntervalDays; intervalMonths = cfg.intervalMonths; }
  } catch { /* defaults */ }

  const changedAt = new Date().toISOString();
  const opts: ConvertOptions = {
    bookingISO: changedAt,
    firstIntervalDays,
    intervalMonths,
    changedBy: input.changedBy ?? null,
    confirmBackdated: input.confirmBackdated,
    confirmDifference: input.confirmDifference,
  };
  const outcome = changePlan(enrollment, input.target, opts);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  const { schedule, planType, paymentPlan, installmentCount, totalFee, warnings } = outcome.result;

  // Expire any unfinished "pay full"/installment attempts so the old plan's
  // pending request never reappears. Paid rows are untouched.
  await cancelStalePendingPayments(enrollment.id);

  const status = enrollmentStatusFromSchedule({ total_fee: totalFee, schedule, plan_type: planType });
  const derivedAfter = deriveEnrollment({ total_fee: totalFee, schedule });

  const updated = await updateCourseEnrollment(enrollment.id, {
    schedule,
    plan_type: planType,
    payment_plan: paymentPlan,
    previous_payment_plan: oldPlan,
    total_fee: totalFee,
    installment_count: installmentCount,
    amount_paid: derivedAfter.paid,
    status,
    payment_plan_changed_at: changedAt,
    payment_plan_changed_by: input.changedBy ?? null,
    payment_plan_change_reason: input.reason ?? null,
    plan_change_notice_pending: true,
    plan_change_notice_seen_at: null,
  });
  const finalEnrollment = updated || {
    ...enrollment,
    schedule,
    plan_type: planType,
    payment_plan: paymentPlan,
    previous_payment_plan: oldPlan,
    total_fee: totalFee,
    installment_count: installmentCount,
    amount_paid: derivedAfter.paid,
    status,
  };

  // Audit (best-effort).
  const student = await findStudentByPhone(enrollment.phone).catch(() => null);
  await addEnrollmentPlanChangeLog({
    enrollment_id: enrollment.id,
    student_id: student?.id ?? null,
    phone: enrollment.phone,
    course_id: enrollment.course_id,
    old_plan: oldPlan,
    new_plan: paymentPlan,
    old_outstanding: before.remaining,
    new_outstanding: derivedAfter.remaining,
    reason: input.reason ?? null,
    changed_by: input.changedBy ?? null,
    metadata: {
      previous_schedule: enrollment.schedule,
      new_schedule: schedule,
      total_fee_before: enrollment.total_fee,
      total_fee_after: totalFee,
      warnings,
    },
  }).catch(() => null);

  // SMS hook — fire-and-forget; the rule is OFF by default so nothing sends
  // unless a Super Admin enables it. Idempotent via dedupe on enrollment+change.
  fireAutoSms({
    trigger: TRIGGERS.payment_plan_changed,
    phone: enrollment.phone,
    name: enrollment.student_name,
    vars: { item_short: enrollment.course_title },
    entity: { course_id: enrollment.course_id },
    entityId: `${enrollment.id}:${changedAt}`,
  });

  return { ok: true, enrollment: finalEnrollment, warnings };
}

export interface InstallmentLineActionInput {
  enrollmentId: string;
  /** schedule line `no`. */
  no: number;
  action: "edit_due" | "waive" | "cancel";
  due?: string | null;
  grace?: string | null;
  reason?: string | null;
  changedBy?: string | null;
  confirmBackdated?: boolean;
}

/** Edit a due date, or waive / cancel a single unpaid installment line. */
export async function updateInstallmentLine(
  input: InstallmentLineActionInput,
): Promise<{ ok: true; enrollment: CourseEnrollment } | { ok: false; error: string }> {
  const e = await getCourseEnrollmentById(input.enrollmentId);
  if (!e) return { ok: false, error: "Enrollment not found." };
  const schedule = [...(e.schedule || [])];
  const idx = schedule.findIndex((s) => s.no === input.no);
  if (idx < 0) return { ok: false, error: "Installment not found." };
  const line = schedule[idx];
  if (line.paid) return { ok: false, error: "This installment is already paid and cannot be changed." };
  const now = new Date().toISOString();

  let totalFee = e.total_fee;
  if (input.action === "edit_due") {
    if (!input.due) return { ok: false, error: "A due date is required." };
    const dueMs = Date.parse(input.due) || 0;
    if (dueMs < Date.now() - 15 * PLAN_DAY_MS && !input.confirmBackdated) {
      return { ok: false, error: "That due date is more than 15 days in the past and will immediately revoke access. Re-confirm to proceed." };
    }
    schedule[idx] = { ...line, due: input.due, grace: input.grace ?? line.grace ?? null, status: "pending", updated_at: now };
  } else if (input.action === "waive") {
    // Waiving forgives this amount → reduce the effective fee so totals reconcile.
    totalFee = Math.max(0, e.total_fee - line.amount);
    schedule[idx] = { ...line, status: "waived", cancelled_reason: input.reason || "Waived by admin", updated_at: now };
  } else if (input.action === "cancel") {
    schedule[idx] = { ...line, status: "cancelled", cancelled_reason: input.reason || "Cancelled by admin", updated_at: now };
  } else {
    return { ok: false, error: "Unknown action." };
  }

  const status = enrollmentStatusFromSchedule({ total_fee: totalFee, schedule, plan_type: e.plan_type });
  const derived = deriveEnrollment({ total_fee: totalFee, schedule });
  const updated = await updateCourseEnrollment(e.id, { schedule, total_fee: totalFee, amount_paid: derived.paid, status });
  return { ok: true, enrollment: updated || { ...e, schedule, total_fee: totalFee, amount_paid: derived.paid, status } };
}

/** Enrollments for a phone with an unacknowledged plan-change notice. */
export async function getPlanChangeNoticesForPhone(phone: string): Promise<CourseEnrollment[]> {
  const list = await getCourseEnrollmentsByPhone(phone);
  return list.filter((e) => !!e.plan_change_notice_pending && e.status !== "cancelled");
}

/** Mark the plan-change notice as seen for the affected student (phone-scoped). */
export async function acknowledgePlanChangeNotice(enrollmentId: string, phone: string): Promise<boolean> {
  const e = await getCourseEnrollmentById(enrollmentId);
  if (!e) return false;
  if (e.phone !== (phone || "").trim()) return false;
  await updateCourseEnrollment(enrollmentId, {
    plan_change_notice_pending: false,
    plan_change_notice_seen_at: new Date().toISOString(),
  });
  return true;
}

export interface OfflineWebinarPaymentInput {
  webinarId: string;
  name: string;
  phone: string;
  email?: string | null;
  amount: number;
  method: string;
  dateISO?: string;
  note?: string | null;
}

/** Record a cash/offline webinar payment (one-time) + register the attendee. */
export async function recordOfflineWebinarPayment(
  input: OfflineWebinarPaymentInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const phone = (input.phone || "").trim();
  if (!/^\d{10}$/.test(phone)) return { ok: false, error: "Valid 10-digit phone required." };
  const webinar = (await getWebinars()).find((w) => w.id === input.webinarId);
  if (!webinar) return { ok: false, error: "Webinar not found." };
  const amount = Math.max(0, Math.round(Number(input.amount) || 0));
  const method = (input.method || "Cash").trim();
  const dateISO = input.dateISO || new Date().toISOString();
  const ref = await uniqueOfflineRef();

  if (amount > 0) {
    await createPayment({
      student_name: input.name,
      phone,
      email: input.email || null,
      item: webinar.title,
      item_type: "webinar",
      item_slug: webinar.slug,
      amount,
      status: "PAID",
      gateway: "offline",
      reference_no: ref,
      gateway_ref: input.note ? `${method} · ${input.note}` : method,
      payment_mode: method,
      mode: method,
      transaction_amount: amount,
      transaction_date: dateISO,
      created_at: dateISO,
      razorpay_payment_id: null,
    });
  }
  await registerWebinar(input.webinarId, input.name, phone).catch(() => null);
  return { ok: true };
}

export interface BackfillResult {
  scannedPhones: number;
  alreadyStudents: number;
  studentsCreated: number;
  buyersCreated: number;
}

/**
 * Idempotent backfill: ensures EVERY existing paying/registered person (by phone)
 * exists in Students & Enrollments. Scans buyers, paid payments, course
 * enrollments and webinar registrations, derives one identity per phone, and
 * creates the missing master student + buyer login. Never deletes or edits any
 * payment/enrollment — it only links/derives. Running it twice creates nothing
 * new (dedupe is by phone).
 */
export async function backfillPayingStudents(): Promise<BackfillResult> {
  const [buyers, payments, enrollments, regs, students] = await Promise.all([
    getBuyers(),
    getPayments(),
    getAllCourseEnrollments(),
    getAllWebinarRegistrations(),
    getStudents(),
  ]);

  const existingPhones = new Set(students.map((s) => (s.phone || "").trim()).filter(Boolean));
  const existingBuyerPhones = new Set(buyers.map((b) => (b.phone || "").trim()).filter(Boolean));

  // Earliest activity + best name per phone (one identity per person).
  const people = new Map<string, { name: string; createdAt: string }>();
  const consider = (phoneRaw: string | null | undefined, name: string | null | undefined, createdAt: string | null | undefined) => {
    const phone = (phoneRaw || "").trim();
    if (!phone) return;
    const cur = people.get(phone);
    const ts = createdAt || new Date().toISOString();
    if (!cur) {
      people.set(phone, { name: (name || "").trim(), createdAt: ts });
    } else {
      if (!cur.name && name) cur.name = name.trim();
      if (ts < cur.createdAt) cur.createdAt = ts;
    }
  };

  for (const b of buyers) consider(b.phone, b.name, b.created_at);
  for (const p of payments) if (isPaidStatus(p.status)) consider(p.phone, p.student_name, p.created_at);
  for (const e of enrollments) if (e.status !== "cancelled") consider(e.phone, e.student_name, e.created_at);
  for (const r of regs) consider(r.phone, r.name, r.created_at);

  let studentsCreated = 0;
  let buyersCreated = 0;
  let alreadyStudents = 0;

  for (const [phone, meta] of people) {
    if (existingPhones.has(phone)) {
      alreadyStudents += 1;
      continue;
    }
    const hadBuyer = existingBuyerPhones.has(phone);
    const buyer = await ensureBuyerRow(phone, meta.name);
    if (buyer && !hadBuyer) buyersCreated += 1;
    const created = await ensureStudentForCustomer(phone, meta.name, buyer?.login_code, meta.createdAt);
    if (created) studentsCreated += 1;
  }

  return { scannedPhones: people.size, alreadyStudents, studentsCreated, buyersCreated };
}

/**
 * Lightweight, durable rate-limit: returns true when `key` has been seen more
 * than `max` times within `windowSec`. Always records the attempt. In demo mode
 * (no DB) it never blocks. Structured so OTP/stricter limits can be added later.
 */
export async function rateLimited(key: string, max: number, windowSec: number): Promise<boolean> {
  if (demoMode()) return false;
  const db = getSupabaseAdmin();
  if (!db) return false;
  try {
    const since = new Date(Date.now() - windowSec * 1000).toISOString();
    const { count } = await db
      .from("auth_attempts")
      .select("id", { count: "exact", head: true })
      .eq("key", key)
      .gte("created_at", since);
    await db.from("auth_attempts").insert({ key });
    return (count ?? 0) >= max;
  } catch {
    return false;
  }
}

// ============================ REFERRALS ============================
export async function getReferrals(): Promise<Referral[]> {
  if (demoMode()) return [...mock.referrals];
  const rows = await dbSelect<Referral>("referrals");
  return rows.length ? rows : [...mock.referrals];
}
export async function updateReferral(id: string, patch: Partial<Referral>): Promise<Referral | null> {
  if (demoMode()) {
    const idx = mock.referrals.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    mock.referrals[idx] = { ...mock.referrals[idx], ...patch };
    return mock.referrals[idx];
  }
  return dbUpdate<Referral>("referrals", id, patch as Record<string, unknown>);
}

// ============================ STAFF ============================
export async function getStaff(): Promise<Staff[]> {
  if (demoMode()) return [...mock.staff];
  const rows = await dbSelect<Staff>("staff");
  return rows.length ? rows : [...mock.staff];
}
export async function addStaff(input: Partial<Staff>): Promise<Staff> {
  const row = {
    id: uuid(),
    name: input.name || "New Staff",
    username: input.username || "staff",
    role: input.role || "Counsellor",
    email: input.email ?? null,
    active: true,
    created_at: new Date().toISOString(),
  } as Staff;
  if (demoMode()) {
    mock.staff.unshift(row);
    return row;
  }
  return dbInsert<Staff>("staff", row as unknown as Record<string, unknown>);
}
export async function updateStaff(id: string, patch: Partial<Staff>): Promise<Staff | null> {
  if (demoMode()) {
    const idx = mock.staff.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    mock.staff[idx] = { ...mock.staff[idx], ...patch };
    return mock.staff[idx];
  }
  return dbUpdate<Staff>("staff", id, patch as Record<string, unknown>);
}

// ============================ STATS / DASHBOARD ============================
export interface Stats {
  total: number;
  activeNow: number;
  expiringSoon: number;
  totalRevenue: number;
}

export async function getStats(): Promise<Stats> {
  const all = await getStudents();
  const stats: Stats = { total: 0, activeNow: 0, expiringSoon: 0, totalRevenue: 0 };
  for (const s of all) {
    stats.total += 1;
    stats.totalRevenue += s.amount_paid ?? 0;
    if (s.is_active && !isExpired(s.expiry_date)) stats.activeNow += 1;
    if (isExpiringSoon(s.expiry_date)) stats.expiringSoon += 1;
  }
  return stats;
}

export interface DashboardData {
  totalLeads: number;
  newLeadsToday: number;
  totalStudents: number;
  activeSubs: number;
  revenueMonth: number | null;
  revenueTotal: number | null;
  pendingCollections: number | null;
  webinarRegs: number;
  demoBookings: number;
  conversionRate: number;
  enrollmentsByMonth: { month: string; count: number }[];
  revenueByCourse: { name: string; value: number }[];
  leadSources: { name: string; value: number }[];
  funnel: { stage: string; value: number }[];
}

export async function getDashboard(): Promise<DashboardData> {
  const [leads, students, payments, webinars, enrollments, courses] = await Promise.all([
    getLeads(),
    getStudents(),
    getPayments(),
    getWebinars(),
    getEnrollments(),
    getAllCourses(),
  ]);
  const today = todayISODate();
  const monthStart = new Date();
  monthStart.setDate(1);

  // Revenue counts BOTH Razorpay "captured" and ICICI "PAID" (previously PAID was
  // dropped → undercount), with retry-duplicate paid rows collapsed so a double
  // settlement of one purchase isn't counted twice. Installments are preserved.
  const paidRows = payments.filter((p) => isPaidStatus(p.status));
  const revenueTotal = dedupedPaidTotal(paidRows);
  const revenueMonth = dedupedPaidTotal(paidRows.filter((p) => new Date(p.created_at) >= monthStart));
  const pendingCollections = enrollments.reduce((a, e) => a + (e.pending || 0), 0);
  const admitted = leads.filter((l) => l.admitted).length;
  const conversionRate = leads.length ? Math.round((admitted / leads.length) * 100) : 0;

  // enrollments by month (last 6)
  const months: { month: string; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const label = d.toLocaleDateString("en-IN", { month: "short" });
    const count = enrollments.filter((e) => {
      const ed = new Date(e.enrolled_at);
      return ed.getMonth() === d.getMonth() && ed.getFullYear() === d.getFullYear();
    }).length;
    months.push({ month: label, count: count || Math.floor(Math.random() * 6) + 2 });
  }

  const revenueByCourse = courses
    .map((c) => ({
      name: c.title.length > 18 ? c.title.slice(0, 16) + "…" : c.title,
      value: dedupedPaidTotal(paidRows.filter((p) => p.item === c.title)),
    }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const sourceMap: Record<string, number> = {};
  leads.forEach((l) => {
    sourceMap[l.source] = (sourceMap[l.source] || 0) + 1;
  });
  const leadSources = Object.entries(sourceMap).map(([name, value]) => ({ name, value }));

  const funnel = [
    { stage: "Leads", value: leads.length },
    { stage: "Contacted", value: leads.filter((l) => l.called).length },
    { stage: "Demo", value: leads.filter((l) => l.demo_attended).length },
    { stage: "Negotiation", value: leads.filter((l) => l.status === "Negotiation").length },
    { stage: "Admitted", value: admitted },
  ];

  return {
    totalLeads: leads.length,
    newLeadsToday: leads.filter((l) => l.created_at.slice(0, 10) === today).length,
    totalStudents: students.length,
    activeSubs: students.filter((s) => s.is_active && !isExpired(s.expiry_date)).length,
    revenueMonth,
    revenueTotal,
    pendingCollections,
    webinarRegs: webinars.reduce((a, w) => a + w.registrations, 0),
    demoBookings: leads.filter((l) => l.demo_booked).length,
    conversionRate,
    enrollmentsByMonth: months,
    revenueByCourse: revenueByCourse.length ? revenueByCourse : [{ name: "Sample", value: 40000 }],
    leadSources,
    funnel,
  };
}

// ============================ ACCESS LOGS ============================
export async function logAccess(studentId: string | null, action: string): Promise<void> {
  if (demoMode()) return;
  const db = getSupabaseAdmin();
  if (!db) return;
  try {
    await db.from("access_logs").insert({ student_id: studentId, action });
  } catch {
    /* best-effort */
  }
}

export interface AccessLogRow {
  action: string;
  timestamp: string;
}

/** Recent access/audit log entries for a student (login + admin access changes). */
export async function getAccessLogs(studentId: string, limit = 25): Promise<AccessLogRow[]> {
  if (demoMode()) return [];
  const db = getSupabaseAdmin();
  if (!db) return [];
  try {
    const { data } = await db
      .from("access_logs")
      .select("action,timestamp")
      .eq("student_id", studentId)
      .order("timestamp", { ascending: false })
      .limit(limit);
    return (data as AccessLogRow[]) ?? [];
  } catch {
    return [];
  }
}

// ============================ SITE / HOME SETTINGS ============================
// Demo-mode store persists across dev-server hot reloads via globalThis.
const demoSettings = (() => {
  const g = globalThis as unknown as { __namanSettings?: Partial<SiteSettings> };
  if (!g.__namanSettings) g.__namanSettings = { id: "home" };
  return g.__namanSettings;
})();

/** Public read — always returns a fully-populated settings object (merged with defaults). */
export async function getSiteSettings(): Promise<SiteSettings> {
  if (demoMode()) return mergeSiteSettings(demoSettings);
  const db = getSupabaseAdmin();
  if (!db) return mergeSiteSettings(null);
  try {
    const { data } = await db.from("site_settings").select("*").eq("id", "home").maybeSingle();
    return mergeSiteSettings(data as Partial<SiteSettings> | null);
  } catch {
    return mergeSiteSettings(null);
  }
}

/**
 * Admin write — partial upsert of the single 'home' settings row.
 * Only the keys present in `patch` are overwritten; everything else is preserved,
 * so editing one screen (e.g. Settings/brand) never wipes another (e.g. Home).
 */
export async function updateSiteSettings(patch: Partial<SiteSettings>): Promise<SiteSettings> {
  const keys = ["logo_url", "logo_alt", "hero", "popup", "content", "brand", "toppers", "nav", "about"] as const;
  const provided: Record<string, unknown> = {};
  for (const k of keys) {
    if (k in patch && typeof patch[k] !== "undefined") provided[k] = patch[k];
  }

  if (demoMode()) {
    Object.assign(demoSettings, provided, { id: "home", updated_at: new Date().toISOString() });
    return mergeSiteSettings(demoSettings);
  }
  const db = getSupabaseAdmin();
  if (!db) return mergeSiteSettings({ id: "home", ...provided });

  // Read current row so we can preserve untouched columns on upsert.
  let current: Record<string, unknown> = {};
  try {
    const { data } = await db.from("site_settings").select("*").eq("id", "home").maybeSingle();
    if (data) current = data as Record<string, unknown>;
  } catch {
    /* table may be empty/new — fine */
  }

  const next = { ...current, ...provided, id: "home", updated_at: new Date().toISOString() };
  const { data, error } = await db
    .from("site_settings")
    .upsert(next, { onConflict: "id" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mergeSiteSettings(data as Partial<SiteSettings>);
}

// ============================ QUIZ PLATFORM ============================
function slugify(s: string): string {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// ---------------------------- Questions ----------------------------
export async function getQuestions(): Promise<Question[]> {
  if (demoMode()) return [...mock.questions];
  const rows = await dbSelect<Question>("questions");
  return rows.length ? rows : [];
}
export async function getQuestionById(id: string): Promise<Question | null> {
  if (demoMode()) return mock.questions.find((x) => x.id === id) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("questions").select("*").eq("id", id).maybeSingle();
  return (data as Question) ?? null;
}
export async function getQuestionsByIds(ids: string[]): Promise<Question[]> {
  if (!ids.length) return [];
  if (demoMode()) return mock.questions.filter((x) => ids.includes(x.id));
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("questions").select("*").in("id", ids);
  return (data as Question[]) ?? [];
}
export async function addQuestion(input: Partial<Question>): Promise<Question> {
  const ts = new Date().toISOString();
  const row: Question = {
    id: uuid(),
    question_html: input.question_html || "",
    question_image: input.question_image ?? null,
    passage_id: input.passage_id ?? null,
    options: input.options || { A: "", B: "", C: "", D: "" },
    correct_option: input.correct_option || "A",
    explanation_html: input.explanation_html ?? null,
    short_explanation: input.short_explanation ?? null,
    subject: input.subject ?? null,
    topic: input.topic ?? null,
    subtopic: input.subtopic ?? null,
    difficulty: input.difficulty || "Moderate",
    tags: input.tags || [],
    source: input.source ?? null,
    source_url: input.source_url ?? null,
    is_pyq: input.is_pyq ?? false,
    pyq_year: input.pyq_year ?? null,
    current_affairs_date: input.current_affairs_date ?? null,
    language: input.language || "English",
    status: input.status || "draft",
    quality_status: input.quality_status || "unreviewed",
    allow_in_public_quiz: input.allow_in_public_quiz ?? true,
    allow_in_paid_quiz: input.allow_in_paid_quiz ?? true,
    marks_override: input.marks_override ?? null,
    negative_marks_override: input.negative_marks_override ?? null,
    duplicate_check_hash: input.duplicate_check_hash ?? null,
    created_by: input.created_by ?? null,
    created_at: ts,
    updated_at: ts,
  };
  if (demoMode()) {
    mock.questions.unshift(row);
    return row;
  }
  return dbInsert<Question>("questions", row as unknown as Record<string, unknown>);
}
export async function updateQuestion(id: string, patch: Partial<Question>): Promise<Question | null> {
  const next = { ...patch, updated_at: new Date().toISOString() };
  if (demoMode()) {
    const idx = mock.questions.findIndex((x) => x.id === id);
    if (idx === -1) return null;
    mock.questions[idx] = { ...mock.questions[idx], ...next };
    return mock.questions[idx];
  }
  return dbUpdate<Question>("questions", id, next as Record<string, unknown>);
}
export async function deleteQuestion(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.questions.findIndex((x) => x.id === id);
    if (idx === -1) return false;
    mock.questions.splice(idx, 1);
    return true;
  }
  return dbDelete("questions", id);
}

// ------------------------------ Quizzes ----------------------------
export async function getAllQuizzes(): Promise<Quiz[]> {
  if (demoMode()) return [...mock.quizzes];
  const rows = await dbSelect<Quiz>("quizzes");
  return rows.length ? rows : [];
}
export async function getPublicQuizzes(): Promise<Quiz[]> {
  const all = await getAllQuizzes();
  return all.filter((q) => q.status === "published" && q.is_public);
}
export async function getQuizById(id: string): Promise<Quiz | null> {
  if (demoMode()) return mock.quizzes.find((q) => q.id === id) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("quizzes").select("*").eq("id", id).maybeSingle();
  return (data as Quiz) ?? null;
}
export async function getQuizBySlug(slug: string): Promise<Quiz | null> {
  if (demoMode()) return mock.quizzes.find((q) => q.slug === slug) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("quizzes").select("*").eq("slug", slug).maybeSingle();
  return (data as Quiz) ?? null;
}
export async function addQuiz(input: Partial<Quiz>): Promise<Quiz> {
  const ts = new Date().toISOString();
  const row: Quiz = {
    id: uuid(),
    title: input.title || "Untitled Quiz",
    slug: input.slug || slugify(input.title || "quiz") || `quiz-${Date.now()}`,
    description: input.description ?? null,
    instructions_html: input.instructions_html ?? null,
    type: input.type || "FreePublic",
    exam_type: input.exam_type || "PrelimsGS",
    subject: input.subject ?? null,
    topic: input.topic ?? null,
    quiz_date: input.quiz_date ?? null,
    quiz_month: input.quiz_month ?? null,
    quiz_year: input.quiz_year ?? null,
    difficulty: input.difficulty || "Moderate",
    language: input.language || "English",
    thumbnail: input.thumbnail ?? null,
    status: input.status || "draft",
    is_public: input.is_public ?? true,
    requires_login: input.requires_login ?? false,
    requires_payment: input.requires_payment ?? false,
    time_limit_minutes: input.time_limit_minutes ?? null,
    marks_per_question: input.marks_per_question ?? 2,
    negative_marking_enabled: input.negative_marking_enabled ?? true,
    negative_fraction: input.negative_fraction ?? 0.3333,
    max_attempts: input.max_attempts ?? null,
    scoring_settings: input.scoring_settings || {},
    timing_settings: input.timing_settings || {},
    attempt_settings: input.attempt_settings || {},
    result_settings: input.result_settings || {},
    access_rules: input.access_rules || {},
    seo: input.seo || {},
    published_at: input.published_at ?? null,
    created_by: input.created_by ?? null,
    created_at: ts,
    updated_at: ts,
  };
  if (demoMode()) {
    mock.quizzes.unshift(row);
    return row;
  }
  return dbInsert<Quiz>("quizzes", row as unknown as Record<string, unknown>);
}
export async function updateQuiz(id: string, patch: Partial<Quiz>): Promise<Quiz | null> {
  const next = { ...patch, updated_at: new Date().toISOString() };
  if (demoMode()) {
    const idx = mock.quizzes.findIndex((q) => q.id === id);
    if (idx === -1) return null;
    mock.quizzes[idx] = { ...mock.quizzes[idx], ...next };
    return mock.quizzes[idx];
  }
  return dbUpdate<Quiz>("quizzes", id, next as Record<string, unknown>);
}
export async function deleteQuiz(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.quizzes.findIndex((q) => q.id === id);
    if (idx === -1) return false;
    mock.quizzes.splice(idx, 1);
    const keep = mock.quizQuestions.filter((qq) => qq.quiz_id !== id);
    mock.quizQuestions.splice(0, mock.quizQuestions.length, ...keep);
    return true;
  }
  return dbDelete("quizzes", id);
}

// -------------------------- Quiz ↔ Questions -----------------------
export async function getQuizQuestions(quizId: string): Promise<QuizQuestion[]> {
  if (demoMode()) {
    return mock.quizQuestions.filter((qq) => qq.quiz_id === quizId).sort((a, b) => a.order_index - b.order_index);
  }
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("quiz_questions").select("*").eq("quiz_id", quizId).order("order_index", { ascending: true });
  return (data as QuizQuestion[]) ?? [];
}
export async function addQuizQuestion(input: Partial<QuizQuestion> & { quiz_id: string; question_id: string }): Promise<QuizQuestion> {
  const row: QuizQuestion = {
    id: uuid(),
    quiz_id: input.quiz_id,
    question_id: input.question_id,
    order_index: input.order_index ?? 0,
    section: input.section ?? null,
    marks: input.marks ?? null,
    negative_marks: input.negative_marks ?? null,
    snapshot: input.snapshot || {},
    created_at: new Date().toISOString(),
  };
  if (demoMode()) {
    mock.quizQuestions.push(row);
    return row;
  }
  return dbInsert<QuizQuestion>("quiz_questions", row as unknown as Record<string, unknown>);
}
/** Replace all questions for a quiz (used by the builder save). */
export async function setQuizQuestions(quizId: string, items: (Partial<QuizQuestion> & { question_id: string })[]): Promise<QuizQuestion[]> {
  if (demoMode()) {
    const keep = mock.quizQuestions.filter((qq) => qq.quiz_id !== quizId);
    const rows = items.map((it, i) => ({
      id: uuid(),
      quiz_id: quizId,
      question_id: it.question_id,
      order_index: it.order_index ?? i,
      section: it.section ?? null,
      marks: it.marks ?? null,
      negative_marks: it.negative_marks ?? null,
      snapshot: it.snapshot || {},
      created_at: new Date().toISOString(),
    }) as QuizQuestion);
    mock.quizQuestions.splice(0, mock.quizQuestions.length, ...keep, ...rows);
    return rows;
  }
  const db = getSupabaseAdmin();
  if (!db) return [];
  await db.from("quiz_questions").delete().eq("quiz_id", quizId);
  const rows = items.map((it, i) => ({
    id: uuid(),
    quiz_id: quizId,
    question_id: it.question_id,
    order_index: it.order_index ?? i,
    section: it.section ?? null,
    marks: it.marks ?? null,
    negative_marks: it.negative_marks ?? null,
    snapshot: it.snapshot || {},
    created_at: new Date().toISOString(),
  }));
  if (rows.length) {
    const { error } = await db.from("quiz_questions").insert(rows);
    if (error) throw new Error(error.message);
  }
  return rows as QuizQuestion[];
}

// ---------------------------- Attempts -----------------------------
export async function getAttemptById(id: string): Promise<QuizAttempt | null> {
  if (demoMode()) return mock.quizAttempts.find((a) => a.id === id) ?? null;
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("quiz_attempts").select("*").eq("id", id).maybeSingle();
  return (data as QuizAttempt) ?? null;
}
export async function getAttemptsByQuiz(quizId: string): Promise<QuizAttempt[]> {
  if (demoMode()) return mock.quizAttempts.filter((a) => a.quiz_id === quizId);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("quiz_attempts").select("*").eq("quiz_id", quizId).order("created_at", { ascending: false });
  return (data as QuizAttempt[]) ?? [];
}
export async function getAllAttempts(): Promise<QuizAttempt[]> {
  if (demoMode()) return [...mock.quizAttempts];
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("quiz_attempts").select("*").order("created_at", { ascending: false });
  return (data as QuizAttempt[]) ?? [];
}
export async function getAttemptsByUser(userId: string): Promise<QuizAttempt[]> {
  if (demoMode()) return mock.quizAttempts.filter((a) => a.user_id === userId);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("quiz_attempts").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  return (data as QuizAttempt[]) ?? [];
}

/** All attempts a guest made with this mobile number (pre-login lead history). */
export async function getAttemptsByGuestMobile(phone: string): Promise<QuizAttempt[]> {
  const p = (phone || "").trim();
  if (!p) return [];
  if (demoMode()) return mock.quizAttempts.filter((a) => a.guest_mobile === p);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("quiz_attempts").select("*").eq("guest_mobile", p).order("created_at", { ascending: false });
  return (data as QuizAttempt[]) ?? [];
}

/**
 * Claim a returning user's pre-login GUEST attempts (made with `phone`) by
 * attaching them to their canonical student id. This unifies a lead's quiz
 * history the moment they log in, so resume/results/retakes all work through the
 * normal `user_id` path. Non-destructive (only sets user_id where it was null)
 * and idempotent. Returns the number of attempts claimed.
 */
export async function claimGuestAttempts(phone: string, studentId: string): Promise<number> {
  const p = (phone || "").trim();
  if (!p || !studentId) return 0;
  if (demoMode()) {
    let n = 0;
    for (const a of mock.quizAttempts) {
      if (!a.user_id && a.guest_mobile === p) { a.user_id = studentId; n++; }
    }
    return n;
  }
  const db = getSupabaseAdmin();
  if (!db) return 0;
  const { data } = await db
    .from("quiz_attempts")
    .update({ user_id: studentId, updated_at: new Date().toISOString() })
    .eq("guest_mobile", p)
    .is("user_id", null)
    .select("id");
  return (data as { id: string }[] | null)?.length ?? 0;
}
export async function addAttempt(input: Partial<QuizAttempt> & { quiz_id: string }): Promise<QuizAttempt> {
  const ts = new Date().toISOString();
  const row: QuizAttempt = {
    id: uuid(),
    quiz_id: input.quiz_id,
    user_id: input.user_id ?? null,
    guest_session_id: input.guest_session_id ?? null,
    guest_name: input.guest_name ?? null,
    guest_email: input.guest_email ?? null,
    guest_mobile: input.guest_mobile ?? null,
    status: input.status || "IN_PROGRESS",
    started_at: input.started_at || ts,
    submitted_at: input.submitted_at ?? null,
    expires_at: input.expires_at ?? null,
    time_taken_seconds: input.time_taken_seconds ?? null,
    score: input.score ?? 0,
    max_score: input.max_score ?? 0,
    correct_count: input.correct_count ?? 0,
    incorrect_count: input.incorrect_count ?? 0,
    unattempted_count: input.unattempted_count ?? 0,
    accuracy: input.accuracy ?? 0,
    negative_marks: input.negative_marks ?? 0,
    percentile: input.percentile ?? null,
    rank: input.rank ?? null,
    result_summary: input.result_summary || {},
    created_at: ts,
    updated_at: ts,
  };
  if (demoMode()) {
    mock.quizAttempts.unshift(row);
    return row;
  }
  return dbInsert<QuizAttempt>("quiz_attempts", row as unknown as Record<string, unknown>);
}
export async function updateAttempt(id: string, patch: Partial<QuizAttempt>): Promise<QuizAttempt | null> {
  const next = { ...patch, updated_at: new Date().toISOString() };
  if (demoMode()) {
    const idx = mock.quizAttempts.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    mock.quizAttempts[idx] = { ...mock.quizAttempts[idx], ...next };
    return mock.quizAttempts[idx];
  }
  return dbUpdate<QuizAttempt>("quiz_attempts", id, next as Record<string, unknown>);
}

// ----------------------------- Answers -----------------------------
export async function getAnswersByAttempt(attemptId: string): Promise<QuizAnswer[]> {
  if (demoMode()) return mock.quizAnswers.filter((a) => a.attempt_id === attemptId);
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("quiz_answers").select("*").eq("attempt_id", attemptId);
  return (data as QuizAnswer[]) ?? [];
}
export async function getAllAnswers(): Promise<QuizAnswer[]> {
  if (demoMode()) return [...mock.quizAnswers];
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("quiz_answers").select("*");
  return (data as QuizAnswer[]) ?? [];
}
/** Insert or update the answer for a given (attempt, question). */
export async function saveAnswer(input: Partial<QuizAnswer> & { attempt_id: string; question_id: string }): Promise<QuizAnswer> {
  const ts = new Date().toISOString();
  if (demoMode()) {
    const idx = mock.quizAnswers.findIndex((a) => a.attempt_id === input.attempt_id && a.question_id === input.question_id);
    if (idx !== -1) {
      mock.quizAnswers[idx] = { ...mock.quizAnswers[idx], ...input, updated_at: ts };
      return mock.quizAnswers[idx];
    }
    const row: QuizAnswer = {
      id: uuid(),
      attempt_id: input.attempt_id,
      quiz_id: input.quiz_id || "",
      question_id: input.question_id,
      selected_option: input.selected_option ?? null,
      is_correct: input.is_correct ?? false,
      is_unattempted: input.is_unattempted ?? true,
      marks_awarded: input.marks_awarded ?? 0,
      negative_marks_deducted: input.negative_marks_deducted ?? 0,
      time_spent_seconds: input.time_spent_seconds ?? null,
      marked_for_review: input.marked_for_review ?? false,
      answer_snapshot: input.answer_snapshot || {},
      created_at: ts,
      updated_at: ts,
    };
    mock.quizAnswers.push(row);
    return row;
  }
  const db = getSupabaseAdmin();
  if (!db) throw new Error("No database");
  const existing = await db
    .from("quiz_answers")
    .select("id")
    .eq("attempt_id", input.attempt_id)
    .eq("question_id", input.question_id)
    .maybeSingle();
  if (existing.data?.id) {
    const { data, error } = await db
      .from("quiz_answers")
      .update({ ...input, updated_at: ts })
      .eq("id", existing.data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as QuizAnswer;
  }
  const row = {
    id: uuid(),
    attempt_id: input.attempt_id,
    quiz_id: input.quiz_id || "",
    question_id: input.question_id,
    selected_option: input.selected_option ?? null,
    is_correct: input.is_correct ?? false,
    is_unattempted: input.is_unattempted ?? true,
    marks_awarded: input.marks_awarded ?? 0,
    negative_marks_deducted: input.negative_marks_deducted ?? 0,
    time_spent_seconds: input.time_spent_seconds ?? null,
    marked_for_review: input.marked_for_review ?? false,
    answer_snapshot: input.answer_snapshot || {},
    created_at: ts,
    updated_at: ts,
  };
  return dbInsert<QuizAnswer>("quiz_answers", row as unknown as Record<string, unknown>);
}

// ---------------------------- Import jobs --------------------------
export async function getImportJobs(): Promise<ImportJob[]> {
  if (demoMode()) return [...mock.importJobs];
  const rows = await dbSelect<ImportJob>("import_jobs");
  return rows.length ? rows : [];
}
export async function addImportJob(input: Partial<ImportJob>): Promise<ImportJob> {
  const row: ImportJob = {
    id: uuid(),
    type: input.type || "BULK_TEXT",
    source_config: input.source_config || {},
    status: input.status || "pending",
    total_rows: input.total_rows ?? 0,
    success_count: input.success_count ?? 0,
    error_count: input.error_count ?? 0,
    errors: input.errors || [],
    created_by: input.created_by ?? null,
    created_at: new Date().toISOString(),
  };
  if (demoMode()) {
    mock.importJobs.unshift(row);
    return row;
  }
  return dbInsert<ImportJob>("import_jobs", row as unknown as Record<string, unknown>);
}
export async function updateImportJob(id: string, patch: Partial<ImportJob>): Promise<ImportJob | null> {
  if (demoMode()) {
    const idx = mock.importJobs.findIndex((j) => j.id === id);
    if (idx === -1) return null;
    mock.importJobs[idx] = { ...mock.importJobs[idx], ...patch };
    return mock.importJobs[idx];
  }
  return dbUpdate<ImportJob>("import_jobs", id, patch as Record<string, unknown>);
}

// ========================= CURRENT AFFAIRS =========================

/** True when an article is publicly visible (published + not future-scheduled). */
export function isCaPublished(a: CaArticle | null | undefined): boolean {
  if (!a) return false;
  if (a.status !== "published") return false;
  if (a.publish_at && new Date(a.publish_at).getTime() > Date.now()) return false;
  return true;
}

// ---- Articles ----
export async function getCaArticles(): Promise<CaArticle[]> {
  if (demoMode()) return [...mock.caArticles];
  const db = getSupabaseAdmin();
  if (!db) return [...mock.caArticles];
  const { data } = await db.from("ca_articles").select("*").order("publish_at", { ascending: false, nullsFirst: false });
  return (data as CaArticle[]) ?? [];
}

/** Public list: published, not future, newest first. */
export async function getPublicCaArticles(): Promise<CaArticle[]> {
  const all = await getCaArticles();
  return all
    .filter(isCaPublished)
    .sort((a, b) => new Date(b.publish_at || b.created_at).getTime() - new Date(a.publish_at || a.created_at).getTime());
}

/** Returns the row regardless of status (admin/preview); callers gate on isCaPublished. */
export async function getCaArticleBySlug(slug: string): Promise<CaArticle | null> {
  const all = await getCaArticles();
  return all.find((a) => a.slug === slug) ?? null;
}

export async function getCaArticleById(id: string): Promise<CaArticle | null> {
  const all = await getCaArticles();
  return all.find((a) => a.id === id) ?? null;
}

export async function addCaArticle(input: Partial<CaArticle>): Promise<CaArticle> {
  const ts = new Date().toISOString();
  const row = {
    id: uuid(),
    slug: input.slug || slugify(input.title || "article"),
    title: input.title || "Untitled article",
    summary: input.summary || "",
    article_type: input.article_type || "daily",
    status: input.status || "draft",
    publish_at: input.publish_at ?? null,
    ca_date: input.ca_date ?? null,
    author: input.author ?? null,
    reading_time: input.reading_time ?? null,
    featured_image: input.featured_image ?? null,
    thumbnail_image: input.thumbnail_image ?? null,
    mobile_image: input.mobile_image ?? null,
    body_html: input.body_html ?? null,
    sections: input.sections ?? [],
    category_slug: input.category_slug ?? null,
    tags: input.tags ?? [],
    quick_revision: input.quick_revision ?? {},
    upsc: input.upsc ?? {},
    important: input.important ?? false,
    trending: input.trending ?? false,
    show_on_home: input.show_on_home ?? false,
    in_daily: input.in_daily ?? true,
    in_monthly: input.in_monthly ?? true,
    related_quiz_slug: input.related_quiz_slug ?? null,
    pdf_ids: input.pdf_ids ?? [],
    cross_sell: input.cross_sell ?? {},
    seo: input.seo ?? {},
    views: 0,
    created_at: ts,
    updated_at: ts,
  } as CaArticle;
  if (demoMode()) {
    mock.caArticles.unshift(row);
    return row;
  }
  return dbInsert<CaArticle>("ca_articles", row as unknown as Record<string, unknown>);
}

export async function updateCaArticle(id: string, patch: Partial<CaArticle>): Promise<CaArticle | null> {
  if (demoMode()) {
    const idx = mock.caArticles.findIndex((a) => a.id === id);
    if (idx === -1) return null;
    mock.caArticles[idx] = { ...mock.caArticles[idx], ...patch };
    return mock.caArticles[idx];
  }
  return dbUpdate<CaArticle>("ca_articles", id, patch as Record<string, unknown>);
}

export async function deleteCaArticle(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.caArticles.findIndex((a) => a.id === id);
    if (idx === -1) return false;
    mock.caArticles.splice(idx, 1);
    return true;
  }
  return dbDelete("ca_articles", id);
}

export async function incrementCaView(id: string): Promise<void> {
  if (demoMode()) {
    const a = mock.caArticles.find((x) => x.id === id);
    if (a) a.views += 1;
    return;
  }
  const db = getSupabaseAdmin();
  if (!db) return;
  try {
    const { data } = await db.from("ca_articles").select("views").eq("id", id).maybeSingle();
    const next = ((data?.views as number) ?? 0) + 1;
    await db.from("ca_articles").update({ views: next }).eq("id", id);
  } catch { /* best-effort */ }
}

// ---- Categories ----
export async function getCaCategories(): Promise<CaCategory[]> {
  if (demoMode()) return [...mock.caCategories];
  const db = getSupabaseAdmin();
  if (!db) return [...mock.caCategories];
  const { data } = await db.from("ca_categories").select("*").order("order", { ascending: true });
  return (data as CaCategory[]) ?? [];
}
export async function getCaCategoryBySlug(slug: string): Promise<CaCategory | null> {
  const all = await getCaCategories();
  return all.find((c) => c.slug === slug) ?? null;
}
export async function addCaCategory(input: Partial<CaCategory>): Promise<CaCategory> {
  const row = {
    id: uuid(),
    slug: input.slug || slugify(input.name || "category"),
    name: input.name || "Category",
    description: input.description ?? null,
    seo: input.seo ?? {},
    order: input.order ?? 0,
    created_at: new Date().toISOString(),
  } as CaCategory;
  if (demoMode()) {
    mock.caCategories.push(row);
    return row;
  }
  return dbInsert<CaCategory>("ca_categories", row as unknown as Record<string, unknown>);
}
export async function updateCaCategory(id: string, patch: Partial<CaCategory>): Promise<CaCategory | null> {
  if (demoMode()) {
    const idx = mock.caCategories.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    mock.caCategories[idx] = { ...mock.caCategories[idx], ...patch };
    return mock.caCategories[idx];
  }
  return dbUpdate<CaCategory>("ca_categories", id, patch as Record<string, unknown>);
}
export async function deleteCaCategory(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.caCategories.findIndex((c) => c.id === id);
    if (idx === -1) return false;
    mock.caCategories.splice(idx, 1);
    return true;
  }
  return dbDelete("ca_categories", id);
}

// ---- Tags ----
export async function getCaTags(): Promise<CaTag[]> {
  if (demoMode()) return [...mock.caTags];
  const db = getSupabaseAdmin();
  if (!db) return [...mock.caTags];
  const { data } = await db.from("ca_tags").select("*").order("name", { ascending: true });
  return (data as CaTag[]) ?? [];
}
export async function getCaTagBySlug(slug: string): Promise<CaTag | null> {
  const all = await getCaTags();
  return all.find((t) => t.slug === slug) ?? null;
}
export async function addCaTag(input: Partial<CaTag>): Promise<CaTag> {
  const row = {
    id: uuid(),
    slug: input.slug || slugify(input.name || "tag"),
    name: input.name || "Tag",
    seo: input.seo ?? {},
    created_at: new Date().toISOString(),
  } as CaTag;
  if (demoMode()) {
    mock.caTags.push(row);
    return row;
  }
  return dbInsert<CaTag>("ca_tags", row as unknown as Record<string, unknown>);
}
export async function updateCaTag(id: string, patch: Partial<CaTag>): Promise<CaTag | null> {
  if (demoMode()) {
    const idx = mock.caTags.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    mock.caTags[idx] = { ...mock.caTags[idx], ...patch };
    return mock.caTags[idx];
  }
  return dbUpdate<CaTag>("ca_tags", id, patch as Record<string, unknown>);
}
export async function deleteCaTag(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.caTags.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    mock.caTags.splice(idx, 1);
    return true;
  }
  return dbDelete("ca_tags", id);
}

// ---- PDF library ----
export async function getCaPdfs(): Promise<CaPdf[]> {
  if (demoMode()) return [...mock.caPdfs];
  const db = getSupabaseAdmin();
  if (!db) return [...mock.caPdfs];
  const { data } = await db.from("ca_pdfs").select("*").order("created_at", { ascending: false });
  return (data as CaPdf[]) ?? [];
}
export async function getCaPdfById(id: string): Promise<CaPdf | null> {
  const all = await getCaPdfs();
  return all.find((p) => p.id === id) ?? null;
}
/**
 * Public-facing PDFs of a given kind. A PDF is "published" once it has a file
 * attached; placeholder records (no file_url) stay hidden from the front end.
 * Ordered by date_ref desc (newest day/month first), then created_at.
 */
export async function getPublicCaPdfsByKind(kind: CaPdf["kind"]): Promise<CaPdf[]> {
  const all = await getCaPdfs();
  return all
    .filter((p) => p.kind === kind && !!p.file_url)
    .sort((a, b) => {
      const da = a.date_ref || a.created_at;
      const db2 = b.date_ref || b.created_at;
      return da < db2 ? 1 : da > db2 ? -1 : 0;
    });
}
export async function addCaPdf(input: Partial<CaPdf>): Promise<CaPdf> {
  const ts = new Date().toISOString();
  const row = {
    id: uuid(),
    title: input.title || "Untitled PDF",
    kind: input.kind || "general",
    date_ref: input.date_ref ?? null,
    category_slug: input.category_slug ?? null,
    file_url: input.file_url ?? null,
    cover_image: input.cover_image ?? null,
    description: input.description ?? null,
    is_free: input.is_free ?? true,
    requires_login: input.requires_login ?? false,
    requires_lead: input.requires_lead ?? false,
    generated: input.generated ?? false,
    download_count: 0,
    created_at: ts,
    updated_at: ts,
  } as CaPdf;
  if (demoMode()) {
    mock.caPdfs.unshift(row);
    return row;
  }
  return dbInsert<CaPdf>("ca_pdfs", row as unknown as Record<string, unknown>);
}
export async function updateCaPdf(id: string, patch: Partial<CaPdf>): Promise<CaPdf | null> {
  if (demoMode()) {
    const idx = mock.caPdfs.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    mock.caPdfs[idx] = { ...mock.caPdfs[idx], ...patch };
    return mock.caPdfs[idx];
  }
  return dbUpdate<CaPdf>("ca_pdfs", id, { ...patch, updated_at: new Date().toISOString() } as Record<string, unknown>);
}
export async function deleteCaPdf(id: string): Promise<boolean> {
  if (demoMode()) {
    const idx = mock.caPdfs.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    mock.caPdfs.splice(idx, 1);
    return true;
  }
  return dbDelete("ca_pdfs", id);
}
export async function incrementCaPdfDownload(id: string): Promise<void> {
  if (demoMode()) {
    const p = mock.caPdfs.find((x) => x.id === id);
    if (p) p.download_count += 1;
    return;
  }
  const db = getSupabaseAdmin();
  if (!db) return;
  try {
    const { data } = await db.from("ca_pdfs").select("download_count").eq("id", id).maybeSingle();
    const next = ((data?.download_count as number) ?? 0) + 1;
    await db.from("ca_pdfs").update({ download_count: next }).eq("id", id);
  } catch { /* best-effort */ }
}

// ---- Leads ----
export async function addCaLead(input: Partial<CaLead>): Promise<CaLead> {
  const row = {
    id: uuid(),
    phone: input.phone || "",
    name: input.name ?? null,
    source: input.source ?? null,
    city: input.city ?? null,
    target_year: input.target_year ?? null,
    interested_course: input.interested_course ?? null,
    created_at: new Date().toISOString(),
  } as CaLead;
  if (demoMode()) return row;
  return dbInsert<CaLead>("ca_leads", row as unknown as Record<string, unknown>);
}
export async function getCaLeads(): Promise<CaLead[]> {
  if (demoMode()) return [];
  const rows = await dbSelect<CaLead>("ca_leads");
  return rows;
}

// ---- Bookmarks (any logged-in user, keyed by phone) ----
export async function getCaBookmarkSlugs(phone: string): Promise<string[]> {
  const p = (phone || "").trim();
  if (!p || demoMode()) return [];
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db.from("ca_bookmarks").select("article_slug").eq("user_phone", p);
  return ((data as { article_slug: string }[]) ?? []).map((r) => r.article_slug);
}
export async function isCaBookmarked(phone: string, slug: string): Promise<boolean> {
  const slugs = await getCaBookmarkSlugs(phone);
  return slugs.includes(slug);
}
/** Toggle a bookmark; returns the new state. */
export async function toggleCaBookmark(phone: string, slug: string): Promise<boolean> {
  const p = (phone || "").trim();
  if (!p || !slug || demoMode()) return false;
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { data } = await db.from("ca_bookmarks").select("id").eq("user_phone", p).eq("article_slug", slug).maybeSingle();
  if (data?.id) {
    await db.from("ca_bookmarks").delete().eq("id", data.id as string);
    return false;
  }
  await db.from("ca_bookmarks").insert({ id: uuid(), user_phone: p, article_slug: slug });
  return true;
}

// ---- Analytics events ----
export async function logCaEvent(type: CaEventType, ref?: string | null): Promise<void> {
  if (demoMode()) return;
  const db = getSupabaseAdmin();
  if (!db) return;
  try {
    await db.from("ca_events").insert({ id: uuid(), type, ref: ref ?? null });
  } catch { /* best-effort */ }
}
export async function getCaEvents(): Promise<CaEvent[]> {
  if (demoMode()) return [];
  const rows = await dbSelect<CaEvent>("ca_events");
  return rows;
}
