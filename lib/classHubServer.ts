import { getCourseContent, getClassHubViews, getAllQuizzes, getAllCourses, getPublishedContent } from "./dataProvider";
import { quizUnlockCourseIds, type Learner } from "./entitlements";
import { assembleClassHubSections, totalNewCount, type ClassHubSection } from "./classHub";
import type { Course, ContentItem } from "./types";

function assignedTo(item: ContentItem, courseId: string): boolean {
  const ids = item.course_ids && item.course_ids.length ? item.course_ids : item.course_id ? [item.course_id] : [];
  return ids.includes(courseId);
}

/**
 * Server-side assembly of a batch's Class Hub sections — reused by the student
 * dashboard and buyer portal Class Hub pages. Pulls assigned content + the
 * student's last-seen rows + course-unlocked quizzes (via lib/entitlements),
 * then groups/gates/flags them via lib/classHub (the single source of truth).
 */
export async function getClassHubSectionsForCourse(
  courseId: string,
  learner: Learner | null,
  courses: Course[],
): Promise<ClassHubSection[]> {
  const [items, views, allQuizzes] = await Promise.all([
    getCourseContent(courseId),
    learner?.studentId ? getClassHubViews(learner.studentId) : Promise.resolve([]),
    getAllQuizzes(),
  ]);

  const quizzes = allQuizzes
    .filter((q) => q.status === "published" && quizUnlockCourseIds(q, courses).includes(courseId))
    .map((q) => ({ id: q.id, title: q.title, slug: q.slug, subject: q.subject ?? null, created_at: q.created_at }));

  return assembleClassHubSections({ items, quizzes, courseId, views });
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
  const counts: Record<string, number> = {};
  for (const courseId of learner.courseIds) {
    const items = content.filter((c) => assignedTo(c, courseId));
    const quizzes = allQuizzes
      .filter((q) => q.status === "published" && quizUnlockCourseIds(q, courses).includes(courseId))
      .map((q) => ({ id: q.id, title: q.title, slug: q.slug, subject: q.subject ?? null, created_at: q.created_at }));
    const sections = assembleClassHubSections({ items, quizzes, courseId, views });
    const n = totalNewCount(sections);
    if (n > 0) counts[courseId] = n;
  }
  return counts;
}
