import { NextResponse } from "next/server";
import { getAllCourseEnrollments, getAllCourses } from "@/lib/dataProvider";
import { requirePermission } from "@/lib/adminGuard";
import { isActiveEnrollment } from "@/lib/installments";
import { resolveEnrollmentBatchId } from "@/lib/courseZoom";

export const dynamic = "force-dynamic";

/**
 * Enrolments with a missing or unresolvable batch on a multi-batch course.
 * These fail-open for content access until staff corrects batch_id.
 */
export async function GET() {
  try {
    if (!(await requirePermission("manage_students_leads"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const [enrollments, courses] = await Promise.all([getAllCourseEnrollments(), getAllCourses()]);
    const byId = new Map(courses.map((c) => [c.id, c]));
    const rows = enrollments
      .filter(isActiveEnrollment)
      .map((e) => {
        const course = byId.get(e.course_id);
        const batches = course?.batches || [];
        if (batches.length <= 1) return null;
        const resolved = course ? resolveEnrollmentBatchId(course, e) : null;
        const missingStored = !e.batch_id || !String(e.batch_id).trim();
        if (!missingStored && resolved) return null;
        return {
          enrollmentId: e.id,
          phone: e.phone,
          studentName: e.student_name,
          courseId: e.course_id,
          courseTitle: e.course_title || course?.title || "Course",
          batchId: e.batch_id || null,
          batchLabel: e.batch_label || null,
          resolvedBatchId: resolved,
          status: e.status,
          amountPaid: e.amount_paid,
          createdAt: e.created_at,
          reason: !resolved
            ? missingStored
              ? "missing_batch"
              : "unresolvable_batch"
            : "missing_batch_id_label_ok",
        };
      })
      .filter(Boolean);

    return NextResponse.json({ ok: true, count: rows.length, rows });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load ambiguous enrolments." }, { status: 500 });
  }
}
