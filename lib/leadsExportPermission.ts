import { getActionActor, requireSuperAdmin } from "./adminGuard";
import { getSiteSettings } from "./dataProvider";

/**
 * Super admin always. Admin role only when site_settings.allow_admin_csv_export.
 * Staff / other roles never.
 */
export async function canExportLeadsCsv(): Promise<boolean> {
  if (await requireSuperAdmin()) return true;
  const actor = await getActionActor();
  if (!actor) return false;
  const role = (actor.role || "").toLowerCase().replace(/\s+/g, "_");
  if (role !== "admin") return false;
  const settings = await getSiteSettings();
  return !!settings.allow_admin_csv_export;
}
