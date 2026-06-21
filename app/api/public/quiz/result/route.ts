import { NextResponse } from "next/server";
import { getAttemptById, getQuizById, getQuizQuestions, getAnswersByAttempt } from "@/lib/dataProvider";
import { ownsAttempt } from "@/lib/quizOwner";
import { buildResultPayload } from "@/lib/quizResult";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const attemptId = searchParams.get("attemptId") || "";
    const attempt = await getAttemptById(attemptId);
    if (!attempt) return NextResponse.json({ ok: false, error: "Result not found" }, { status: 404 });
    if (!(await ownsAttempt(attempt))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    if (attempt.status === "IN_PROGRESS") return NextResponse.json({ ok: false, error: "Attempt not submitted yet" }, { status: 409 });

    const quiz = await getQuizById(attempt.quiz_id);
    if (!quiz) return NextResponse.json({ ok: false, error: "Quiz not found" }, { status: 404 });
    const quizQuestions = await getQuizQuestions(quiz.id);
    const answers = await getAnswersByAttempt(attempt.id);
    const payload = buildResultPayload(quiz, quizQuestions, attempt, answers, attempt.guest_name);
    return NextResponse.json({ ok: true, result: payload });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load result.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
