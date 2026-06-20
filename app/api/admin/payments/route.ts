import { NextResponse } from "next/server";
import { getPayments, getEnrollments } from "@/lib/dataProvider";
import { requireAdmin } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const [payments, enrollments] = await Promise.all([getPayments(), getEnrollments()]);
    return NextResponse.json({ ok: true, payments, enrollments });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load payments." }, { status: 500 });
  }
}
