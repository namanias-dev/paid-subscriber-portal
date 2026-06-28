import { getAdminSession } from "./session";
import { hasPermission, allPermissions, isSuperAdmin, type PermissionKey, type PermissionSet } from "./permissions";
import type { AdminSessionPayload } from "./types";

/**
 * Effective permissions for a session. Legacy tokens issued before RBAC have no
 * `permissions` field — treat those as full access (they were Super Admins) so
 * nobody is locked out until their 7-day session naturally refreshes.
 */
export function effectivePermissions(session: AdminSessionPayload | null): PermissionSet {
  if (!session) return {};
  if (session.permissions === undefined) return allPermissions();
  // A Super Admin is unrestricted by definition: always grant every permission,
  // including ones added AFTER this token/role snapshot was minted (e.g. send_sms).
  // This means no re-login or role reseed is needed when new permissions ship.
  if (isSuperAdmin(session.permissions)) return allPermissions();
  return session.permissions;
}

export async function requireAdmin(): Promise<boolean> {
  const session = await getAdminSession();
  return !!session;
}

/** Effective permissions of the current admin (empty if not logged in). */
export async function getAdminPermissions(): Promise<PermissionSet> {
  const session = await getAdminSession();
  return effectivePermissions(session);
}

/** True only if the logged-in admin holds the given permission. */
export async function requirePermission(key: PermissionKey): Promise<boolean> {
  const session = await getAdminSession();
  if (!session) return false;
  return hasPermission(effectivePermissions(session), key);
}

/** True if the admin holds ANY of the given permissions. */
export async function requireAnyPermission(keys: PermissionKey[]): Promise<boolean> {
  const session = await getAdminSession();
  if (!session) return false;
  const perms = effectivePermissions(session);
  return keys.some((k) => hasPermission(perms, k));
}

/** True only for a Super Admin (manage_roles + manage_staff + view_revenue). */
export async function requireSuperAdmin(): Promise<boolean> {
  const session = await getAdminSession();
  if (!session) return false;
  return isSuperAdmin(effectivePermissions(session));
}

/** Current admin's id (for sms_logs.sent_by_user_id), or null. */
export async function currentAdminId(): Promise<string | null> {
  const session = await getAdminSession();
  return session?.admin_id || null;
}

/** Identity for attributing payment/audit actions to the logged-in admin. */
export interface ActionActor {
  id: string;
  name: string | null;
  role: string | null;
  isSuper: boolean;
}

/** Resolve the current admin as an audit actor (null when not logged in). */
export async function getActionActor(): Promise<ActionActor | null> {
  const session = await getAdminSession();
  if (!session) return null;
  return {
    id: session.username || session.admin_id || "admin",
    name: session.username || null,
    role: session.role_name || session.role || null,
    isSuper: isSuperAdmin(effectivePermissions(session)),
  };
}
