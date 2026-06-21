import { NextResponse } from "next/server";
import { getAllQuizzes, getAllAttempts, getAllAnswers, getAttemptsByQuiz, getAnswersByAttempt } from "@/lib/dataProvider";
import { requireAdmin } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const quizId = searchParams.get("quizId");

    const quizzes = await getAllQuizzes();
    const quizMap = new Map(quizzes.map((q) => [q.id, q]));

    // Per-quiz drilldown.
    if (quizId) {
      const attempts = await getAttemptsByQuiz(quizId);
      const finalized = attempts.filter((a) => a.status !== "IN_PROGRESS");
      const rows = await Promise.all(
        attempts.slice(0, 500).map(async (a) => ({
          id: a.id,
          name: a.guest_name || a.user_id || "Guest",
          mobile: a.guest_mobile,
          email: a.guest_email,
          status: a.status,
          score: a.score,
          max_score: a.max_score,
          accuracy: a.accuracy,
          time_taken_seconds: a.time_taken_seconds,
          submitted_at: a.submitted_at,
        })),
      );
      void getAnswersByAttempt; // referenced for potential future per-question drill
      return NextResponse.json({
        ok: true,
        quiz: quizMap.get(quizId) || null,
        attempts: rows,
        analytics: {
          totalAttempts: attempts.length,
          completed: finalized.length,
          avgScore: finalized.length ? Math.round((finalized.reduce((s, a) => s + a.score, 0) / finalized.length) * 10) / 10 : 0,
          avgAccuracy: finalized.length ? Math.round(finalized.reduce((s, a) => s + a.accuracy, 0) / finalized.length) : 0,
        },
      });
    }

    // Global overview.
    const attempts = await getAllAttempts();
    const answers = await getAllAnswers();
    const finalized = attempts.filter((a) => a.status !== "IN_PROGRESS");
    const abandoned = attempts.filter((a) => a.status === "IN_PROGRESS" || a.status === "ABANDONED").length;

    const totalAttempts = attempts.length;
    const avgScore = finalized.length ? finalized.reduce((s, a) => s + a.score, 0) / finalized.length : 0;
    const completionRate = totalAttempts ? Math.round((finalized.length / totalAttempts) * 100) : 0;

    // Most attempted quizzes.
    const byQuiz = new Map<string, number>();
    for (const a of attempts) byQuiz.set(a.quiz_id, (byQuiz.get(a.quiz_id) || 0) + 1);
    const mostAttempted = [...byQuiz.entries()]
      .map(([id, count]) => ({ id, title: quizMap.get(id)?.title || "Deleted quiz", slug: quizMap.get(id)?.slug || "", count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Hardest / most-wrong questions.
    const qStats = new Map<string, { wrong: number; total: number; text: string }>();
    for (const ans of answers) {
      const cur = qStats.get(ans.question_id) || { wrong: 0, total: 0, text: (ans.answer_snapshot?.question_html || "").replace(/<[^>]*>/g, " ").trim().slice(0, 120) };
      if (!ans.is_unattempted) {
        cur.total += 1;
        if (!ans.is_correct) cur.wrong += 1;
      }
      qStats.set(ans.question_id, cur);
    }
    const hardestQuestions = [...qStats.entries()]
      .filter(([, v]) => v.total >= 3)
      .map(([id, v]) => ({ id, text: v.text, wrongRate: Math.round((v.wrong / v.total) * 100), total: v.total }))
      .sort((a, b) => b.wrongRate - a.wrongRate)
      .slice(0, 10);

    // Top / low performers.
    const performers = finalized
      .map((a) => ({ name: a.guest_name || a.user_id || "Guest", score: a.score, max: a.max_score, accuracy: a.accuracy, quiz: quizMap.get(a.quiz_id)?.title || "" }))
      .sort((a, b) => b.accuracy - a.accuracy);
    const topPerformers = performers.slice(0, 8);

    // Topic-wise averages.
    const topicMap = new Map<string, { correct: number; total: number }>();
    for (const a of finalized) {
      const tb = (a.result_summary?.topic_breakdown as { label: string; correct: number; incorrect: number }[]) || [];
      for (const t of tb) {
        const cur = topicMap.get(t.label) || { correct: 0, total: 0 };
        cur.correct += t.correct;
        cur.total += t.correct + t.incorrect;
        topicMap.set(t.label, cur);
      }
    }
    const topicAverages = [...topicMap.entries()]
      .map(([label, v]) => ({ label, accuracy: v.total ? Math.round((v.correct / v.total) * 100) : 0, total: v.total }))
      .sort((a, b) => a.accuracy - b.accuracy);

    // Public-quiz lead capture count.
    const leadCaptures = attempts.filter((a) => a.guest_mobile).length;

    return NextResponse.json({
      ok: true,
      overview: {
        totalAttempts,
        completedAttempts: finalized.length,
        abandoned,
        completionRate,
        avgScore: Math.round(avgScore * 10) / 10,
        leadCaptures,
        publishedQuizzes: quizzes.filter((q) => q.status === "published").length,
      },
      mostAttempted,
      hardestQuestions,
      topPerformers,
      topicAverages,
      quizzes: quizzes.map((q) => ({ id: q.id, title: q.title })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load reports.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
