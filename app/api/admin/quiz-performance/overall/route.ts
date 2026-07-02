import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import {
  getStudentById, getAllQuizzes, getAttemptsByUser, getAnswersByAttemptIds,
  getCourseEnrollmentsByPhone,
} from "@/lib/dataProvider";
import { buildOverallPerformance } from "@/lib/overallPerformance";

export const dynamic = "force-dynamic";

/**
 * Faculty/admin view of ONE student's Overall Performance — the SAME aggregate
 * (buildOverallPerformance) the student sees on their own dashboard, keyed by
 * studentId (never name). Role-gated server-side: non-privileged callers get 403.
 * Read-only.
 */
export async function GET(req: Request) {
  try {
    if (!(await requirePermission("manage_students_leads"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const studentId = searchParams.get("studentId") || "";
    if (!studentId) return NextResponse.json({ ok: false, error: "Missing studentId" }, { status: 400 });

    const student = await getStudentById(studentId);
    if (!student) return NextResponse.json({ ok: false, error: "Student not found" }, { status: 404 });

    const [allQuizzes, attempts, enrollments] = await Promise.all([
      getAllQuizzes(),
      getAttemptsByUser(student.id),
      getCourseEnrollmentsByPhone(student.phone).catch(() => []),
    ]);

    const quizById = new Map(allQuizzes.map((q) => [q.id, q]));
    const batchLabel = enrollments[0]?.course_title || enrollments[0]?.batch_label || "";

    const finishedIds = attempts.filter((a) => a.status !== "IN_PROGRESS").map((a) => a.id);
    const answers = finishedIds.length ? await getAnswersByAttemptIds(finishedIds) : [];

    const overall = buildOverallPerformance({
      attempts,
      quizById,
      answers,
      studentName: student.name,
      batchLabel,
    });

    return NextResponse.json({ ok: true, overall });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load performance.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
