import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getWebinars, getAllCourses } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";
const PERM = "manage_students_leads" as const;

/**
 * Destination options for the link builder so marketers pick an existing
 * webinar/course instead of pasting URLs. Returns clean site paths.
 */
export async function GET() {
  try {
    if (!(await requirePermission(PERM))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const [webinars, courses] = await Promise.all([getWebinars(), getAllCourses()]);
    return NextResponse.json({
      ok: true,
      webinars: webinars
        .filter((w) => w.active !== false)
        .map((w) => ({ id: w.id, title: w.title, path: `/webinars/${w.slug}` })),
      courses: courses
        .filter((c) => c.status === "published" && c.active !== false)
        .map((c) => ({ id: c.id, title: c.title, path: `/courses/${c.slug}` })),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load destinations." }, { status: 500 });
  }
}
