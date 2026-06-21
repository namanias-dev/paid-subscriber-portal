import { NextResponse } from "next/server";
import { getQuizById, updateQuiz, deleteQuiz, getAttemptsByQuiz } from "@/lib/dataProvider";
import { requireAdmin } from "@/lib/adminGuard";
import { normalizeQuizInput } from "@/lib/quizNormalize";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const quiz = await getQuizById(params.id);
    if (!quiz) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const attempts = await getAttemptsByQuiz(params.id);
    return NextResponse.json({ ok: true, quiz, attemptCount: attempts.length });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load quiz." }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const input = normalizeQuizInput(body);
    const quiz = await updateQuiz(params.id, input);
    if (!quiz) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, quiz });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update quiz.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const ok = await deleteQuiz(params.id);
    return NextResponse.json({ ok });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to delete quiz." }, { status: 500 });
  }
}
