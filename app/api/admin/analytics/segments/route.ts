import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getSegment, type SegmentKey } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

const VALID: SegmentKey[] = ["paid_not_logged_in", "payment_pending_or_abandoned", "clicked_pay_not_paid", "paid_not_clicked_zoom"];

export async function GET(req: Request) {
  try {
    if (!(await requirePermission("view_revenue"))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const key = new URL(req.url).searchParams.get("key") as SegmentKey;
    if (!VALID.includes(key)) return NextResponse.json({ ok: false, error: "Invalid segment." }, { status: 400 });
    const rows = await getSegment(key);
    return NextResponse.json({ ok: true, key, rows, count: rows.length });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load segment." }, { status: 500 });
  }
}
