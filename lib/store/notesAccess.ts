/**
 * Notes Store admin authorization.
 *
 * Read and fulfilment are permission keys. Analytics, store settings, and
 * checkout-lead updates stay Super Admin only — holding store_manage_orders
 * does not grant them.
 */
import { hasPermission, isSuperAdmin, type PermissionSet } from "@/lib/permissions";

/** Orders list, order detail, and checkout-lead list. */
export function canReadNotesOrders(perms: PermissionSet | null | undefined): boolean {
  return hasPermission(perms, "store_view_orders") || hasPermission(perms, "store_manage_orders");
}

/** Existing Notes order operational mutations (status, pack, courier, shipment). */
export function canManageNotesOrders(perms: PermissionSet | null | undefined): boolean {
  return hasPermission(perms, "store_manage_orders");
}

export function canReadNotesLeads(perms: PermissionSet | null | undefined): boolean {
  return canReadNotesOrders(perms);
}

/** Sales status, notes, and recovery links. View access does not include this. */
export function canUpdateNotesLeads(perms: PermissionSet | null | undefined): boolean {
  return isSuperAdmin(perms);
}

/** `/admin/notes/analytics` and the analytics payload. Super Admin only. */
export function canReadNotesAnalytics(perms: PermissionSet | null | undefined): boolean {
  return isSuperAdmin(perms);
}

/** Store launch, fulfilment settings, and seller invoice settings. */
export function canManageNotesStoreSettings(perms: PermissionSet | null | undefined): boolean {
  return isSuperAdmin(perms);
}
