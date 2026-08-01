import { NextResponse } from "next/server";
import { getStudentById, recordOfflineCoursePayment, logAccess } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { requirePermission } from "@/lib/adminGuard";
import { formatINR, istInputToISO } from "@/lib/dates";

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
    const res = await recordOfflineCoursePayment({
      enrollmentId: String(body.enrollmentId || ""),
      kind: body.kind,
      installmentNo: body.installmentNo != null ? Number(body.installmentNo) : null,
      method: String(body.method || "Cash"),
      dateISO: body.dateISO ? istInputToISO(`${body.dateISO}T12:00`) : undefined,
      note: body.note || null,
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });

    await logAccess(
      params.id,
      `admin:cash ${formatINR(res.receipt.amount)} ${res.receipt.method || "Cash"} · ${res.receipt.payment_label} (by ${actor})`
    );
    void import("@/lib/adminActivity").then(async ({ logAdminActivity }) => {
      const { getActionActor } = await import("@/lib/adminGuard");
      const actionActor = await getActionActor();
      const isInstallment = body.kind === "installment";
      await logAdminActivity({
        actor: actionActor,
        action: isInstallment ? "installment_recorded_manually" : "payment_recorded_manually",
        entityType: "enrollment",
        entityId: String(body.enrollmentId || ""),
        metadata: {
          student_name: student.name,
          phone: student.phone,
          amount: res.receipt.amount,
          payment_type: body.kind,
          course: res.receipt.course_title ?? res.enrollment.course_title ?? null,
          installment_number: isInstallment ? (body.installmentNo ?? null) : null,
          due_date: isInstallment
            ? (res.enrollment.schedule || []).find((s) => s.kind === "installment" && s.no === Number(body.installmentNo))?.due ?? null
            : null,
        },
      });
    }).catch(() => null);
    return NextResponse.json({ ok: true, receiptNo: res.receipt.receipt_no, enrollment: res.enrollment });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to record payment." }, { status: 500 });
  }
}
