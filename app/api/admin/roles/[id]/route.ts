import { NextResponse } from "next/server";
import { getRoleById, updateRole, deleteRole } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { requirePermission, effectivePermissions } from "@/lib/adminGuard";
import { canAssign, escalatedKeys, type PermissionSet } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAdminSession();
    if (!session || !(await requirePermission("manage_roles"))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    const role = await getRoleById(params.id);
    if (!role) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (role.id === "super_admin") return NextResponse.json({ ok: false, error: "The Super Admin role cannot be modified." }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const permissions = (body.permissions || role.permissions) as PermissionSet;
    const actorPerms = effectivePermissions(session);
    if (!canAssign(actorPerms, permissions)) {
      return NextResponse.json({ ok: false, error: `You cannot grant permissions you don't have: ${escalatedKeys(actorPerms, permissions).join(", ")}` }, { status: 403 });
    }
    const updated = await updateRole(params.id, {
      name: body.name ?? role.name,
      description: body.description ?? role.description,
      permissions,
    });
    return NextResponse.json({ ok: true, role: updated });
  } catch {
    return NextResponse.json({ ok: false, error: "Update failed." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_roles"))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    const result = await deleteRole(params.id);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Delete failed." }, { status: 500 });
  }
}
