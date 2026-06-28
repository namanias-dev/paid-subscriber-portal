import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getCaCategories, getCaTags, getCaPdfs, getAllQuizzes } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

/** Picker data for the article editor: categories, tags, PDFs and quizzes. */
export async function GET() {
  if (!(await requirePermission("content_current_affairs"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const [categories, tags, pdfs, quizzes] = await Promise.all([
    getCaCategories(),
    getCaTags(),
    getCaPdfs(),
    getAllQuizzes(),
  ]);
  const meta = {
    categories: categories.map((c) => ({ slug: c.slug, name: c.name })),
    tags: tags.map((t) => ({ slug: t.slug, name: t.name })),
    pdfs: pdfs.map((p) => ({ id: p.id, title: p.title, kind: p.kind })),
    quizzes: quizzes.map((q) => ({ slug: q.slug, title: q.title })),
  };
  return NextResponse.json({ ok: true, meta });
}
