import { NextResponse } from "next/server";
import { getStudents, addStudent, getStats } from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { getPlan } from "@/lib/config";
import { buildWelcomeMessage, buildWhatsAppLink } from "@/lib/whatsapp";
import { sendAccessCodeEmail } from "@/lib/email";
import { formatDate } from "@/lib/dates";
import type { PlanId } from "@/lib/types";

async function requireAdmin() {
  const session = await getAdminSession();
  return !!session;
}

export async function GET() {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const [students, stats] = await Promise.all([getStudents(), getStats()]);
    return NextResponse.json({ ok: true, students, stats });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to load students." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    const planId = String(body.plan || "") as PlanId;

    if (!name || !/^\d{10}$/.test(phone)) {
      return NextResponse.json(
        { ok: false, error: "Valid name and 10-digit mobile required." },
        { status: 400 }
      );
    }
    const plan = getPlan(planId);
    if (!plan) {
      return NextResponse.json({ ok: false, error: "Invalid plan." }, { status: 400 });
    }

    const student = await addStudent({
      name,
      phone,
      email: body.email ? String(body.email).trim() : null,
      plan: planId,
      months: plan.months,
      amount_paid:
        body.amount_paid != null && body.amount_paid !== ""
          ? Number(body.amount_paid)
          : plan.price,
      start_date: body.start_date ? new Date(body.start_date).toISOString() : undefined,
      target_year: body.target_year ? Number(body.target_year) : null,
      optional_subject: body.optional_subject ? String(body.optional_subject).trim() : null,
    });

    const message = buildWelcomeMessage({
      name: student.name,
      code: student.access_code,
      phone: student.phone,
      planName: plan.name,
      expiry: student.expiry_date,
    });
    const whatsappLink = buildWhatsAppLink(student.phone, message);

    let emailSent = false;
    if (student.email) {
      const r = await sendAccessCodeEmail({
        to: student.email,
        name: student.name,
        code: student.access_code,
        planName: plan.name,
        expiry: formatDate(student.expiry_date),
      });
      emailSent = r.sent;
    }

    return NextResponse.json({ ok: true, student, whatsappLink, message, emailSent });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "Failed to add student." },
      { status: 500 }
    );
  }
}
