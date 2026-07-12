import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { updateAnnouncement, deleteAnnouncement } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("manage_settings"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const announcement = await updateAnnouncement(params.id, body);
  if (!announcement) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true, announcement });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("manage_settings"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const ok = await deleteAnnouncement(params.id);
  if (!ok) return NextResponse.json({ ok: false }, { status: 400 });
  return NextResponse.json({ ok: true });
}
