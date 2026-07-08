import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { updateCaPdf, deleteCaPdf, getCaPdfById } from "@/lib/dataProvider";
import { enqueuePurge, caPdfKeys } from "@/lib/mediaCascade";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("content_current_affairs"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const pdf = await updateCaPdf(params.id, body);
  if (!pdf) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true, pdf });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("content_current_affairs"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // Resolve the R2 object BEFORE the row is gone. Delete the DB row first, then
  // cascade the file — reference-checked so a CA PDF whose object is ALSO used
  // by a note content_item (shared media/current-affairs/pdfs key) is never
  // removed while still in use.
  const pdf = await getCaPdfById(params.id);
  const ok = await deleteCaPdf(params.id);
  if (!ok) return NextResponse.json({ ok: false }, { status: 400 });

  if (pdf) {
    const actor = await getActionActor();
    const cascade = await enqueuePurge({
      keys: caPdfKeys(pdf),
      owner: { type: "ca_pdf", id: pdf.id },
      title: pdf.title ?? null,
      actor: actor?.id,
    });
    return NextResponse.json({ ok: true, storage: { scheduled: cascade.scheduled, skippedReferenced: cascade.skippedReferenced, graceHours: cascade.graceHours } });
  }
  return NextResponse.json({ ok });
}
