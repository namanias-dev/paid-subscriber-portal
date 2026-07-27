import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/adminGuard";
import { getAllCourseEnrollments } from "@/lib/dataProvider";
import { buildTracking, serialiseTracking } from "@/lib/sms/installmentTracking";

export const dynamic = "force-dynamic";

/**
 * Reminder → payment state for every enrollment, for the At-Risk Fees table.
 *
 * Read-only and PII-free: the response carries enrollment ids, installment
 * numbers, amounts and timestamps — no phone numbers, names or message bodies.
 *
 * Permission is deliberately broader than `send_sms`: a collections person who
 * may VIEW the worklist should see whether a student has been chased, even
 * without permission to send. It is still an authenticated admin check.
 */
export async function GET() {
  if (!(await requireAnyPermission(["send_sms", "manage_payments", "view_revenue"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const enrollments = await getAllCourseEnrollments();
  const tracking = await buildTracking(enrollments);
  return NextResponse.json({ ok: true, tracking: serialiseTracking(tracking) });
}
