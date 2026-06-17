import { NextResponse } from "next/server";
import { addBookmark, removeBookmark } from "@/lib/dataProvider";
import { getStudentSession } from "@/lib/session";

export async function POST(req: Request) {
  try {
    const session = await getStudentSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const contentId = String(body.content_id || "");
    if (!contentId) {
      return NextResponse.json(
        { ok: false, error: "content_id required" },
        { status: 400 }
      );
    }
    const bookmark = await addBookmark(session.student_id, contentId);
    return NextResponse.json({ ok: true, bookmark });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to bookmark." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getStudentSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const contentId = String(body.content_id || "");
    if (!contentId) {
      return NextResponse.json(
        { ok: false, error: "content_id required" },
        { status: 400 }
      );
    }
    await removeBookmark(session.student_id, contentId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to remove bookmark." },
      { status: 500 }
    );
  }
}
