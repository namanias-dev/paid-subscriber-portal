import { NextResponse } from "next/server";
import { requireAdmin, requireSuperAdmin } from "@/lib/adminGuard";
import { findDuplicateEnrollmentGroups } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

/**
 * On-demand list of duplicate ACTIVE enrollments (same phone+course). SUPER ADMIN
 * ONLY. Powers the dashboard duplicate badge + the Merge/Cancel tool. Query-based
 * (no cron); the badge clears automatically once duplicates are merged.
 */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!(await requireSuperAdmin())) return NextResponse.json({ ok: false, error: "Forbidden — Super Admin only." }, { status: 403 });
  try {
    const groups = await findDuplicateEnrollmentGroups();
    const count = groups.reduce((sum, g) => sum + (g.count - 1), 0);
    return NextResponse.json({ ok: true, groups, groupCount: groups.length, duplicateCount: count });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
