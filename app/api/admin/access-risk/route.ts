import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import { getAllCourseEnrollments, getAllCourses, getAllAccessOverrides } from "@/lib/dataProvider";
import { lectureAccessForCourse } from "@/lib/entitlements";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/**
 * Proactive money-recovery view: enrolled learners whose lecture access is
 * BLOCKED (past due+15d / expired / revoked) or AT RISK (in grace, or expiring
 * within 7 days). Reuses the SAME lectureAccessForCourse engine as playback.
 */
export async function GET() {
  if (!(await getAdminSession())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const [enrollments, courses, overrides] = await Promise.all([
    getAllCourseEnrollments(),
    getAllCourses(),
    getAllAccessOverrides(),
  ]);
  const byId = new Map(courses.map((c) => [c.id, c]));
  const now = Date.now();

  const rows = enrollments
    .filter((e) => e.status !== "cancelled")
    .map((e) => {
      const override = overrides.find((o) => o.phone === e.phone && o.course_id === e.course_id);
      const access = lectureAccessForCourse(byId.get(e.course_id), e, override, false, now);
      const dueMs = access.graceEndsAt ? (Date.parse(access.graceEndsAt) - 15 * DAY) : 0;
      const daysOverdue = dueMs && now > dueMs ? Math.floor((now - dueMs) / DAY) : 0;
      return {
        enrollmentId: e.id,
        phone: e.phone,
        student: e.student_name,
        email: e.email,
        courseId: e.course_id,
        courseTitle: e.course_title || byId.get(e.course_id)?.title || "Course",
        batchLabel: e.batch_label,
        planType: e.plan_type,
        enrollmentStatus: e.status,
        amountDue: access.amountDue ?? Math.max(0, (e.total_fee || 0) - (e.amount_paid || 0)),
        daysOverdue,
        access,
      };
    })
    .filter((r) => !r.access.allowed || r.access.status === "grace" || r.access.status === "expiring")
    .sort((a, b) => {
      const rank = (s: string) => (s === "blocked" ? 0 : s === "grace" ? 1 : 2);
      const d = rank(a.access.status) - rank(b.access.status);
      return d !== 0 ? d : b.daysOverdue - a.daysOverdue;
    });

  return NextResponse.json({ ok: true, rows });
}
