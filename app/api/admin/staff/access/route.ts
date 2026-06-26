import { NextResponse } from "next/server";
import {
  getAllCourses,
  getWebinars,
  getAllStaffAccessGrants,
  setStaffAccess,
  revokeAllStaffAccess,
} from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { requirePermission } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

type GrantMap = Record<string, { courseIds: string[]; webinarIds: string[] }>;

/**
 * Options + current grants for the Staff & Roles "Grant access" UI.
 * Returns the course/webinar pick-lists, plus a per-staff grant map for badges,
 * the per-staff modal (pre-check) and the bulk modal. One call, no N+1.
 */
export async function GET() {
  try {
    if (!(await requirePermission("manage_staff"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const [courses, webinars, grants] = await Promise.all([
      getAllCourses(),
      getWebinars(),
      getAllStaffAccessGrants(),
    ]);
    const byStaff: GrantMap = {};
    for (const g of grants) {
      const e = (byStaff[g.admin_id] ||= { courseIds: [], webinarIds: [] });
      if (g.kind === "course") e.courseIds.push(g.ref_id);
      else e.webinarIds.push(g.ref_id);
    }
    return NextResponse.json({
      ok: true,
      courses: courses.map((c) => ({ id: c.id, title: c.title, category: c.category })),
      webinars: webinars.map((w) => ({ id: w.id, title: w.title })),
      grants: byStaff,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load staff access." }, { status: 500 });
  }
}

/** Reconcile ONE staff member's grants to the exact selection (grant + revoke). */
export async function PUT(req: Request) {
  try {
    const session = await getAdminSession();
    if (!session || !(await requirePermission("manage_staff"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const adminId = String(body.adminId || "").trim();
    if (!adminId) return NextResponse.json({ ok: false, error: "Staff id is required." }, { status: 400 });
    const courseIds = Array.isArray(body.courseIds) ? body.courseIds.map(String) : [];
    const webinarIds = Array.isArray(body.webinarIds) ? body.webinarIds.map(String) : [];
    await setStaffAccess(adminId, { courseIds, webinarIds }, session.username || session.admin_id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to update staff access." }, { status: 500 });
  }
}

/** Revoke ALL access for one staff member. */
export async function DELETE(req: Request) {
  try {
    if (!(await requirePermission("manage_staff"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const adminId = String(body.adminId || "").trim();
    if (!adminId) return NextResponse.json({ ok: false, error: "Staff id is required." }, { status: 400 });
    await revokeAllStaffAccess(adminId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to revoke staff access." }, { status: 500 });
  }
}
