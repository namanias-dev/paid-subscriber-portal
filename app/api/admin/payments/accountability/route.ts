import { NextResponse } from "next/server";
import { requireAdmin, requireSuperAdmin } from "@/lib/adminGuard";
import { getStaffAccountability } from "@/lib/paymentActions";

export const dynamic = "force-dynamic";

/**
 * Super-admin-only accountability report: per-staff counts of proof uploads,
 * approvals, reversals and rejections, plus recent activity for drill-down.
 * Staff must NOT see this aggregate view.
 */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!(await requireSuperAdmin())) {
    return NextResponse.json({ ok: false, error: "Forbidden — Super Admin only." }, { status: 403 });
  }
  try {
    const report = await getStaffAccountability();
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    console.error("[admin/payments/accountability] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
