import { NextResponse } from "next/server";
import { getAllContent, addContent } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import type { ContentType } from "@/lib/types";

const VALID_TYPES: ContentType[] = [
  "current_affairs",
  "mcq",
  "booklet",
  "recording",
  "live_link",
  "pyq",
  "test_series",
  "answer_writing",
  "notes",
  "maps",
];

async function requireAdmin() {
  const session = await getAdminSession();
  return !!session;
}

export async function GET() {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const content = await getAllContent();
    return NextResponse.json({ ok: true, content });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to load content." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const type = String(body.type || "") as ContentType;
    const title = String(body.title || "").trim();

    if (!VALID_TYPES.includes(type) || !title) {
      return NextResponse.json(
        { ok: false, error: "Valid content type and title are required." },
        { status: 400 }
      );
    }

    const courseIds = Array.isArray(body.course_ids)
      ? (body.course_ids as unknown[]).map((x) => String(x)).filter(Boolean)
      : body.course_id
        ? [String(body.course_id)]
        : [];
    const classNo = body.class_no !== undefined && body.class_no !== null && body.class_no !== ""
      ? Number(body.class_no)
      : null;

    const item = await addContent({
      type,
      subject: body.subject ? String(body.subject) : null,
      paper: body.paper ? String(body.paper) : null,
      title,
      description: body.description ? String(body.description) : null,
      drive_link: body.drive_link ? String(body.drive_link) : null,
      youtube_link: body.youtube_link ? String(body.youtube_link) : null,
      telegram_link: body.telegram_link ? String(body.telegram_link) : null,
      date: body.date ? String(body.date) : undefined,
      duration: body.duration ? String(body.duration) : null,
      is_published: Boolean(body.is_published),
      course_id: courseIds[0] ?? null,
      course_ids: courseIds,
      class_no: Number.isFinite(classNo) ? classNo : null,
      drip_date: body.drip_date ? String(body.drip_date) : null,
      source_type: body.source_type === "hosted" ? "hosted" : "link",
      visibility: body.visibility === "public" ? "public" : "enrolled",
    });

    return NextResponse.json({ ok: true, content: item });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to add content." },
      { status: 500 }
    );
  }
}
