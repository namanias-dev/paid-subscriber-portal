import { NextResponse } from "next/server";
import { getReferrals, updateReferral } from "@/lib/dataProvider";
import { requirePermission } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requirePermission("manage_students_leads"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const referrals = await getReferrals();
    return NextResponse.json({ ok: true, referrals });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load referrals." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    if (!(await requirePermission("manage_students_leads"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const referral = await updateReferral(String(body.id), body.patch || {});
    return NextResponse.json({ ok: true, referral });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to update." }, { status: 500 });
  }
}
