import { NextResponse } from "next/server";
import { getQuestionById, updateQuestion, deleteQuestion } from "@/lib/dataProvider";
import { requireAdmin } from "@/lib/adminGuard";
import { sanitizeQuestionInput } from "@/lib/quizSanitize";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const question = await getQuestionById(params.id);
    if (!question) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, question });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load question." }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const input = sanitizeQuestionInput(body);
    const question = await updateQuestion(params.id, input);
    if (!question) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, question });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update question.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const ok = await deleteQuestion(params.id);
    return NextResponse.json({ ok });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to delete question." }, { status: 500 });
  }
}
