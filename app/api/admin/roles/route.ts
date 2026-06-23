import { NextResponse } from "next/server";
import { getRoles, createRole } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { requirePermission } from "@/lib/adminGuard";
import { canAssign, escalatedKeys, type PermissionSet } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Any staff manager (or role manager) can read the role catalogue.
    if (!(await requirePermission("manage_staff")) && !(await requirePermission("manage_roles"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const roles = await getRoles();
    return NextResponse.json({ ok: true, roles });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load roles." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getAdminSession();
    if (!session || !(await requirePermission("manage_roles"))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    if (!name) return NextResponse.json({ ok: false, error: "Role name required." }, { status: 400 });
    const permissions = (body.permissions || {}) as PermissionSet;
    // Cannot mint a role more powerful than yourself.
    if (!canAssign(session.permissions || {}, permissions)) {
      return NextResponse.json({ ok: false, error: `You cannot grant permissions you don't have: ${escalatedKeys(session.permissions || {}, permissions).join(", ")}` }, { status: 403 });
    }
    const role = await createRole({ name, description: body.description || "", permissions });
    return NextResponse.json({ ok: true, role });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to create role." }, { status: 500 });
  }
}
