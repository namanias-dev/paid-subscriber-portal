import { NextResponse } from "next/server";
import { getStudentById, updateInstallmentLine, logAccess } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { requirePermission } from "@/lib/adminGuard";
import { istInputToISO } from "@/lib/dates";

type Action = "edit_due" | "waive" | "cancel";
const ACTIONS: Action[] = ["edit_due", "waive", "cancel"];

/** Admin: edit due date / waive / cancel a single unpaid installment line. */
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
    const action = String(body.action || "") as Action;
    if (!ACTIONS.includes(action)) return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });

    const res = await updateInstallmentLine({
      enrollmentId: String(body.enrollmentId || ""),
      no: Number(body.no),
      action,
      due: body.due ? istInputToISO(`${String(body.due).slice(0, 10)}T12:00`) : null,
      grace: body.grace ? istInputToISO(`${String(body.grace).slice(0, 10)}T12:00`) : null,
      reason: body.reason ? String(body.reason) : null,
      changedBy: actor,
      confirmBackdated: !!body.confirmBackdated,
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });

    await logAccess(params.id, `admin:installment ${action} #${body.no} (by ${actor})`);
    return NextResponse.json({ ok: true, enrollment: res.enrollment });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to update the installment." }, { status: 500 });
  }
}
