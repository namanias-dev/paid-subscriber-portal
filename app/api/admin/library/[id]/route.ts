import { NextResponse } from "next/server";
import { updateLibraryDoc, deleteLibraryDoc, getLibraryDocUsage } from "@/lib/dataProvider";
import { requirePermission } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("content_pdfs_media"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (typeof body.title === "string") patch.title = body.title.trim();
    if ("category" in body) patch.category = body.category?.trim() || null;
    if ("description" in body) patch.description = body.description?.trim() || null;
    const doc = await updateLibraryDoc(params.id, patch);
    if (!doc) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true, doc });
  } catch {
    return NextResponse.json({ ok: false, error: "Update failed." }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("content_pdfs_media"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const force = new URL(req.url).searchParams.get("force") === "1";
    const usage = await getLibraryDocUsage(params.id);
    const inUse = usage.courses.length + usage.webinars.length;
    if (inUse > 0 && !force) {
      return NextResponse.json({ ok: false, inUse: true, usage, error: "Document is in use." }, { status: 409 });
    }
    const ok = await deleteLibraryDoc(params.id);
    return NextResponse.json({ ok });
  } catch {
    return NextResponse.json({ ok: false, error: "Delete failed." }, { status: 500 });
  }
}
