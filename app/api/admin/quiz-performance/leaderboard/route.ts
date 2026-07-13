import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getStudents, getAllCourseEnrollments, getAllQuizzes, getAttemptsByUserIds, getLeaderboardSettings } from "@/lib/dataProvider";
import { buildLeaderboard, leaderboardBatchKey } from "@/lib/leaderboard";

export const dynamic = "force-dynamic";

/**
 * Batch roster & leaderboard — bulk per-student aggregation across a batch (or
 * all batches). Rosters + batches resolve from students + course_enrollments;
 * attempts are pulled in ONE batched query and grouped in memory (never N+1).
 * Every row uses the SAME buildOverallPerformance as the per-student dashboard
 * so figures match exactly. Role-gated server-side (403 for non-privileged).
 *
 * Filters (all combine): ?quizId=<quiz> · ?batch=<BatchOption.key> (course +
 * batch_label). The GLOBAL admin exclude list + tuned Reliability C are read
 * from the single persisted config (getLeaderboardSettings) so admin and any
 * student-facing leaderboard always agree.
 */
export async function GET(req: Request) {
  try {
    if (!(await requirePermission("manage_students_leads"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    // Back-compat: an old `courseId` param still works as a course-level batch.
    const batchKey = searchParams.get("batch") || searchParams.get("courseId") || null;
    const quizId = searchParams.get("quizId") || null;

    const [students, enrollments, allQuizzes, settings] = await Promise.all([
      getStudents(),
      getAllCourseEnrollments(),
      getAllQuizzes(),
      getLeaderboardSettings(),
    ]);

    const quizById = new Map(allQuizzes.map((q) => [q.id, q]));

    // Roster for the active batch → the only user_ids we pull attempts for.
    const norm = (p: string | null | undefined) => (p || "").trim();
    const phonesInBatch = new Set(
      batchKey
        ? enrollments.filter((e) => e.course_id && leaderboardBatchKey(e.course_id, e.batch_label) === batchKey).map((e) => norm(e.phone))
        : students.map((s) => norm(s.phone)),
    );
    const rosterIds = students.filter((s) => phonesInBatch.has(norm(s.phone))).map((s) => s.id);

    const attempts = rosterIds.length ? await getAttemptsByUserIds(rosterIds) : [];

    const result = buildLeaderboard({
      students, enrollments, attempts, quizById,
      batchKey, quizId,
      excludedStudentIds: settings.excludedStudentIds,
      reliabilityC: settings.reliabilityC,
    });

    // Quiz filter options — real published quizzes only (dropdown source).
    const quizzes = allQuizzes
      .filter((q) => q.status === "published")
      .map((q) => ({ id: q.id, title: q.title || "Untitled Quiz" }))
      .sort((a, b) => a.title.localeCompare(b.title));

    return NextResponse.json({ ok: true, ...result, quizzes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load leaderboard.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
