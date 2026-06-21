import { NextResponse } from "next/server";
import { getQuestions, addQuestion } from "@/lib/dataProvider";
import { requireAdmin } from "@/lib/adminGuard";
import { sanitizeQuestionInput } from "@/lib/quizSanitize";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const questions = await getQuestions();
    return NextResponse.json({ ok: true, questions });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load questions." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const input = sanitizeQuestionInput(body);
    if (!input.question_html) return NextResponse.json({ ok: false, error: "Question text is required." }, { status: 400 });
    if (!input.options?.A || !input.options?.B || !input.options?.C || !input.options?.D) {
      return NextResponse.json({ ok: false, error: "Options A–D are required." }, { status: 400 });
    }
    const question = await addQuestion(input);
    return NextResponse.json({ ok: true, question });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save question.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
