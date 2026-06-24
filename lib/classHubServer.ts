import { getCourseContent, getClassHubViews, getAllQuizzes, getAllCourses, getPublishedContent, getAttemptsByUser } from "./dataProvider";
import { quizUnlockCourseIds, type Learner } from "./entitlements";
import { getAttemptStatusForLearner } from "./quizAttemptStatus";
import { assembleClassHubSections, totalNewCount, type ClassHubSection } from "./classHub";
import { buildPerformanceData, PERFORMANCE_SECTION, type PerformanceData } from "./performance";
import type { Course, ContentItem, Quiz, ClassHubView } from "./types";

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
  return assembleClassHubSections({ items, courseId, views });
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
