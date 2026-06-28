import { NextResponse } from "next/server";
import { getLibraryDocs, addLibraryDoc } from "@/lib/dataProvider";
import { requirePermission, requireAnyPermission } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requireAnyPermission(["content_pdfs_media", "content_courses", "content_webinars"]))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const docs = await getLibraryDocs();
    return NextResponse.json({ ok: true, docs });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load library." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requirePermission("content_pdfs_media"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    if (!body.title?.trim()) return NextResponse.json({ ok: false, error: "Title required." }, { status: 400 });
    if (!body.file_url?.trim()) return NextResponse.json({ ok: false, error: "File is required." }, { status: 400 });
    const doc = await addLibraryDoc({
      title: body.title.trim(),
      category: body.category?.trim() || null,
      file_url: body.file_url.trim(),
      file_size: typeof body.file_size === "number" ? body.file_size : null,
      description: body.description?.trim() || null,
    });
    return NextResponse.json({ ok: true, doc });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to add document.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
