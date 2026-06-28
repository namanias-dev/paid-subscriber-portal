import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getCaArticles, addCaArticle } from "@/lib/dataProvider";
import { normalizeCaArticleInput } from "@/lib/caNormalize";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requirePermission("content_current_affairs"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const articles = await getCaArticles();
    return NextResponse.json({ ok: true, articles });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load articles." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requirePermission("content_current_affairs"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    if (!body.title) return NextResponse.json({ ok: false, error: "Title required." }, { status: 400 });
    const norm = normalizeCaArticleInput(body);
    if (!norm.ok) return NextResponse.json({ ok: false, error: norm.error }, { status: 400 });
    const article = await addCaArticle(norm.value!);
    return NextResponse.json({ ok: true, article });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create article.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
