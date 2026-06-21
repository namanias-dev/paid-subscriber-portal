import type { Quiz, QuizQuestion, QuizOptionKey } from "./types";

export interface ScoredAnswer {
  question_id: string;
  selected_option: QuizOptionKey | null;
  is_correct: boolean;
  is_unattempted: boolean;
  marks_awarded: number;
  negative_marks_deducted: number;
}

export interface TopicStat { label: string; subject: string | null; correct: number; incorrect: number; total: number }

export interface ScoreResult {
  score: number;
  max_score: number;
  correct_count: number;
  incorrect_count: number;
  unattempted_count: number;
  negative_marks: number;
  accuracy: number;
  answers: ScoredAnswer[];
  topic_breakdown: TopicStat[];
  subject_breakdown: TopicStat[];
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Server-side authoritative scoring. Never trusts the client. */
export function scoreAttempt(
  quiz: Quiz,
  quizQuestions: QuizQuestion[],
  selections: Record<string, QuizOptionKey | null | undefined>,
): ScoreResult {
  const negType = quiz.scoring_settings?.negative_marks_type || "fraction";
  const negEnabled = quiz.negative_marking_enabled;

  let score = 0;
  let maxScore = 0;
  let correct = 0;
  let incorrect = 0;
  let unattempted = 0;
  let negativeTotal = 0;

  const answers: ScoredAnswer[] = [];
  const topicMap = new Map<string, TopicStat>();
  const subjectMap = new Map<string, TopicStat>();

  function bump(map: Map<string, TopicStat>, label: string | null | undefined, subject: string | null | undefined, isCorrect: boolean, attempted: boolean) {
    const key = label || "Uncategorized";
    const stat = map.get(key) || { label: key, subject: subject || null, correct: 0, incorrect: 0, total: 0 };
    stat.total += 1;
    if (attempted) {
      if (isCorrect) stat.correct += 1;
      else stat.incorrect += 1;
    }
    map.set(key, stat);
  }

  for (const qq of quizQuestions) {
    const marks = qq.marks ?? quiz.marks_per_question ?? 2;
    maxScore += marks;
    const correctOption = qq.snapshot?.correct_option;
    const sel = selections[qq.question_id] ?? null;
    const attempted = sel !== null && sel !== undefined;
    const isCorrect = attempted && sel === correctOption;

    let awarded = 0;
    let deducted = 0;
    if (!attempted) {
      unattempted += 1;
    } else if (isCorrect) {
      awarded = marks;
      correct += 1;
    } else {
      incorrect += 1;
      if (negEnabled) {
        const perWrong = qq.negative_marks ?? (negType === "fixed" ? quiz.negative_fraction : quiz.negative_fraction * marks);
        deducted = perWrong;
      }
    }

    score += awarded - deducted;
    negativeTotal += deducted;

    answers.push({
      question_id: qq.question_id,
      selected_option: sel,
      is_correct: isCorrect,
      is_unattempted: !attempted,
      marks_awarded: round2(awarded),
      negative_marks_deducted: round2(deducted),
    });

    bump(topicMap, qq.snapshot?.topic, qq.snapshot?.subject, isCorrect, attempted);
    bump(subjectMap, qq.snapshot?.subject, qq.snapshot?.subject, isCorrect, attempted);
  }

  const attemptedCount = correct + incorrect;
  return {
    score: round2(score),
    max_score: round2(maxScore),
    correct_count: correct,
    incorrect_count: incorrect,
    unattempted_count: unattempted,
    negative_marks: round2(negativeTotal),
    accuracy: attemptedCount ? round2((correct / attemptedCount) * 100) : 0,
    answers,
    topic_breakdown: [...topicMap.values()],
    subject_breakdown: [...subjectMap.values()],
  };
}

/** Percentile of `score` against an array of other scores (0–100). */
export function computePercentile(score: number, allScores: number[]): number | null {
  if (allScores.length < 5) return null;
  const below = allScores.filter((s) => s < score).length;
  return Math.round((below / allScores.length) * 100);
}
