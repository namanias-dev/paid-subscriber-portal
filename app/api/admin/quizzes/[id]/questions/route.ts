import { NextResponse } from "next/server";
import { getQuizQuestions, setQuizQuestions, getQuestionsByIds, getQuizById, getAttemptsByQuiz } from "@/lib/dataProvider";
import { requirePermission } from "@/lib/adminGuard";
import { buildSnapshot } from "@/lib/quizSnapshot";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("content_quizzes"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const items = await getQuizQuestions(params.id);
    return NextResponse.json({ ok: true, items });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load quiz questions." }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("content_quizzes"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const quiz = await getQuizById(params.id);
    if (!quiz) return NextResponse.json({ ok: false, error: "Quiz not found" }, { status: 404 });

    // Versioning guard: warn if quiz already has attempts.
    const attempts = await getAttemptsByQuiz(params.id);
    const body = await req.json().catch(() => ({}));
    if (attempts.length > 0 && !body.force) {
      return NextResponse.json(
        { ok: false, needsConfirm: true, error: `This quiz already has ${attempts.length} attempt(s). Editing questions will not change past results (they use snapshots). Confirm to proceed.` },
        { status: 409 },
      );
    }

    const incoming = Array.isArray(body.items) ? body.items : [];
    const ids = incoming.map((it: { question_id: string }) => it.question_id);
    const questions = await getQuestionsByIds(ids);
    const qmap = new Map(questions.map((q) => [q.id, q]));

    const items = incoming
      .filter((it: { question_id: string }) => qmap.has(it.question_id))
      .map((it: { question_id: string; order_index?: number; marks?: number; negative_marks?: number; section?: string }, i: number) => {
        const q = qmap.get(it.question_id)!;
        return {
          question_id: it.question_id,
          order_index: it.order_index ?? i,
          section: it.section ?? null,
          marks: it.marks ?? null,
          negative_marks: it.negative_marks ?? null,
          snapshot: buildSnapshot(q),
        };
      });

    const saved = await setQuizQuestions(params.id, items);
    return NextResponse.json({ ok: true, items: saved });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save quiz questions.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
