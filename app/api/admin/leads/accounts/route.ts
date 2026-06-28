import { NextResponse } from "next/server";
import { getLeadBuyers } from "@/lib/dataProvider";
import { requirePermission } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

/**
 * Admin visibility for non-paying LEAD accounts (buyers.is_lead). These are quiz /
 * marketing leads with a portal login code — zero entitlements, never counted in
 * seats or finance. Read-only listing for count + outreach.
 */
export async function GET() {
  try {
    if (!(await requirePermission("manage_students_leads"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const leads = await getLeadBuyers();
    return NextResponse.json({
      ok: true,
      count: leads.length,
      leads: leads.map((b) => ({ id: b.id, name: b.name, phone: b.phone, login_code: b.login_code, created_at: b.created_at })),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load lead accounts." }, { status: 500 });
  }
}
