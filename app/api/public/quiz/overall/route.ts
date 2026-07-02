import { NextResponse } from "next/server";
import { resolveLearner } from "@/lib/entitlements";
import { getAllCourses, getAllQuizzes, getAttemptsByUser, getAnswersByAttemptIds } from "@/lib/dataProvider";
import { buildOverallPerformance } from "@/lib/overallPerformance";

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
      });
    }

    const [courses, allQuizzes, attempts] = await Promise.all([
      getAllCourses(),
      getAllQuizzes(),
      getAttemptsByUser(learner.studentId),
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

    return NextResponse.json({ ok: true, overall });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load performance.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
