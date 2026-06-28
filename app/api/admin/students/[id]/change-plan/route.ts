import { NextResponse } from "next/server";
import { getStudentById, changeEnrollmentPaymentPlan, logAccess } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { requirePermission } from "@/lib/adminGuard";
import type { PaymentPlan } from "@/lib/types";
import type { CustomLineInput } from "@/lib/paymentPlanChange";

const PLANS: PaymentPlan[] = ["FULL", "EMI", "CUSTOM_INSTALLMENTS"];

/** Admin: convert an existing enrollment between FULL / EMI / CUSTOM_INSTALLMENTS. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAdminSession();
    if (!session || !(await requirePermission("manage_students_leads"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const actor = (session as { username?: string }).username || "admin";
    const student = await getStudentById(params.id);
    if (!student) return NextResponse.json({ ok: false, error: "Student not found." }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const plan = String(body.plan || "") as PaymentPlan;
    if (!PLANS.includes(plan)) return NextResponse.json({ ok: false, error: "Invalid payment plan." }, { status: 400 });

    const lines: CustomLineInput[] | undefined = Array.isArray(body.lines)
      ? body.lines.map((l: Record<string, unknown>) => ({
          title: String(l.title || ""),
          amount: Number(l.amount) || 0,
          due: l.due ? String(l.due) : null,
          grace: l.grace ? String(l.grace) : null,
          notes: l.notes ? String(l.notes) : null,
          status: (l.status as CustomLineInput["status"]) || "pending",
        }))
      : undefined;

    const res = await changeEnrollmentPaymentPlan({
      enrollmentId: String(body.enrollmentId || ""),
      target: { plan, count: body.count != null ? Number(body.count) : null, lines },
      reason: body.reason ? String(body.reason) : null,
      changedBy: actor,
      confirmBackdated: !!body.confirmBackdated,
      confirmDifference: !!body.confirmDifference,
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });

    await logAccess(params.id, `admin:plan change → ${plan} (by ${actor})${res.warnings.length ? ` · ${res.warnings.join("; ")}` : ""}`);
    return NextResponse.json({ ok: true, enrollment: res.enrollment, warnings: res.warnings });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to change the payment plan." }, { status: 500 });
  }
}
