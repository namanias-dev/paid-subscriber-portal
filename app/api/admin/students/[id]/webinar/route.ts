import { NextResponse } from "next/server";
import { getStudentById, recordOfflineWebinarPayment, logAccess } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { requirePermission } from "@/lib/adminGuard";
import { istInputToISO } from "@/lib/dates";

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
    const res = await recordOfflineWebinarPayment({
      webinarId: String(body.webinarId || ""),
      name: student.name,
      phone: student.phone,
      email: student.email,
      amount: body.amount != null ? Number(body.amount) : 0,
      method: body.amount && Number(body.amount) > 0 ? String(body.method || "Cash") : "Free",
      dateISO: body.dateISO ? istInputToISO(`${body.dateISO}T12:00`) : undefined,
      note: body.note || null,
    });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });

    await logAccess(params.id, `admin:register webinar (by ${actor})`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to register webinar." }, { status: 500 });
  }
}
