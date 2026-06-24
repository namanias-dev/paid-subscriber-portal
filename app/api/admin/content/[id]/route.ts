import { NextResponse } from "next/server";
import { updateContent, deleteContent } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import type { ContentItem } from "@/lib/types";

async function requireAdmin() {
  const session = await getAdminSession();
  return !!session;
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    const fields: (keyof ContentItem)[] = [
      "type",
      "subject",
      "paper",
      "title",
      "description",
      "drive_link",
      "youtube_link",
      "telegram_link",
      "date",
      "duration",
      "is_published",
      "course_id",
      "course_ids",
      "class_no",
      "drip_date",
    ];
    for (const f of fields) {
      if (body[f] !== undefined) {
        patch[f] = body[f];
      }
    }
    // Keep the legacy single course_id in sync with the multi-assignment array.
    if (Array.isArray(patch.course_ids)) {
      patch.course_id = (patch.course_ids as string[])[0] ?? null;
    }
    const updated = await updateContent(params.id, patch as Partial<ContentItem>);
    if (!updated) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, content: updated });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to update content." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const ok = await deleteContent(params.id);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to delete content." },
      { status: 500 }
    );
  }
}
