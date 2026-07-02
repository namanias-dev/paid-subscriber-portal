import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getStudents, getAllCourseEnrollments, getAllQuizzes, getAttemptsByUserIds } from "@/lib/dataProvider";
import { buildLeaderboard } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

/**
 * Batch roster & leaderboard — bulk per-student aggregation across a batch (or
 * all batches). Rosters + batches resolve from students + course_enrollments;
 * attempts are pulled in ONE batched query and grouped in memory (never N+1).
 * Every row uses the SAME buildOverallPerformance as the per-student dashboard
 * so figures match exactly. Role-gated server-side (403 for non-privileged).
 */
export async function GET(req: Request) {
  try {
    if (!(await requirePermission("manage_students_leads"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const courseId = searchParams.get("courseId") || null;

    const [students, enrollments, allQuizzes] = await Promise.all([
      getStudents(),
      getAllCourseEnrollments(),
      getAllQuizzes(),
    ]);

    const quizById = new Map(allQuizzes.map((q) => [q.id, q]));

    // Roster for the active view → the only user_ids we pull attempts for.
    const norm = (p: string | null | undefined) => (p || "").trim();
    const phonesInBatch = new Set(
      courseId
        ? enrollments.filter((e) => e.course_id === courseId).map((e) => norm(e.phone))
        : students.map((s) => norm(s.phone)),
    );
    const rosterIds = students.filter((s) => phonesInBatch.has(norm(s.phone))).map((s) => s.id);

    const attempts = rosterIds.length ? await getAttemptsByUserIds(rosterIds) : [];

    const result = buildLeaderboard({ students, enrollments, attempts, quizById, courseId });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load leaderboard.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
