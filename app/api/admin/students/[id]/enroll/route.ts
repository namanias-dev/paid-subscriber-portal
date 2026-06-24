import { NextResponse } from "next/server";
import { getStudentById, enrollStudentInCourse, logAccess } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { requirePermission } from "@/lib/adminGuard";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAdminSession();
    if (!session || !(await requirePermission("manage_students_leads"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const actor = (session as { username?: string }).username || "admin";
    const student = await getStudentById(params.id);
    if (!student) return NextResponse.json({ ok: false, error: "Student not found." }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const res = await enrollStudentInCourse({
      phone: student.phone,
      name: student.name,
      email: student.email,
      courseSlug: String(body.courseSlug || ""),
      plan: body.plan,
      bookSeat: !!body.bookSeat,
      seatAmount: body.seatAmount != null ? Number(body.seatAmount) : null,
      installmentCount: body.installmentCount != null ? Number(body.installmentCount) : null,
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });

    await logAccess(params.id, `admin:enroll ${res.enrollment.course_title} (by ${actor})`);
    return NextResponse.json({ ok: true, enrollment: res.enrollment });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to enroll." }, { status: 500 });
  }
}
