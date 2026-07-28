import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/session";
import {
  requireAnyPermission, currentAdminId, effectivePermissions,
} from "@/lib/adminGuard";
import { hasPermission, isSuperAdmin } from "@/lib/permissions";
import {
  upsertAccessOverride, deleteAccessOverride, getAllAccessOverrides, getCourseEnrollmentsByPhone,
} from "@/lib/dataProvider";
import { validateAccessGrant, ACCESS_GRANT_MAX_DAYS_DEFAULT } from "@/lib/accessOverridePolicy";
import { getSupabaseAdmin } from "@/lib/supabase";

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

  const actor = session.username || (await currentAdminId()) || "admin";
  const reason = typeof body.note === "string" ? body.note : typeof body.reason === "string" ? body.reason : "";

  if (mode === "revoke") {
    await deleteAccessOverride(phone, courseId);
    await appendOverrideEvent({
      phone, courseId, actor, kind: "revoked",
      detail: "Access grant revoked — schedule state restored",
      reason: reason.trim() || null,
      meta: {},
    });
    return NextResponse.json({ ok: true });
  }

  const perms = effectivePermissions(session);
  const elevated = hasPermission(perms, "manage_staff") || isSuperAdmin(perms);
  const check = validateAccessGrant({
    expiresAt: body.expires_at ? String(body.expires_at) : null,
    reason,
    elevated,
  });
  if (!check.ok) {
    return NextResponse.json({ ok: false, error: check.detail, code: check.error }, { status: 400 });
  }

  // Snapshot schedule BEFORE grant — grants must never mutate fees/dues.
  const before = await scheduleFingerprint(phone, courseId);

  await upsertAccessOverride({
    phone,
    course_id: courseId,
    mode: "grant",
    expires_at: String(body.expires_at),
    note: reason.trim(),
    created_by: actor,
  });

  const after = await scheduleFingerprint(phone, courseId);
  if (before !== after) {
    // Should be impossible — roll the override back so we never leave a dirty schedule.
    await deleteAccessOverride(phone, courseId);
    return NextResponse.json({
      ok: false,
      error: "Grant appeared to change the payment schedule — aborted. Contact engineering.",
    }, { status: 500 });
  }

  await appendOverrideEvent({
    phone, courseId, actor, kind: "granted",
    detail: `Access granted for ${check.days} day(s) until ${String(body.expires_at).slice(0, 10)}`,
    reason: reason.trim(),
    meta: { days: check.days, expires_at: body.expires_at, scheduleUnchanged: true, elevated },
  });

  return NextResponse.json({
    ok: true,
    days: check.days,
    elevated: elevated && check.days > ACCESS_GRANT_MAX_DAYS_DEFAULT,
  });
}

export async function DELETE(req: Request) {
  if (!(await requireAnyPermission([...FINANCE_PERMS]))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const phone = url.searchParams.get("phone") || "";
  const courseId = url.searchParams.get("course_id") || "";
  if (!phone || !courseId) return NextResponse.json({ ok: false, error: "phone and course_id required" }, { status: 400 });
  const session = await getAdminSession();
  const actor = session?.username || "admin";
  await deleteAccessOverride(phone, courseId);
  await appendOverrideEvent({
    phone, courseId, actor, kind: "revoked",
    detail: "Access grant deleted",
    reason: null,
    meta: {},
  });
  return NextResponse.json({ ok: true });
}

async function scheduleFingerprint(phone: string, courseId: string): Promise<string> {
  const rows = await getCourseEnrollmentsByPhone(phone);
  const e = rows.find((r) => r.course_id === courseId && r.status !== "cancelled");
  if (!e) return "";
  return JSON.stringify({
    total_fee: e.total_fee,
    amount_paid: e.amount_paid,
    schedule: e.schedule,
    plan_type: e.plan_type,
  });
}

async function appendOverrideEvent(input: {
  phone: string;
  courseId: string;
  actor: string;
  kind: "granted" | "revoked" | "shortened";
  detail: string;
  reason: string | null;
  meta: Record<string, unknown>;
}): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.from("access_override_events").insert({
    phone: input.phone,
    course_id: input.courseId,
    actor: input.actor,
    kind: input.kind,
    detail: input.detail,
    reason: input.reason,
    meta: input.meta,
  }).then(() => undefined, () => undefined);
}
