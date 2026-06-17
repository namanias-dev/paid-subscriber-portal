import { NextResponse } from "next/server";
import { markProgress } from "@/lib/dataProvider";
import { getStudentSession } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const session = await getStudentSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const contentId = String(body.content_id || "");
    const completed = body.completed !== false; // default true
    if (!contentId) {
      return NextResponse.json(
        { ok: false, error: "content_id required" },
        { status: 400 }
      );
    }
    const progress = await markProgress(session.student_id, contentId, completed);
    return NextResponse.json({ ok: true, progress });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to update progress." },
      { status: 500 }
    );
  }
}
