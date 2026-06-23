import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/dataProvider";
import { requireAdmin, requireAnyPermission } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const data = await getDashboard();
    // Hide financial figures from accounts without revenue access (server-side, not just UI).
    const canRevenue = await requireAnyPermission(["view_revenue", "view_analytics_revenue", "manage_payments"]);
    if (!canRevenue) {
      return NextResponse.json({
        ok: true,
        data: { ...data, revenueMonth: null, revenueTotal: null, pendingCollections: null, revenueByCourse: [] },
        revenueHidden: true,
      });
    }
    return NextResponse.json({ ok: true, data });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load dashboard." }, { status: 500 });
  }
}
