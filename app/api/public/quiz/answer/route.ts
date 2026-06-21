import { NextResponse } from "next/server";
import { getAttemptById, saveAnswer } from "@/lib/dataProvider";
import { ownsAttempt } from "@/lib/quizOwner";
import { isAttemptExpired } from "@/lib/quizEngine";
import type { QuizOptionKey } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const attempt = await getAttemptById(String(body.attemptId || ""));
    if (!attempt) return NextResponse.json({ ok: false, error: "Attempt not found" }, { status: 404 });
    if (!(await ownsAttempt(attempt))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    if (attempt.status !== "IN_PROGRESS") return NextResponse.json({ ok: false, error: "Attempt already submitted" }, { status: 409 });
    if (isAttemptExpired(attempt)) return NextResponse.json({ ok: false, expired: true, error: "Time is up." }, { status: 409 });

    const selected = body.selectedOption ? (String(body.selectedOption).toUpperCase() as QuizOptionKey) : null;
    await saveAnswer({
      attempt_id: attempt.id,
      quiz_id: attempt.quiz_id,
      question_id: String(body.questionId),
      selected_option: selected,
      is_unattempted: selected === null,
      marked_for_review: !!body.markedForReview,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save answer.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
