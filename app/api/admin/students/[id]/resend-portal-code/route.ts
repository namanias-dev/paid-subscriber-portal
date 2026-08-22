import { NextResponse } from "next/server";
import { getStudentById, getBuyerByPhone, ensureBuyer, logAccess } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { requirePermission } from "@/lib/adminGuard";
import { portalLoginWhatsAppLink, renderPortalLoginCodeMessage } from "@/lib/portalLoginMessage";

export const dynamic = "force-dynamic";

/** Admin-only: return the 7-char portal code + WhatsApp link (login_code_resend body). Does not send SMS. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAdminSession();
    if (!session || !(await requirePermission("manage_students_leads"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const actor = (session as { username?: string }).username || "admin";
    const student = await getStudentById(params.id);
    if (!student) return NextResponse.json({ ok: false, error: "Student not found." }, { status: 404 });

    const buyer = (await getBuyerByPhone(student.phone)) || (await ensureBuyer(student.phone, student.name));
    if (!buyer?.login_code) {
      return NextResponse.json({ ok: false, error: "Could not issue a portal login code." }, { status: 500 });
    }
    const { text: message } = renderPortalLoginCodeMessage({ name: student.name, loginCode: buyer.login_code });
    const whatsappLink = portalLoginWhatsAppLink(student.phone, student.name, buyer.login_code);
    await logAccess(params.id, `admin:resend portal login code (by ${actor})`);
    return NextResponse.json({
      ok: true,
      portalLoginCode: buyer.login_code,
      message,
      whatsappLink,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to prepare portal code." }, { status: 500 });
  }
}
