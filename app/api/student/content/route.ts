import { NextResponse } from "next/server";
import {
  getPublishedContent,
  getBookmarks,
  getProgress,
  getEnrollments,
  getAllCourses,
  getActiveStaffCourseIds,
} from "@/lib/dataProvider";
import { resolveStudentAccess } from "@/lib/studentAccess";
import { getAdminSession } from "@/lib/session";
import type { Enrollment } from "@/lib/types";

export async function GET() {
  try {
    const { session, student, blocked, reason } = await resolveStudentAccess();
    if (!session) {
      // Staff comp access: feed the dashboard shell from staff grants so a logged-in
      // staff member sees their granted courses through the normal experience.
      const staff = await staffDashboardPayload();
      if (staff) return NextResponse.json(staff);
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!student) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const [enrollments, courses] = await Promise.all([getEnrollments(student.id), getAllCourses()]);

    // Auto-expire OR admin revoke → graceful block (data is retained, never deleted).
    if (blocked) {
      return NextResponse.json(
        {
          ok: false,
          expired: true,
          revoked: reason === "revoked",
          expiry_date: student.expiry_date,
          student,
          enrollments,
          courses,
          error:
            reason === "revoked"
              ? "Your access has been paused. Please contact us to restore it."
              : "Your access has expired. Renew to continue.",
        },
        { status: 403 }
      );
    }

    const [content, bookmarks, progress] = await Promise.all([
      getPublishedContent(),
      getBookmarks(student.id),
      getProgress(student.id),
    ]);

    return NextResponse.json({ ok: true, student, content, bookmarks, progress, enrollments, courses });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load content." }, { status: 500 });
  }
}

/**
 * Build the dashboard payload for a logged-in STAFF member from their comp
 * grants. Granted courses are surfaced as active (synthesized, fee-free)
 * enrollments so "My Courses" + Class Hub work identically — no payment data.
 */
async function staffDashboardPayload() {
  const admin = await getAdminSession();
  if (!admin?.admin_id) return null;
  const [courseIds, courses] = await Promise.all([getActiveStaffCourseIds(admin.admin_id), getAllCourses()]);
  const granted = new Set(courseIds);
  const now = new Date().toISOString();
  const enrollments: Enrollment[] = courses
    .filter((c) => granted.has(c.id))
    .map((c) => ({
      id: `staff-${admin.admin_id}-${c.id}`,
      student_id: `staff:${admin.admin_id}`,
      course_id: c.id,
      status: "active",
      fee_total: 0,
      fee_collected: 0,
      pending: 0,
      installments: [],
      progress: 0,
      enrolled_at: now,
    }));
  const content = await getPublishedContent();
  return { ok: true, staff: true, student: null, content, bookmarks: [], progress: [], enrollments, courses };
}
