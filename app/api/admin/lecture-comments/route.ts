import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import {
  getUnansweredLectureComments,
  getAllContent,
  getAllCourses,
  getLectureCommentById,
  createLectureComment,
  updateLectureComment,
  softDeleteLectureComment,
} from "@/lib/dataProvider";
import { sanitizeCommentBody, COMMENT_MAX_LEN } from "@/lib/lectureComments";
import { notifyStudentOfReply } from "@/lib/lectureNotify";

export const dynamic = "force-dynamic";
const PERM = "content_courses" as const;

/**
 * GET — the staff moderation queue: unanswered student questions across all
 * lectures, oldest-first, enriched with lecture + course titles, plus an
 * optional ?courseId filter and the total unanswered count.
 */
export async function GET(req: Request) {
  if (!(await requirePermission(PERM))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const courseId = searchParams.get("courseId") || undefined;

  const [items, content, courses] = await Promise.all([getUnansweredLectureComments(courseId), getAllContent(), getAllCourses()]);
  const contentById = new Map(content.map((c) => [c.id, c]));
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const enriched = items.map((c) => ({
    comment: c,
    lectureTitle: contentById.get(c.recording_id)?.title || "Lecture",
    courseTitle: c.course_id ? courseById.get(c.course_id)?.title || null : null,
  }));

  // Per-course counts for the filter chips (across the whole unanswered set).
  const all = courseId ? await getUnansweredLectureComments() : items;
  const byCourse: Record<string, number> = {};
  for (const c of all) byCourse[c.course_id || "_"] = (byCourse[c.course_id || "_"] || 0) + 1;

  return NextResponse.json({ ok: true, items: enriched, total: all.length, byCourse });
}

/** POST — moderation actions: reply / pin / hide / answer / edit / delete. */
export async function POST(req: Request) {
  if (!(await requirePermission(PERM))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; commentId?: string; body?: string };
  const action = String(body.action || "");
  const target = body.commentId ? await getLectureCommentById(body.commentId) : null;
  if (!target || target.deleted_at) return NextResponse.json({ ok: false, error: "Comment not found." }, { status: 404 });

  try {
    switch (action) {
      case "reply": {
        const text = sanitizeCommentBody(body.body);
        if (!text) return NextResponse.json({ ok: false, error: "Reply can't be empty." }, { status: 400 });
        if (text.length >= COMMENT_MAX_LEN) return NextResponse.json({ ok: false, error: `Keep it under ${COMMENT_MAX_LEN} characters.` }, { status: 400 });
        const rootId = target.parent_comment_id || target.id;
        const root = rootId === target.id ? target : await getLectureCommentById(rootId);
        const reply = await createLectureComment({
          recording_id: target.recording_id,
          course_id: target.course_id,
          author_kind: "staff",
          author_id: actor.id,
          author_name: actor.name || "Staff",
          author_role: actor.role || "Faculty",
          body: text,
          parent_comment_id: rootId,
        });
        if (root && root.author_kind === "student") {
          await updateLectureComment(root.id, { is_answered: true }).catch(() => null);
          if (reply) await notifyStudentOfReply(root, reply, { replierName: actor.name }).catch(() => null);
        }
        return NextResponse.json({ ok: true, comment: reply });
      }
      case "pin":
        return NextResponse.json({ ok: true, comment: await updateLectureComment(target.id, { is_pinned: true }) });
      case "unpin":
        return NextResponse.json({ ok: true, comment: await updateLectureComment(target.id, { is_pinned: false }) });
      case "hide":
        return NextResponse.json({ ok: true, comment: await updateLectureComment(target.id, { is_hidden: true }) });
      case "unhide":
        return NextResponse.json({ ok: true, comment: await updateLectureComment(target.id, { is_hidden: false }) });
      case "answer":
        return NextResponse.json({ ok: true, comment: await updateLectureComment(target.id, { is_answered: true }) });
      case "unanswer":
        return NextResponse.json({ ok: true, comment: await updateLectureComment(target.id, { is_answered: false }) });
      case "edit": {
        const text = sanitizeCommentBody(body.body);
        if (!text) return NextResponse.json({ ok: false, error: "Comment can't be empty." }, { status: 400 });
        return NextResponse.json({ ok: true, comment: await updateLectureComment(target.id, { body: text, edited_at: new Date().toISOString() }) });
      }
      case "delete":
        await softDeleteLectureComment(target.id);
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Action failed" }, { status: 500 });
  }
}
