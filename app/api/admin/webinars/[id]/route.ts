import { NextResponse } from "next/server";
import { updateWebinar, deleteWebinar } from "@/lib/dataProvider";
import { requirePermission } from "@/lib/adminGuard";
import { normalizeLandingInput } from "@/lib/landing";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("content_webinars"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const norm = normalizeLandingInput(body);
    if (!norm.ok) return NextResponse.json({ ok: false, error: norm.error }, { status: 400 });
    const webinar = await updateWebinar(params.id, norm.value!);
    if (!webinar) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true, webinar });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("content_webinars"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const ok = await deleteWebinar(params.id);
    return NextResponse.json({ ok });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to delete." }, { status: 500 });
  }
}
