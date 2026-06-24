import { NextResponse } from "next/server";
import { getAllQuizzes, getAttemptsByUser, getEnrollments, getStudentById } from "@/lib/dataProvider";
import { getStudentSession } from "@/lib/session";
import { checkQuizAccess } from "@/lib/quizAccess";
import { studentAccessActive } from "@/lib/studentAccess";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getStudentSession();
    if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const [all, attempts, enrollments, liveStudent] = await Promise.all([
      getAllQuizzes(),
      getAttemptsByUser(session.student_id),
      getEnrollments(session.student_id),
      getStudentById(session.student_id),
    ]);
    const liveActive = liveStudent ? studentAccessActive(liveStudent) : undefined;

    const published = all.filter((q) => q.status === "published");
    const attemptsByQuiz = new Map<string, typeof attempts>();
    for (const a of attempts) {
      const arr = attemptsByQuiz.get(a.quiz_id) || [];
      arr.push(a);
      attemptsByQuiz.set(a.quiz_id, arr);
    }

    const quizzes = published
      .map((q) => {
        const access = checkQuizAccess(q, session, enrollments, liveActive);
        const mine = attemptsByQuiz.get(q.id) || [];
        const finalized = mine.filter((a) => a.status !== "IN_PROGRESS");
        const inProgress = mine.find((a) => a.status === "IN_PROGRESS");
        const best = finalized.reduce((m, a) => Math.max(m, a.score), 0);
        return {
          id: q.id, title: q.title, slug: q.slug, subject: q.subject, topic: q.topic,
          difficulty: q.difficulty, type: q.type, time_limit_minutes: q.time_limit_minutes,
          requires_payment: q.requires_payment, is_public: q.is_public,
          accessible: access.ok || q.is_public,
          access_reason: access.ok ? null : access.reason,
          attempts: finalized.length,
          best_score: finalized.length ? best : null,
          in_progress: !!inProgress,
        };
      })
      .filter((q) => q.accessible || q.requires_payment); // show paid ones as locked too

    // Analytics over finalized attempts.
    const finalized = attempts.filter((a) => a.status !== "IN_PROGRESS");
    const totalAttempts = finalized.length;
    const avgScore = totalAttempts ? finalized.reduce((s, a) => s + a.score, 0) / totalAttempts : 0;
    const avgAccuracy = totalAttempts ? finalized.reduce((s, a) => s + a.accuracy, 0) / totalAttempts : 0;
    const bestScore = finalized.reduce((m, a) => Math.max(m, a.score), 0);

    // Topic aggregation for weak areas.
    const topicMap = new Map<string, { correct: number; total: number }>();
    for (const a of finalized) {
      const tb = (a.result_summary?.topic_breakdown as { label: string; correct: number; incorrect: number; total: number }[]) || [];
      for (const t of tb) {
        const cur = topicMap.get(t.label) || { correct: 0, total: 0 };
        cur.correct += t.correct;
        cur.total += t.correct + t.incorrect;
        topicMap.set(t.label, cur);
      }
    }
    const topics = [...topicMap.entries()].map(([label, v]) => ({ label, accuracy: v.total ? Math.round((v.correct / v.total) * 100) : 0, total: v.total }));
    const weakAreas = [...topics].filter((t) => t.total >= 2).sort((a, b) => a.accuracy - b.accuracy).slice(0, 5);

    const recent = finalized
      .slice(0, 8)
      .map((a) => {
        const quiz = published.find((q) => q.id === a.quiz_id);
        return { attemptId: a.id, slug: quiz?.slug || "", title: quiz?.title || "Quiz", score: a.score, max_score: a.max_score, accuracy: a.accuracy, submitted_at: a.submitted_at };
      });

    return NextResponse.json({
      ok: true,
      quizzes,
      analytics: {
        totalAttempts,
        avgScore: Math.round(avgScore * 10) / 10,
        avgAccuracy: Math.round(avgAccuracy),
        bestScore,
        topics,
        weakAreas,
      },
      recent,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load dashboard.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
