import { NextResponse } from "next/server";
import { resolveLearner } from "@/lib/entitlements";
import {
  getAllCourses, getAllQuizzes, getAttemptsByUser, getAnswersByAttemptIds,
  getStudents, getAllCourseEnrollments, getAttemptsByUserIds, getLeaderboardSettings,
} from "@/lib/dataProvider";
import { buildOverallPerformance } from "@/lib/overallPerformance";
import { buildStudentBatchComparison, chooseStudentBatchKey, type StudentBatchComparison } from "@/lib/studentCohort";
import { leaderboardBatchKey } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

/**
 * Read-only aggregate of the signed-in learner's ENTIRE quiz history for the
 * Class Hub "Overall Performance" tab. Scoped to the caller's own attempts
 * (getAttemptsByUser(studentId)); `courseId` only supplies the batch label in
 * the snapshot header. Fetched lazily when the tab opens so the Class Hub page
 * load stays light. Never mutates anything.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const courseId = searchParams.get("courseId") || "";
    const learner = await resolveLearner();

    if (!learner?.studentId) {
      return NextResponse.json({
        ok: true,
        overall: buildOverallPerformance({
          attempts: [],
          quizById: new Map(),
          answers: [],
          studentName: learner?.name ?? "Student",
          batchLabel: "",
        }),
        cohort: buildStudentBatchComparison({
          learnerStudentId: null,
          learnerPhone: "",
          students: [],
          enrollments: [],
          attempts: [],
          quizById: new Map(),
        }),
      });
    }

    const [courses, allQuizzes, attempts, students, enrollments, settings] = await Promise.all([
      getAllCourses(),
      getAllQuizzes(),
      getAttemptsByUser(learner.studentId),
      getStudents(),
      getAllCourseEnrollments(),
      getLeaderboardSettings(),
    ]);

    const quizById = new Map(allQuizzes.map((q) => [q.id, q]));
    const batchLabel = courses.find((c) => c.id === courseId)?.title ?? "";

    const finishedIds = attempts.filter((a) => a.status !== "IN_PROGRESS").map((a) => a.id);
    const answers = finishedIds.length ? await getAnswersByAttemptIds(finishedIds) : [];

    const overall = buildOverallPerformance({
      attempts,
      quizById,
      answers,
      studentName: learner.name,
      batchLabel,
    });

    // "You vs your batch" — anonymous aggregates + the caller's own position only.
    // Batch is derived SERVER-SIDE from the caller's own enrollments (courseId only
    // picks among their batches). We pull ONLY the batch roster's attempts (one
    // batched query) so the cohort's Reliability ranking / classAverage / score
    // bands are computed with the SAME buildLeaderboard the admin view uses.
    let cohort: StudentBatchComparison;
    const batchKey = chooseStudentBatchKey(enrollments, learner.phone, courseId);
    if (batchKey) {
      const norm = (p: string | null | undefined) => (p || "").trim();
      const phonesInBatch = new Set(
        enrollments
          .filter((e) => e.course_id && leaderboardBatchKey(e.course_id, e.batch_label) === batchKey)
          .map((e) => norm(e.phone)),
      );
      const rosterIds = students.filter((s) => phonesInBatch.has(norm(s.phone))).map((s) => s.id);
      const rosterAttempts = rosterIds.length ? await getAttemptsByUserIds(rosterIds) : [];
      cohort = buildStudentBatchComparison({
        learnerStudentId: learner.studentId,
        learnerPhone: learner.phone,
        preferCourseId: courseId,
        students,
        enrollments,
        attempts: rosterAttempts,
        quizById,
        excludedStudentIds: settings.excludedStudentIds,
        reliabilityC: settings.reliabilityC,
      });
    } else {
      cohort = buildStudentBatchComparison({
        learnerStudentId: learner.studentId,
        learnerPhone: learner.phone,
        preferCourseId: courseId,
        students,
        enrollments,
        attempts: [],
        quizById,
        excludedStudentIds: settings.excludedStudentIds,
        reliabilityC: settings.reliabilityC,
      });
    }

    return NextResponse.json({ ok: true, overall, cohort });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load performance.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
