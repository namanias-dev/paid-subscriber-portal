import { getCourseContent, getClassHubViews, getAllQuizzes, getAllCourses, getPublishedContent, getAttemptsByUser, getCourseEnrollmentsByPhone, getAccessOverridesByPhone, getLectureProgressByLearner } from "./dataProvider";
import { quizUnlockCourseIds, canAccessLecture, type Learner, type LectureAccess } from "./entitlements";
import { getAttemptStatusForLearner } from "./quizAttemptStatus";
import { assembleClassHubSections, totalNewCount, type ClassHubSection } from "./classHub";
import { buildPerformanceData, PERFORMANCE_SECTION, type PerformanceData } from "./performance";
import { r2Configured, signGetUrl } from "./r2";
import type { Course, ContentItem, Quiz, ClassHubView } from "./types";

/** Short, calm chip text for a hosted lecture's access state. */
function accessChip(a: LectureAccess): string | null {
  switch (a.status) {
    case "public": return null;
    case "active": return a.expiresAt ? `Renews ${new Date(a.expiresAt).toLocaleDateString("en-IN")}` : "Access active";
    case "expiring": return a.daysLeft != null ? `Expires in ${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"}` : "Expiring soon";
    case "grace": return a.daysLeft != null ? `Complete installment in ${a.daysLeft} day${a.daysLeft === 1 ? "" : "s"}` : "Installment due";
    case "blocked": return a.reason === "overdue" ? "Locked — complete pending installment" : a.reason === "expired" ? "Access expired" : "Locked";
    case "login": return "Log in to watch";
    default: return null;
  }
}

function assignedTo(item: ContentItem, courseId: string): boolean {
  const ids = item.course_ids && item.course_ids.length ? item.course_ids : item.course_id ? [item.course_id] : [];
  return ids.includes(courseId);
}

/** Quizzes available in a course's Class Hub: free public + paid this course unlocks. */
function availableQuizzesForCourse(published: Quiz[], courseId: string, courses: Course[]): Quiz[] {
  return published.filter((q) =>
    q.requires_payment ? quizUnlockCourseIds(q, courses).includes(courseId) : q.is_public,
  );
}

/** Count newly-available quizzes since the learner last opened the Performance tab. */
function newQuizCount(available: Quiz[], views: ClassHubView[], courseId: string): number {
  const seen = views.find((v) => v.course_id === courseId && v.section === PERFORMANCE_SECTION);
  const seenMs = seen ? Date.parse(seen.last_seen_at) || 0 : 0;
  return available.filter((q) => (Date.parse(q.created_at) || 0) > seenMs).length;
}

/**
 * Server-side assembly of a batch's Class Hub content sections — reused by the
 * student dashboard and buyer portal Class Hub pages. Pulls assigned content +
 * the student's last-seen rows, then groups/gates/flags via lib/classHub.
 * (Interactive quizzes live in the Performance dashboard, not here.)
 */
export async function getClassHubSectionsForCourse(
  courseId: string,
  learner: Learner | null,
): Promise<ClassHubSection[]> {
  const [items, views] = await Promise.all([
    getCourseContent(courseId),
    learner?.studentId ? getClassHubViews(learner.studentId) : Promise.resolve([]),
  ]);
  const sections = assembleClassHubSections({ items, courseId, views });
  await enrichHostedLectures(sections, items, learner);
  return sections;
}

/**
 * Enrich recording cards: a signed (short-lived) thumbnail for ANY recording
 * with an uploaded thumbnail (hosted or external custom), plus — for hosted
 * lectures — watch progress and an access chip reusing canAccessLecture
 * (installment/expiry) so the list mirrors playback gating. No video bytes here.
 */
async function enrichHostedLectures(
  sections: ClassHubSection[],
  items: ContentItem[],
  learner: Learner | null,
): Promise<void> {
  const recItems = sections.flatMap((s) => s.items).filter((it) => it.type === "recording" || it.type === "live_link");
  if (recItems.length === 0) return;
  const recById = new Map(items.map((i) => [i.id, i]));
  const hasHosted = recItems.some((it) => it.hosted);

  // Only pay for entitlement/progress lookups when there are hosted lectures.
  const [courses, enrollments, overrides, progress] = hasHosted
    ? await Promise.all([
        getAllCourses(),
        learner ? getCourseEnrollmentsByPhone(learner.phone) : Promise.resolve([]),
        learner ? getAccessOverridesByPhone(learner.phone) : Promise.resolve([]),
        learner?.studentId ? getLectureProgressByLearner(learner.studentId) : Promise.resolve([]),
      ])
    : [[], [], [], []];
  const progById = new Map(progress.map((p) => [p.recording_id, p]));

  await Promise.all(
    recItems.map(async (it) => {
      const rec = recById.get(it.id);
      if (!rec) return;

      // Uploaded thumbnail (works for hosted + external custom). YouTube cards
      // derive their own thumbnail client-side; Drive/Telegram use the fallback.
      if (rec.thumbnail_key && r2Configured()) {
        it.thumbnailUrl = (await signGetUrl(rec.thumbnail_key, 3600).catch(() => null)) ?? it.thumbnailUrl ?? null;
      }

      if (it.hosted && rec.upload_status === "completed") {
        const access = canAccessLecture(learner, rec, { courses, enrollments, overrides });
        it.accessBlocked = !access.allowed;
        it.accessLabel = accessChip(access);
        if (!access.allowed) it.link = null; // gate the card (player also re-checks)

        const prog = progById.get(it.id);
        if (prog) {
          it.completed = prog.completed;
          const dur = rec.duration_seconds || it.durationSeconds || 0;
          it.progressPct = dur > 0 ? Math.min(100, Math.round((prog.last_position_seconds / dur) * 100)) : 0;
        }
      }
    }),
  );
}

/**
 * Assemble the student Performance dashboard for one batch's Class Hub. Reuses
 * the entitlement engine (available quizzes), the shared attempt-status piece,
 * the learner's stored attempts (analytics + reviewable history) and the
 * class_hub_views last-seen system (NEW badge). Pure aggregation in lib/performance.
 */
export async function getClassHubPerformance(
  courseId: string,
  learner: Learner | null,
  courses: Course[],
): Promise<PerformanceData> {
  const empty = buildPerformanceData({ attempts: [], quizById: new Map(), available: [], attemptStatus: {}, views: [], courseId });
  if (!learner?.studentId) return empty;

  const [allQuizzes, attempts, attemptStatus, views] = await Promise.all([
    getAllQuizzes(),
    getAttemptsByUser(learner.studentId),
    getAttemptStatusForLearner(learner),
    getClassHubViews(learner.studentId),
  ]);

  const published = allQuizzes.filter((q) => q.status === "published");
  const available = availableQuizzesForCourse(published, courseId, courses);
  const quizById = new Map(allQuizzes.map((q) => [q.id, q]));

  return buildPerformanceData({ attempts, quizById, available, attemptStatus, views, courseId });
}

/**
 * Per-course "new content" counts for a learner across all their accessible
 * courses — single batched fetch. Powers Class Hub / My Courses entry-point dots.
 */
export async function getNewCountsForLearner(learner: Learner | null): Promise<Record<string, number>> {
  if (!learner?.studentId || learner.courseIds.length === 0) return {};
  const [courses, content, views, allQuizzes] = await Promise.all([
    getAllCourses(),
    getPublishedContent(),
    getClassHubViews(learner.studentId),
    getAllQuizzes(),
  ]);
  const published = allQuizzes.filter((q) => q.status === "published");
  const counts: Record<string, number> = {};
  for (const courseId of learner.courseIds) {
    const items = content.filter((c) => assignedTo(c, courseId));
    const sections = assembleClassHubSections({ items, courseId, views });
    const available = availableQuizzesForCourse(published, courseId, courses);
    const n = totalNewCount(sections) + newQuizCount(available, views, courseId);
    if (n > 0) counts[courseId] = n;
  }
  return counts;
}
