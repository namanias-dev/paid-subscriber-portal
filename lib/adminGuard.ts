import { getAdminSession } from "./session";
import { hasPermission, allPermissions, type PermissionKey, type PermissionSet } from "./permissions";
import type { AdminSessionPayload } from "./types";

/**
 * Effective permissions for a session. Legacy tokens issued before RBAC have no
 * `permissions` field — treat those as full access (they were Super Admins) so
 * nobody is locked out until their 7-day session naturally refreshes.
 */
export function effectivePermissions(session: AdminSessionPayload | null): PermissionSet {
  if (!session) return {};
  if (session.permissions === undefined) return allPermissions();
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
