import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { updateCaArticle, deleteCaArticle } from "@/lib/dataProvider";
import { normalizeCaArticleInput } from "@/lib/caNormalize";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const norm = normalizeCaArticleInput(body);
    if (!norm.ok) return NextResponse.json({ ok: false, error: norm.error }, { status: 400 });
    const article = await updateCaArticle(params.id, norm.value!);
    if (!article) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    return NextResponse.json({ ok: true, article });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update article.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const ok = await deleteCaArticle(params.id);
    return NextResponse.json({ ok });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to delete article." }, { status: 500 });
  }
}
