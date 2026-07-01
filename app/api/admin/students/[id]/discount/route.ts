import { NextResponse } from "next/server";
import { getStudentById, applyEnrollmentDiscount, logAccess } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { requirePermission } from "@/lib/adminGuard";
import { formatINR } from "@/lib/dates";

/** Admin: apply a rupee discount to an enrollment's total fee (recalculates the plan). */
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
    const enrollmentId = String(body.enrollmentId || "");
    const discount = Math.round(Number(body.discount) || 0);
    const reason = body.reason ? String(body.reason).slice(0, 500) : null;
    if (!enrollmentId) return NextResponse.json({ ok: false, error: "Missing enrollment." }, { status: 400 });

    const res = await applyEnrollmentDiscount({ enrollmentId, discount, reason, appliedBy: actor });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });

    await logAccess(params.id, `admin:discount ${formatINR(discount)} on ${res.enrollment.course_title} (by ${actor})${reason ? ` · ${reason}` : ""}`);
    return NextResponse.json({ ok: true, enrollment: res.enrollment });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to apply the discount." }, { status: 500 });
  }
}
