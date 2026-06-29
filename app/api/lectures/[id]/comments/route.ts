import { NextResponse } from "next/server";
import { getContentById, getLectureComments, createLectureComment, getLectureCommentById, updateLectureComment, countRecentLectureComments } from "@/lib/dataProvider";
import { resolveLectureAccess } from "@/lib/entitlements";
import { getActionActor } from "@/lib/adminGuard";
import { viewerAuthorId, sanitizeCommentBody, COMMENT_MAX_LEN, POST_MIN_GAP_MS } from "@/lib/lectureComments";
import { notifyStudentOfReply } from "@/lib/lectureNotify";

export const dynamic = "force-dynamic";

/**
 * GET — comments for a lecture, for an enrolled viewer only. Students see
 * non-hidden comments; staff see everything (with the hidden flag). Returns the
 * viewer's identity so the UI can mark "my" comments and show moderation tools.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const rec = await getContentById(params.id);
  if (!rec) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const { learner, access } = await resolveLectureAccess(rec);
  if (!access.allowed || !learner) return NextResponse.json({ ok: false, access }, { status: 403 });

  const isStaff = learner.kind === "staff";
  const actor = isStaff ? await getActionActor() : null;
  const all = await getLectureComments(rec.id);
  const comments = isStaff ? all : all.filter((c) => !c.is_hidden);

  return NextResponse.json({
    ok: true,
    comments,
    viewer: { authorId: viewerAuthorId(learner, actor), kind: isStaff ? "staff" : "student", canModerate: isStaff },
  });
}

/** POST — create a top-level comment or a one-level reply. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const rec = await getContentById(params.id);
  if (!rec) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const { learner, access } = await resolveLectureAccess(rec);
  if (!access.allowed || !learner) return NextResponse.json({ ok: false, access }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { body?: string; parentCommentId?: string };
  const text = sanitizeCommentBody(body.body);
  if (!text) return NextResponse.json({ ok: false, error: "Comment can't be empty." }, { status: 400 });
  if (text.length >= COMMENT_MAX_LEN) return NextResponse.json({ ok: false, error: `Keep it under ${COMMENT_MAX_LEN} characters.` }, { status: 400 });

  const isStaff = learner.kind === "staff";
  const actor = isStaff ? await getActionActor() : null;
  const authorId = viewerAuthorId(learner, actor);

  // Lightweight rate limit (no shared memory on serverless → cheap DB check).
  const recent = await countRecentLectureComments(authorId, new Date(Date.now() - POST_MIN_GAP_MS).toISOString());
  if (recent > 0) return NextResponse.json({ ok: false, error: "You're posting too fast — wait a moment." }, { status: 429 });

  // Resolve / clamp the parent to one level (a reply-to-a-reply attaches to root).
  let parentId: string | null = null;
  let parent = null;
  if (body.parentCommentId) {
    parent = await getLectureCommentById(body.parentCommentId);
    if (!parent || parent.recording_id !== rec.id || parent.deleted_at) {
      return NextResponse.json({ ok: false, error: "That comment no longer exists." }, { status: 400 });
    }
    parentId = parent.parent_comment_id || parent.id;
    if (parentId !== parent.id) parent = await getLectureCommentById(parentId);
  }

  const courseId = (rec.course_ids && rec.course_ids[0]) || rec.course_id || null;
  const comment = await createLectureComment({
    recording_id: rec.id,
    course_id: courseId,
    author_kind: isStaff ? "staff" : "student",
    author_id: authorId,
    author_name: isStaff ? actor?.name || "Staff" : learner.name,
    author_phone: isStaff ? null : learner.phone,
    author_role: isStaff ? actor?.role || "Faculty" : null,
    body: text,
    parent_comment_id: parentId,
  });

  // A staff reply resolves the thread and notifies the asking student (once).
  if (comment && isStaff && parent && parent.author_kind === "student") {
    await updateLectureComment(parent.id, { is_answered: true }).catch(() => null);
    await notifyStudentOfReply(parent, comment, { lectureTitle: rec.title, replierName: actor?.name }).catch(() => null);
  }

  return NextResponse.json({ ok: true, comment });
}
