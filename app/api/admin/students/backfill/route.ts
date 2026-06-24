import { NextResponse } from "next/server";
import { backfillPayingStudents, logAccess } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { requirePermission } from "@/lib/adminGuard";

/**
 * Idempotent: derives a master student for every existing paying/registered person
 * (by phone) so they all surface in Students & Enrollments. Safe to run repeatedly —
 * it never duplicates or alters payment/enrollment records.
 */
export async function POST() {
  try {
    const session = await getAdminSession();
    if (!session || !(await requirePermission("manage_students_leads"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const actor = (session as { username?: string }).username || "admin";
    const result = await backfillPayingStudents();
    if (result.studentsCreated > 0 || result.buyersCreated > 0) {
      await logAccess(
        null,
        `admin:sync paying students → ${result.studentsCreated} new student(s), ${result.buyersCreated} new login(s) (by ${actor})`
      );
    }
    return NextResponse.json({ ok: true, result });
  } catch {
    return NextResponse.json({ ok: false, error: "Backfill failed." }, { status: 500 });
  }
}
