import type { Quiz, QuizQuestion, QuizAttempt, QuizAnswer, QuizOptionKey } from "./types";
import { QUIZ_DISCLAIMER } from "./quizEngine";

export interface ResultQuestion {
  order: number;
  question_html: string;
  question_image: string | null;
  options: { key: QuizOptionKey; html: string }[];
  your_option: QuizOptionKey | null;
  correct_option: QuizOptionKey | null;
  is_correct: boolean;
  is_unattempted: boolean;
  explanation_html: string | null;
  subject: string | null;
  topic: string | null;
  marks_awarded: number;
  negative_marks_deducted: number;
}

export interface ResultPayload {
  quiz: { id: string; title: string; slug: string; subject: string | null; marks_per_question: number };
  attempt: {
    id: string; status: string; score: number; max_score: number;
    correct_count: number; incorrect_count: number; unattempted_count: number;
    accuracy: number; negative_marks: number; time_taken_seconds: number | null;
    percentile: number | null; rank: number | null; submitted_at: string | null;
    student_name: string | null;
  };
  settings: Quiz["result_settings"];
  reveal: boolean;
  topic_breakdown: { label: string; subject: string | null; correct: number; incorrect: number; total: number }[];
  subject_breakdown: { label: string; subject: string | null; correct: number; incorrect: number; total: number }[];
  questions: ResultQuestion[];
  disclaimer: string;
}

const OPTION_KEYS: QuizOptionKey[] = ["A", "B", "C", "D", "E"];

export function buildResultPayload(
  quiz: Quiz,
  quizQuestions: QuizQuestion[],
  attempt: QuizAttempt,
  answers: QuizAnswer[],
  studentName: string | null,
): ResultPayload {
  const rs = quiz.result_settings || {};
  const afterDate = rs.reveal_explanations_after ? Date.parse(rs.reveal_explanations_after) > Date.now() : false;
  const reveal = !afterDate; // explanations hidden until reveal date if set

  const order: string[] = (attempt.result_summary?.order as string[]) || quizQuestions.sort((a, b) => a.order_index - b.order_index).map((q) => q.question_id);
  const qqMap = new Map(quizQuestions.map((qq) => [qq.question_id, qq]));
  const ansMap = new Map(answers.map((a) => [a.question_id, a]));

  const questions: ResultQuestion[] = order.map((qid, i) => {
    const qq = qqMap.get(qid);
    const snap = qq?.snapshot || {};
    const opts = (snap.options || {}) as Record<string, string | null>;
    const ans = ansMap.get(qid);
    const showCorrect = rs.show_correct_answers !== false && reveal;
    return {
      order: i + 1,
      question_html: snap.question_html || "",
      question_image: snap.question_image || null,
      options: OPTION_KEYS.filter((k) => opts[k]).map((k) => ({ key: k, html: opts[k] || "" })),
      your_option: (ans?.selected_option as QuizOptionKey) || null,
      correct_option: showCorrect ? (snap.correct_option as QuizOptionKey) || null : null,
      is_correct: ans?.is_correct || false,
      is_unattempted: ans?.is_unattempted ?? true,
      explanation_html: rs.show_explanations !== false && reveal ? snap.explanation_html || null : null,
      subject: snap.subject || null,
      topic: snap.topic || null,
      marks_awarded: ans?.marks_awarded || 0,
      negative_marks_deducted: ans?.negative_marks_deducted || 0,
    };
  });

  const summary = attempt.result_summary || {};
  return {
    quiz: { id: quiz.id, title: quiz.title, slug: quiz.slug, subject: quiz.subject, marks_per_question: quiz.marks_per_question },
    attempt: {
      id: attempt.id, status: attempt.status, score: attempt.score, max_score: attempt.max_score,
      correct_count: attempt.correct_count, incorrect_count: attempt.incorrect_count,
      unattempted_count: attempt.unattempted_count, accuracy: attempt.accuracy,
      negative_marks: attempt.negative_marks, time_taken_seconds: attempt.time_taken_seconds,
      percentile: attempt.percentile, rank: attempt.rank, submitted_at: attempt.submitted_at,
      student_name: studentName,
    },
    settings: rs,
    reveal,
    topic_breakdown: (summary.topic_breakdown as ResultPayload["topic_breakdown"]) || [],
    subject_breakdown: (summary.subject_breakdown as ResultPayload["subject_breakdown"]) || [],
    questions,
    disclaimer: QUIZ_DISCLAIMER,
  };
}
