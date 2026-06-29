import { NextResponse } from "next/server";
import { getContentById, getLectureCommentById, updateLectureComment, softDeleteLectureComment } from "@/lib/dataProvider";
import { resolveLectureAccess } from "@/lib/entitlements";
import { getActionActor } from "@/lib/adminGuard";
import { viewerAuthorId, sanitizeCommentBody, COMMENT_MAX_LEN, EDIT_WINDOW_MS } from "@/lib/lectureComments";

export const dynamic = "force-dynamic";

/** Resolve the enrolled viewer + the target comment, enforcing ownership + window. */
async function ownGuard(id: string, commentId: string) {
  const rec = await getContentById(id);
  if (!rec) return { error: NextResponse.json({ ok: false, error: "Not found" }, { status: 404 }) };
  const { learner, access } = await resolveLectureAccess(rec);
  if (!access.allowed || !learner) return { error: NextResponse.json({ ok: false, access }, { status: 403 }) };
  const comment = await getLectureCommentById(commentId);
  if (!comment || comment.recording_id !== rec.id || comment.deleted_at) {
    return { error: NextResponse.json({ ok: false, error: "Comment not found." }, { status: 404 }) };
  }
  const actor = learner.kind === "staff" ? await getActionActor() : null;
  const mine = comment.author_id === viewerAuthorId(learner, actor);
  if (!mine) return { error: NextResponse.json({ ok: false, error: "You can only change your own comment." }, { status: 403 }) };
  if (Date.now() - new Date(comment.created_at).getTime() > EDIT_WINDOW_MS) {
    return { error: NextResponse.json({ ok: false, error: "The edit window for this comment has passed." }, { status: 403 }) };
  }
  return { comment };
}

export async function PATCH(req: Request, { params }: { params: { id: string; commentId: string } }) {
  const g = await ownGuard(params.id, params.commentId);
  if (g.error) return g.error;
  const body = (await req.json().catch(() => ({}))) as { body?: string };
  const text = sanitizeCommentBody(body.body);
  if (!text) return NextResponse.json({ ok: false, error: "Comment can't be empty." }, { status: 400 });
  if (text.length >= COMMENT_MAX_LEN) return NextResponse.json({ ok: false, error: `Keep it under ${COMMENT_MAX_LEN} characters.` }, { status: 400 });
  const updated = await updateLectureComment(params.commentId, { body: text, edited_at: new Date().toISOString() });
  return NextResponse.json({ ok: true, comment: updated });
}

export async function DELETE(_req: Request, { params }: { params: { id: string; commentId: string } }) {
  const g = await ownGuard(params.id, params.commentId);
  if (g.error) return g.error;
  await softDeleteLectureComment(params.commentId);
  return NextResponse.json({ ok: true });
}
