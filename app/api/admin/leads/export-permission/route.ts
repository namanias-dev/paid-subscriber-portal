import { NextResponse } from "next/server";
import { requirePermission, requireSuperAdmin, getActionActor } from "@/lib/adminGuard";
import { getSiteSettings, updateSiteSettings } from "@/lib/dataProvider";
import { logAdminActivity } from "@/lib/adminActivity";
import { canExportLeadsCsv } from "@/lib/leadsExportPermission";

export const dynamic = "force-dynamic";

/** Who may export + current toggle state (for Leads UI). */
export async function GET() {
  if (!(await requirePermission("manage_students_leads"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const settings = await getSiteSettings();
  const canExport = await canExportLeadsCsv();
  const isSuper = await requireSuperAdmin();
  return NextResponse.json({
    ok: true,
    canExport,
    isSuperAdmin: isSuper,
    allowAdminCsvExport: !!settings.allow_admin_csv_export,
  });
}

/** Super-admin only: toggle allow_admin_csv_export. */
export async function PUT(req: Request) {
  if (!(await requireSuperAdmin())) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { allowAdminCsvExport?: boolean };
  const next = !!body.allowAdminCsvExport;
  await updateSiteSettings({ allow_admin_csv_export: next });
  const actor = await getActionActor();
  await logAdminActivity({
    actor,
    action: "export_permission_toggled",
    entityType: "settings",
    entityId: "allow_admin_csv_export",
    metadata: { new_state: next, target_role: "admin" },
  });
  return NextResponse.json({ ok: true, allowAdminCsvExport: next });
}

/** Log a successful CSV export (UI calls after download). Enforces permission. */
export async function POST(req: Request) {
  const allowed = await canExportLeadsCsv();
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { rowCount?: number; filters?: Record<string, unknown> };
  const actor = await getActionActor();
  await logAdminActivity({
    actor,
    action: "leads_csv_exported",
    entityType: "leads",
    entityId: null,
    metadata: {
      row_count: Number(body.rowCount) || 0,
      filters: body.filters || {},
    },
  });
  return NextResponse.json({ ok: true });
}
