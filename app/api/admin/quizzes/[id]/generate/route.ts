import { NextResponse } from "next/server";
import { getQuestions, setQuizQuestions, getQuizById } from "@/lib/dataProvider";
import { requirePermission } from "@/lib/adminGuard";
import { buildSnapshot } from "@/lib/quizSnapshot";

export const dynamic = "force-dynamic";

/** Auto-generate a quiz's question list from the bank by filters. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("content_quizzes"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const quiz = await getQuizById(params.id);
    if (!quiz) return NextResponse.json({ ok: false, error: "Quiz not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const { subject, topic, difficulty, count = 10, includePyq = true, approvedOnly = true } = body as {
      subject?: string; topic?: string; difficulty?: string; count?: number; includePyq?: boolean; approvedOnly?: boolean;
    };

    let pool = await getQuestions();
    pool = pool.filter((q) => q.status === "published" || q.status === "draft");
    if (subject) pool = pool.filter((q) => q.subject === subject);
    if (topic) pool = pool.filter((q) => q.topic === topic);
    if (difficulty) pool = pool.filter((q) => q.difficulty === difficulty);
    if (!includePyq) pool = pool.filter((q) => !q.is_pyq);
    if (approvedOnly) pool = pool.filter((q) => q.quality_status === "approved");

    // Shuffle and take `count`.
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picked = pool.slice(0, Math.max(1, Math.min(Number(count) || 10, 200)));

    const replace = body.replace !== false;
    const items = picked.map((q, i) => ({
      question_id: q.id,
      order_index: i,
      section: null,
      marks: null,
      negative_marks: null,
      snapshot: buildSnapshot(q),
    }));

    if (replace) {
      const saved = await setQuizQuestions(params.id, items);
      return NextResponse.json({ ok: true, items: saved, picked: picked.length, available: pool.length });
    }
    return NextResponse.json({ ok: true, questionIds: picked.map((q) => q.id), picked: picked.length, available: pool.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to generate questions.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
