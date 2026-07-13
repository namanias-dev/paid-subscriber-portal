import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import {
  getStudentById, getAllQuizzes, getAttemptsByUser, getAnswersByAttemptIds,
  getCourseEnrollmentsByPhone, getStudents, getAllCourseEnrollments,
  getAttemptsByUserIds, getLeaderboardSettings,
} from "@/lib/dataProvider";
import { buildOverallPerformance } from "@/lib/overallPerformance";
import { leaderboardBatchKey } from "@/lib/leaderboard";
import { buildFacultyStudentComparison, chooseStudentBatchKey } from "@/lib/studentCohort";

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
    // Cohort scope carried from the leaderboard: "all" ⇒ all batches; a batch key
    // ⇒ that batch; absent ⇒ derive the student's primary batch (direct entry).
    const batchScope = searchParams.get("batchScope");
    const quizId = searchParams.get("quizId") || null;

    const student = await getStudentById(studentId);
    if (!student) return NextResponse.json({ ok: false, error: "Student not found" }, { status: 404 });

    const [allQuizzes, attempts, enrollments, students, allEnrollments, settings] = await Promise.all([
      getAllQuizzes(),
      getAttemptsByUser(student.id),
      getCourseEnrollmentsByPhone(student.phone).catch(() => []),
      getStudents(),
      getAllCourseEnrollments(),
      getLeaderboardSettings(),
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

    // Faculty comparison (honest, no suppression). Resolve the cohort scope, pull
    // ONLY that roster's attempts in one batched query, then reuse buildLeaderboard.
    const norm = (p: string | null | undefined) => (p || "").trim();
    let batchKey: string | null;
    if (batchScope === "all") batchKey = null;
    else if (batchScope) batchKey = batchScope;
    else batchKey = chooseStudentBatchKey(allEnrollments, student.phone); // may be null ⇒ all

    const phonesInScope = new Set(
      batchKey
        ? allEnrollments.filter((e) => e.course_id && leaderboardBatchKey(e.course_id, e.batch_label) === batchKey).map((e) => norm(e.phone))
        : students.map((s) => norm(s.phone)),
    );
    const rosterIds = students.filter((s) => phonesInScope.has(norm(s.phone))).map((s) => s.id);
    const rosterAttempts = rosterIds.length ? await getAttemptsByUserIds(rosterIds) : [];

    const facultyCohort = buildFacultyStudentComparison({
      studentId: student.id,
      studentAttempts: attempts,
      batchKey,
      quizId,
      quizTitle: quizId ? quizById.get(quizId)?.title ?? null : null,
      students,
      enrollments: allEnrollments,
      attempts: rosterAttempts,
      quizById,
      excludedStudentIds: settings.excludedStudentIds,
      reliabilityC: settings.reliabilityC,
    });

    return NextResponse.json({ ok: true, overall, cohort: facultyCohort });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load performance.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
