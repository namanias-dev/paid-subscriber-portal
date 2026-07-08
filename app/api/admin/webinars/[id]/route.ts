import { NextResponse } from "next/server";
import { updateWebinar, deleteWebinar, getWebinarById } from "@/lib/dataProvider";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { normalizeLandingInput } from "@/lib/landing";
import { enqueuePurge, webinarKeys } from "@/lib/mediaCascade";

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

    // Resolve the recording object before the row is gone, delete the row, then
    // cascade. webinarKeys() excludes a SHARED reference (a reused course video),
    // and enqueuePurge re-checks references, so we only ever reclaim a webinar's
    // OWN uploaded recording.
    const w = await getWebinarById(params.id);
    const ok = await deleteWebinar(params.id);
    if (!ok) return NextResponse.json({ ok: false }, { status: 400 });

    if (w) {
      const actor = await getActionActor();
      const cascade = await enqueuePurge({
        keys: webinarKeys(w),
        owner: { type: "webinar", id: w.id },
        title: w.title ?? null,
        actor: actor?.id,
      });
      return NextResponse.json({ ok: true, storage: { scheduled: cascade.scheduled, skippedReferenced: cascade.skippedReferenced, graceHours: cascade.graceHours } });
    }
    return NextResponse.json({ ok });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to delete." }, { status: 500 });
  }
}
