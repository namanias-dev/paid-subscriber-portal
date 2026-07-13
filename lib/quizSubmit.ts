import {
  getAttemptById, getQuizById, getQuizQuestions, getAnswersByAttempt,
  getAttemptsByQuiz, getStudents, getAllCourseEnrollments, getLeaderboardSettings,
  updateAttempt, saveAnswer,
} from "./dataProvider";
import { scoreAttempt } from "./quizScoring";
import { computeScopedRankPercentile } from "./quizRank";
import type { QuizAttempt, QuizOptionKey } from "./types";

/**
 * Server-side authoritative submission. Computes the score from snapshots,
 * persists per-answer results, finalizes the attempt and computes rank/percentile.
 * Idempotent: a finalized attempt is returned unchanged.
 */
export async function finalizeAttempt(attemptId: string, opts: { auto?: boolean } = {}): Promise<QuizAttempt | null> {
  const attempt = await getAttemptById(attemptId);
  if (!attempt) return null;
  if (attempt.status !== "IN_PROGRESS") return attempt; // already finalized

  const quiz = await getQuizById(attempt.quiz_id);
  if (!quiz) return null;
  const quizQuestions = await getQuizQuestions(quiz.id);
  const answers = await getAnswersByAttempt(attemptId);

  const selections: Record<string, QuizOptionKey | null> = {};
  for (const a of answers) selections[a.question_id] = a.selected_option;

  const result = scoreAttempt(quiz, quizQuestions, selections);
  const qqMap = new Map(quizQuestions.map((qq) => [qq.question_id, qq]));

  // Persist per-answer scoring with a snapshot for permanent history.
  for (const sa of result.answers) {
    const qq = qqMap.get(sa.question_id);
    await saveAnswer({
      attempt_id: attemptId,
      quiz_id: quiz.id,
      question_id: sa.question_id,
      selected_option: sa.selected_option,
      is_correct: sa.is_correct,
      is_unattempted: sa.is_unattempted,
      marks_awarded: sa.marks_awarded,
      negative_marks_deducted: sa.negative_marks_deducted,
      answer_snapshot: qq?.snapshot || {},
    });
  }

  // Rank & percentile — batch-scoped + exclusion-aware, matching the leaderboard.
  // Computed over qualified (completed), non-guest, non-excluded attempts within
  // the student's own batch (guests/staff/test never skew it). Read paths recompute
  // this on display, so persisted values are only a best-effort snapshot.
  const [quizAttempts, students, enrollments, settings] = await Promise.all([
    getAttemptsByQuiz(quiz.id),
    getStudents(),
    getAllCourseEnrollments(),
    getLeaderboardSettings(),
  ]);
  const scoped = computeScopedRankPercentile({
    quizId: quiz.id,
    attemptId,
    score: result.score,
    userId: attempt.user_id,
    quizAttempts,
    students,
    enrollments,
    excludedStudentIds: settings.excludedStudentIds,
  });
  const gateOn = quiz.result_settings?.show_rank_percentile !== false;
  const percentile = gateOn ? scoped.percentile : null;
  const rank = gateOn ? scoped.rank : null;

  const now = Date.now();
  const timeTaken = Math.max(0, Math.round((now - Date.parse(attempt.started_at)) / 1000));

  return updateAttempt(attemptId, {
    status: opts.auto ? "AUTO_SUBMITTED" : "SUBMITTED",
    submitted_at: new Date().toISOString(),
    time_taken_seconds: timeTaken,
    score: result.score,
    max_score: result.max_score,
    correct_count: result.correct_count,
    incorrect_count: result.incorrect_count,
    unattempted_count: result.unattempted_count,
    accuracy: result.accuracy,
    negative_marks: result.negative_marks,
    percentile,
    rank,
    result_summary: {
      ...(attempt.result_summary || {}),
      topic_breakdown: result.topic_breakdown,
      subject_breakdown: result.subject_breakdown,
    },
  });
}
