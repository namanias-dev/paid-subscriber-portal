import { NextResponse } from "next/server";
import { getAllQuizzes, addQuiz } from "@/lib/dataProvider";
import { requireAdmin } from "@/lib/adminGuard";
import { normalizeQuizInput } from "@/lib/quizNormalize";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const quizzes = await getAllQuizzes();
    return NextResponse.json({ ok: true, quizzes });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load quizzes." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    if (!body.title) return NextResponse.json({ ok: false, error: "Title is required." }, { status: 400 });
    const input = normalizeQuizInput(body);
    const quiz = await addQuiz(input);
    return NextResponse.json({ ok: true, quiz });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create quiz.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
