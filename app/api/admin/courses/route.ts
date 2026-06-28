import { NextResponse } from "next/server";
import { getAllCourses, addCourse } from "@/lib/dataProvider";
import { requirePermission, requireAnyPermission } from "@/lib/adminGuard";
import { normalizeLandingInput } from "@/lib/landing";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requireAnyPermission(["content_courses", "manage_students_leads"]))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const courses = await getAllCourses();
    return NextResponse.json({ ok: true, courses });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load courses." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requirePermission("content_courses"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    if (!body.title) return NextResponse.json({ ok: false, error: "Title required." }, { status: 400 });
    const norm = normalizeLandingInput(body);
    if (!norm.ok) return NextResponse.json({ ok: false, error: norm.error }, { status: 400 });
    const course = await addCourse(norm.value!);
    return NextResponse.json({ ok: true, course });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create course.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
