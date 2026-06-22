import { NextResponse } from "next/server";
import { getPayments, getEnrollments, getBuyers } from "@/lib/dataProvider";
import { requireAdmin } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const [payments, enrollments, buyers] = await Promise.all([getPayments(), getEnrollments(), getBuyers()]);
    // phone -> login code, so support can resolve "forgot code" escalations.
    const buyerCodes: Record<string, string> = {};
    for (const b of buyers) buyerCodes[b.phone] = b.login_code;
    return NextResponse.json({ ok: true, payments, enrollments, buyerCodes });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load payments." }, { status: 500 });
  }
}
