import { NextResponse } from "next/server";
import { getAttemptById } from "@/lib/dataProvider";
import { ownsAttempt } from "@/lib/quizOwner";
import { isAttemptExpired } from "@/lib/quizEngine";
import { finalizeAttempt } from "@/lib/quizSubmit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const attempt = await getAttemptById(String(body.attemptId || ""));
    if (!attempt) return NextResponse.json({ ok: false, error: "Attempt not found" }, { status: 404 });
    if (!(await ownsAttempt(attempt))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const auto = isAttemptExpired(attempt) || !!body.auto;
    const finalized = await finalizeAttempt(attempt.id, { auto });
    if (!finalized) return NextResponse.json({ ok: false, error: "Failed to submit" }, { status: 500 });
    return NextResponse.json({ ok: true, attemptId: finalized.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to submit quiz.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
