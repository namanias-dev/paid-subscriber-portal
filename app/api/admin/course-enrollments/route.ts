import { NextResponse } from "next/server";
import { getAllCourseEnrollments, getStudents } from "@/lib/dataProvider";
import { requireAnyPermission } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requireAnyPermission(["view_revenue", "manage_payments"]))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const [enrollments, students] = await Promise.all([getAllCourseEnrollments(), getStudents()]);
    // Resolve each enrollment's phone -> students.id (phone is unique) so the UI
    // can deep-link to the correct profile by id, never by (duplicate-prone) name.
    const studentIdByPhone = new Map(students.map((s) => [(s.phone || "").trim(), s.id]));
    const withStudentId = enrollments.map((e) => ({ ...e, student_id: studentIdByPhone.get((e.phone || "").trim()) ?? null }));
    return NextResponse.json({ ok: true, enrollments: withStudentId });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load enrollments." }, { status: 500 });
  }
}
