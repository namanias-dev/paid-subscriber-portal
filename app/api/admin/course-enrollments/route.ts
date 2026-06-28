import { NextResponse } from "next/server";
import { getAllCourseEnrollments } from "@/lib/dataProvider";
import { requireAnyPermission } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requireAnyPermission(["view_revenue", "manage_payments"]))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const enrollments = await getAllCourseEnrollments();
    return NextResponse.json({ ok: true, enrollments });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load enrollments." }, { status: 500 });
  }
}
