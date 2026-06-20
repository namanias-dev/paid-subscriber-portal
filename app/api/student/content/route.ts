import { NextResponse } from "next/server";
import {
  getPublishedContent,
  getBookmarks,
  getProgress,
  getStudentById,
  getEnrollments,
  getAllCourses,
} from "@/lib/dataProvider";
import { getStudentSession } from "@/lib/session";
import { isExpired } from "@/lib/dates";

export async function GET() {
  try {
    const session = await getStudentSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const student = await getStudentById(session.student_id);
    if (!student) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const [enrollments, courses] = await Promise.all([getEnrollments(student.id), getAllCourses()]);

    if (isExpired(student.expiry_date)) {
      return NextResponse.json(
        {
          ok: false,
          expired: true,
          expiry_date: student.expiry_date,
          student,
          enrollments,
          courses,
          error: "Your access has expired. Renew to continue.",
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
