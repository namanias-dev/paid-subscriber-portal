import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getResources, getAllQuizzes, getPublicWebinars, getAllCourses, getCaPdfs } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

/** Picker + internal-linking data for the resource editor. */
export async function GET() {
  if (!(await requirePermission("content_resources"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const [resources, quizzes, webinars, courses, pdfs] = await Promise.all([
    getResources(),
    getAllQuizzes(),
    getPublicWebinars(),
    getAllCourses(),
    getCaPdfs(),
  ]);
  const meta = {
    resources: resources.map((r) => ({
      slug: r.slug,
      title: r.title,
      category: r.category,
      subject: r.subject,
      tags: r.tags,
      focus_keyword: r.focus_keyword,
      status: r.status,
    })),
    quizzes: quizzes.map((q) => ({ slug: q.slug, title: q.title })),
    webinars: webinars.map((w) => ({ slug: w.slug, title: w.title })),
    courses: courses.filter((c) => c.slug).map((c) => ({ slug: c.slug, title: c.title })),
    pdfs: pdfs.map((p) => ({ id: p.id, title: p.title, kind: p.kind })),
  };
  return NextResponse.json({ ok: true, meta });
}
