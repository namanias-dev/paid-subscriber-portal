import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/adminGuard";
import { getAllCourseEnrollments, getAllCourses } from "@/lib/dataProvider";
import { isActiveEnrollment } from "@/lib/enrollmentScope";
import { resolveEnrollmentBatchStart, derivedBatchLabelFromStart, earliestContentDateForCourse } from "@/lib/batchStart";
import { getSupabaseAdmin } from "@/lib/supabase";
import { pageThrough } from "@/lib/dataProvider";
import type { ContentItem } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Admin list: active enrollments whose batch start is UNKNOWN after all fallbacks.
 * Fail-safe access means these students are never auto-blocked / auto-SMS'd.
 */
export async function GET() {
  if (!(await requireAnyPermission(["view_revenue", "manage_payments", "manage_students_leads"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const [enrollments, courses] = await Promise.all([getAllCourseEnrollments(), getAllCourses()]);
  const byId = new Map(courses.map((c) => [c.id, c]));

  let content: ContentItem[] = [];
  const db = getSupabaseAdmin();
  if (db) {
    content = await pageThrough<ContentItem>(() =>
      db.from("content_items").select("id, date, course_id, course_ids").order("id"),
    ).catch(() => []);
  }

  const rows: {
    courseTitle: string;
    batchLabel: string | null;
    batchId: string | null;
    catalogStart: string | null;
    derivedLabel: string | null;
    studentCount: number;
    provenance: string;
  }[] = [];

  const groups = new Map<string, typeof rows[0]>();
  for (const e of enrollments) {
    if (!isActiveEnrollment(e)) continue;
    const course = byId.get(e.course_id);
    const earliest = earliestContentDateForCourse(content, e.course_id);
    const start = resolveEnrollmentBatchStart(course, e, {
      earliestClassISO: earliest,
      createdAtISO: course?.created_at ?? null,
    });
    if (start.iso) continue;
    const key = `${e.course_id}|${e.batch_id || e.batch_label || ""}`;
    const batch = course?.batches?.find((b) => b.id === e.batch_id);
    const existing = groups.get(key);
    if (existing) {
      existing.studentCount++;
      continue;
    }
    groups.set(key, {
      courseTitle: e.course_title || course?.title || "Course",
      batchLabel: e.batch_label ?? null,
      batchId: e.batch_id ?? null,
      catalogStart: batch?.start_date ?? course?.batch_start ?? null,
      derivedLabel: derivedBatchLabelFromStart(
        batch?.start_date ?? null,
        Array.isArray(batch?.mode) ? batch?.mode[0] : batch?.mode,
        Array.isArray(batch?.timing) ? batch?.timing[0] : batch?.timing,
      ),
      studentCount: 1,
      provenance: start.provenance,
    });
  }

  for (const g of groups.values()) rows.push(g);
  rows.sort((a, b) => b.studentCount - a.studentCount);

  return NextResponse.json({
    ok: true,
    totalGroups: rows.length,
    totalStudents: rows.reduce((a, r) => a + r.studentCount, 0),
    rows,
  });
}
