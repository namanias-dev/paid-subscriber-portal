import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { updateCaCategory, deleteCaCategory } from "@/lib/dataProvider";
import { sanitizeHtml } from "@/lib/sanitizeHtml";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.description === "string") body.description = sanitizeHtml(body.description) || null;
  const category = await updateCaCategory(params.id, body);
  if (!category) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true, category });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const ok = await deleteCaCategory(params.id);
  return NextResponse.json({ ok });
}
