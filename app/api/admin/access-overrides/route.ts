import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import {
  requireAnyPermission, currentAdminId, effectivePermissions,
} from "@/lib/adminGuard";
import { hasPermission, isSuperAdmin } from "@/lib/permissions";
import { getAllAccessOverrides } from "@/lib/dataProvider";
import {
  extendCourseAccess,
  revokeCourseExtension,
  ACCESS_GRANT_MAX_DAYS_DEFAULT,
} from "@/lib/accessActions";

const FINANCE_PERMS = ["view_revenue", "manage_payments"] as const;

export const dynamic = "force-dynamic";

/** Manual per-learner per-course access override (grant / extend / revoke). Always wins for playback. */
export async function GET() {
  if (!(await requireAnyPermission([...FINANCE_PERMS]))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const overrides = await getAllAccessOverrides();
  const indefinite = overrides.filter((o) => o.mode === "grant" && !o.expires_at);
  return NextResponse.json({
    ok: true,
    overrides,
    policy: { maxDaysDefault: ACCESS_GRANT_MAX_DAYS_DEFAULT, reasonRequired: true, indefiniteForbidden: true },
    indefiniteGrants: indefinite.map((o) => ({
      phone: o.phone, course_id: o.course_id, created_by: o.created_by, note: o.note,
    })),
  });
}

export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session || !(await requireAnyPermission([...FINANCE_PERMS]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const phone = String(body.phone || "").trim();
  const courseId = String(body.course_id || "");
  const mode = body.mode === "revoke" ? "revoke" : "grant";
  if (!phone || !courseId) return NextResponse.json({ ok: false, error: "phone and course_id required" }, { status: 400 });

  const actor = {
    id: (await currentAdminId()) || null,
    name: session.username || "admin",
  };
  const reason = typeof body.note === "string" ? body.note : typeof body.reason === "string" ? body.reason : "";
  const enrollmentId = typeof body.enrollment_id === "string" ? body.enrollment_id : null;

  if (mode === "revoke") {
    const r = await revokeCourseExtension({
      phone, courseId, actor, reason: reason.trim() || "Access grant revoked — schedule state restored", enrollmentId,
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const perms = effectivePermissions(session);
  const elevated = hasPermission(perms, "manage_staff") || isSuperAdmin(perms);
  const r = await extendCourseAccess({
    phone,
    courseId,
    expiresAt: String(body.expires_at || ""),
    reason,
    actor,
    elevated,
    enrollmentId,
  });
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error, code: r.code }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    days: r.days,
    elevated: elevated && r.days > ACCESS_GRANT_MAX_DAYS_DEFAULT,
  });
}

export async function DELETE(req: Request) {
  if (!(await requireAnyPermission([...FINANCE_PERMS]))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const phone = url.searchParams.get("phone") || "";
  const courseId = url.searchParams.get("course_id") || "";
  if (!phone || !courseId) return NextResponse.json({ ok: false, error: "phone and course_id required" }, { status: 400 });
  const session = await getAdminSession();
  const actor = { id: null as string | null, name: session?.username || "admin" };
  const r = await revokeCourseExtension({ phone, courseId, actor, reason: "Access grant deleted" });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}
