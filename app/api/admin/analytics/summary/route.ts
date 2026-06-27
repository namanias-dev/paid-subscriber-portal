import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getDashboardSummary } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    if (!(await requirePermission("view_revenue"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL(req.url);
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || 30));
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
    const summary = await getDashboardSummary({
      from: url.searchParams.get("from") || from.toISOString(),
      to: url.searchParams.get("to") || to.toISOString(),
      source: url.searchParams.get("source"),
      campaign: url.searchParams.get("campaign"),
    });
    return NextResponse.json({ ok: true, summary });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load analytics." }, { status: 500 });
  }
}
