import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { updateCaPdf, deleteCaPdf } from "@/lib/dataProvider";

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
  const ok = await deleteCaPdf(params.id);
  return NextResponse.json({ ok });
}
