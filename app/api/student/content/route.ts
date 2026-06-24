import { NextResponse } from "next/server";
import {
  getPublishedContent,
  getBookmarks,
  getProgress,
  getEnrollments,
  getAllCourses,
} from "@/lib/dataProvider";
import { resolveStudentAccess } from "@/lib/studentAccess";

export async function GET() {
  try {
    const { session, student, blocked, reason } = await resolveStudentAccess();
    if (!session) {
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
