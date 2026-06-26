import { NextResponse } from "next/server";
import { getAdminAccountById, getRoleById, updateAdminAccount, deleteAdminAccount } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { requirePermission, effectivePermissions } from "@/lib/adminGuard";
import { resolvePermissions, canAssign, escalatedKeys } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAdminSession();
    if (!session || !(await requirePermission("manage_staff"))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    const target = await getAdminAccountById(params.id);
    if (!target) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));

    // If changing role/override, enforce anti-escalation against the resulting permission set.
    if (body.role_id || body.permissions_override !== undefined) {
      const roleId = body.role_id || target.role_id;
      const role = roleId ? await getRoleById(roleId) : null;
      const override = body.permissions_override !== undefined ? body.permissions_override : target.permissions_override;
      const resultPerms = resolvePermissions(role?.permissions, override);
      const actorPerms = effectivePermissions(session);
      if (!canAssign(actorPerms, resultPerms)) {
        return NextResponse.json({ ok: false, error: `You cannot grant permissions you don't have: ${escalatedKeys(actorPerms, resultPerms).join(", ")}` }, { status: 403 });
      }
    }

    // Never let the last active Super Admin be disabled or demoted.
    if (target.role_id === "super_admin" && (body.status === "disabled" || (body.role_id && body.role_id !== "super_admin"))) {
      const { getAdminAccounts } = await import("@/lib/dataProvider");
      const all = await getAdminAccounts();
      const activeSupers = all.filter((a) => a.role_id === "super_admin" && a.status === "active");
      if (activeSupers.length <= 1) return NextResponse.json({ ok: false, error: "Cannot disable/demote the last Super Admin." }, { status: 400 });
    }

    const result = await updateAdminAccount(params.id, {
      name: body.name,
      email: body.email,
      phone: body.phone,
      role_id: body.role_id,
      status: body.status,
      permissions_override: body.permissions_override,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, account: result.account });
  } catch {
    return NextResponse.json({ ok: false, error: "Update failed." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_staff"))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    const result = await deleteAdminAccount(params.id);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Delete failed." }, { status: 500 });
  }
}
