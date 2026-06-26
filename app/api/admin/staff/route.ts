import { NextResponse } from "next/server";
import { getAdminAccounts, getRoles, getRoleById, createAdminAccount } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { requirePermission, effectivePermissions } from "@/lib/adminGuard";
import { resolvePermissions, canAssign, escalatedKeys } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requirePermission("manage_staff"))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    const [accounts, roles] = await Promise.all([getAdminAccounts(), getRoles()]);
    return NextResponse.json({ ok: true, accounts, roles });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load staff." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getAdminSession();
    if (!session || !(await requirePermission("manage_staff"))) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const username = String(body.username || "").trim();
    const role_id = String(body.role_id || "").trim();
    if (!name || !username || !role_id) return NextResponse.json({ ok: false, error: "Name, username and role are required." }, { status: 400 });

    const role = await getRoleById(role_id);
    if (!role) return NextResponse.json({ ok: false, error: "Invalid role." }, { status: 400 });

    // Anti-escalation: the creator can only grant permissions they themselves hold.
    // effectivePermissions() expands legacy/Super-Admin tokens to "all" so Super Admin is never falsely blocked.
    const actorPerms = effectivePermissions(session);
    const targetPerms = resolvePermissions(role.permissions, body.permissions_override || null);
    if (!canAssign(actorPerms, targetPerms)) {
      return NextResponse.json({ ok: false, error: `You cannot grant permissions you don't have: ${escalatedKeys(actorPerms, targetPerms).join(", ")}` }, { status: 403 });
    }

    const result = await createAdminAccount({
      name,
      username,
      email: body.email || null,
      phone: body.phone || null,
      role_id,
      password: typeof body.password === "string" && body.password ? body.password : undefined,
      must_change_password: body.must_change_password !== false,
      permissions_override: body.permissions_override || null,
      created_by: session.username,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    // Password is returned ONCE for the admin to share; never stored in plaintext.
    return NextResponse.json({ ok: true, account: result.account, password: result.password });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to add staff." }, { status: 500 });
  }
}
