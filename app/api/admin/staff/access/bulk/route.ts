import { NextResponse } from "next/server";
import { bulkGrantStaffAccess } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { requirePermission } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

/** Additively grant the same courses/webinars to MANY staff at once (idempotent). */
export async function POST(req: Request) {
  try {
    const session = await getAdminSession();
    if (!session || !(await requirePermission("manage_staff"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const adminIds = Array.isArray(body.adminIds) ? body.adminIds.map(String) : [];
    const courseIds = Array.isArray(body.courseIds) ? body.courseIds.map(String) : [];
    const webinarIds = Array.isArray(body.webinarIds) ? body.webinarIds.map(String) : [];
    if (!adminIds.length) return NextResponse.json({ ok: false, error: "Select at least one staff member." }, { status: 400 });
    if (!courseIds.length && !webinarIds.length) {
      return NextResponse.json({ ok: false, error: "Select at least one course or webinar." }, { status: 400 });
    }
    const result = await bulkGrantStaffAccess(adminIds, { courseIds, webinarIds }, session.username || session.admin_id);
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to bulk-grant access." }, { status: 500 });
  }
}
