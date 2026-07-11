import { getSupabase } from "./supabase";
import {
  resolvePermissions,
  isSuperAdmin,
  type PermissionSet,
} from "@portal/lib/permissions";

/**
 * AIVA login verifies against the SHARED admin_users + roles tables (same credential store as
 * the portal) and reuses the portal's permission rules (resolvePermissions + isSuperAdmin).
 * This is NOT a parallel auth system — it is the same source of truth with an AIVA-scoped session.
 *
 * Only Super Admins may access AIVA in the first release.
 */

export type AuthResult =
  | { ok: true; admin_id: string; username: string; name?: string; role_id?: string; is_super: boolean }
  | { ok: false; error: string; code: "no_db" | "bad_credentials" | "disabled" | "not_super" };

export async function verifyCredentials(username: string, password: string): Promise<AuthResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "AIVA is not connected to the database.", code: "no_db" };

  const uname = (username || "").trim().toLowerCase();
  const { data: row } = await sb
    .from("admin_users")
    .select("id, username, password_hash, role, role_id, name, status, permissions_override")
    .ilike("username", uname)
    .maybeSingle();

  if (!row || !row.password_hash) return { ok: false, error: "Invalid username or password.", code: "bad_credentials" };
  if (row.status && row.status !== "active") return { ok: false, error: "This account is disabled.", code: "disabled" };

  const bcrypt = await import("bcryptjs");
  const ok = await bcrypt.compare(password, String(row.password_hash));
  if (!ok) return { ok: false, error: "Invalid username or password.", code: "bad_credentials" };

  // Resolve effective permissions the same way the portal does.
  const roleId = (row.role_id as string) || "super_admin";
  const { data: roleRow } = await sb.from("roles").select("permissions").eq("id", roleId).maybeSingle();
  const rolePerms = (roleRow?.permissions as PermissionSet) || null;
  const perms = resolvePermissions(rolePerms, (row.permissions_override as PermissionSet) || null);

  if (!isSuperAdmin(perms)) {
    return { ok: false, error: "AIVA is restricted to Super Admins in this release.", code: "not_super" };
  }

  return {
    ok: true,
    admin_id: String(row.id),
    username: String(row.username),
    name: row.name ? String(row.name) : undefined,
    role_id: roleId,
    is_super: true,
  };
}
