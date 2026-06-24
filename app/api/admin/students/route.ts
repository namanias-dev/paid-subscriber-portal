import { NextResponse } from "next/server";
import {
  getStudents,
  addStudent,
  getStats,
  updateStudent,
  enrollStudentInCourse,
  recordOfflineCoursePayment,
  recordOfflineWebinarPayment,
  getCourseEnrollmentsByPhone,
  logAccess,
} from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { requirePermission } from "@/lib/adminGuard";
import { getPlan } from "@/lib/config";
import { buildWelcomeMessage, buildWhatsAppLink } from "@/lib/whatsapp";
import { sendAccessCodeEmail } from "@/lib/email";
import { formatDate, formatINR, istInputToISO } from "@/lib/dates";
import type { PlanId } from "@/lib/types";

interface CourseSelection {
  courseSlug: string;
  plan: "full" | "emi" | "complimentary";
  bookSeat?: boolean;
  seatAmount?: number | null;
  installmentCount?: number | null;
}

export async function GET() {
  try {
    if (!(await requirePermission("manage_students_leads"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const [students, stats] = await Promise.all([getStudents(), getStats()]);
    return NextResponse.json({ ok: true, students, stats });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load students." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getAdminSession();
    if (!session || !(await requirePermission("manage_students_leads"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const actor = (session as { username?: string }).username || "admin";
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    const planId = String(body.plan || "") as PlanId;

    if (!name || !/^\d{10}$/.test(phone)) {
      return NextResponse.json({ ok: false, error: "Valid name and 10-digit mobile required." }, { status: 400 });
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
        body.amount_paid != null && body.amount_paid !== "" ? Number(body.amount_paid) : plan.price,
      start_date: body.start_date ? new Date(body.start_date).toISOString() : undefined,
      target_year: body.target_year ? Number(body.target_year) : null,
      optional_subject: body.optional_subject ? String(body.optional_subject).trim() : null,
      notes: body.notes ? String(body.notes).trim() : null,
    });

    // Custom "valid till" overrides the plan-derived expiry (Part A access control).
    if (body.valid_till) {
      const updated = await updateStudent(student.id, { expiry_date: istInputToISO(`${body.valid_till}T23:59`) });
      if (updated) student.expiry_date = updated.expiry_date;
    }

    await logAccess(student.id, `admin:create student (by ${actor})`);

    // ---- Enroll into courses (same model as online) ----
    const warnings: string[] = [];
    const courses: CourseSelection[] = Array.isArray(body.courses) ? body.courses : [];
    for (const c of courses) {
      const res = await enrollStudentInCourse({
        phone,
        name,
        email: body.email ? String(body.email).trim() : null,
        courseSlug: c.courseSlug,
        plan: c.plan,
        bookSeat: !!c.bookSeat,
        seatAmount: c.seatAmount ?? null,
        installmentCount: c.installmentCount ?? null,
      });
      if (!res.ok) warnings.push(`${c.courseSlug}: ${res.error}`);
    }

    // ---- Register for webinars ----
    const webinars: string[] = Array.isArray(body.webinars) ? body.webinars : [];
    for (const wid of webinars) {
      const res = await recordOfflineWebinarPayment({ webinarId: wid, name, phone, email: body.email || null, amount: 0, method: "Free" });
      if (!res.ok) warnings.push(`webinar ${wid}: ${res.error}`);
    }

    // ---- Optional initial cash/offline payment against one enrollment ----
    const ip = body.initialPayment as
      | { courseSlug: string; kind: "seat" | "installment" | "full"; installmentNo?: number; method: string; dateISO?: string; note?: string }
      | undefined;
    let receiptNo: string | null = null;
    if (ip && ip.courseSlug && ip.method) {
      const enr = (await getCourseEnrollmentsByPhone(phone)).find((e) => e.course_slug === ip.courseSlug && e.status !== "cancelled");
      if (enr) {
        const res = await recordOfflineCoursePayment({
          enrollmentId: enr.id,
          kind: ip.kind,
          installmentNo: ip.installmentNo ?? null,
          method: ip.method,
          dateISO: ip.dateISO ? istInputToISO(`${ip.dateISO}T12:00`) : undefined,
          note: ip.note || null,
        });
        if (res.ok) {
          receiptNo = res.receipt.receipt_no;
          await logAccess(student.id, `admin:cash ${formatINR(res.receipt.amount)} ${ip.method} · ${enr.course_title} (by ${actor})`);
        } else warnings.push(`payment: ${res.error}`);
      }
    }

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

    return NextResponse.json({ ok: true, student, whatsappLink, message, emailSent, receiptNo, warnings });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to add student." }, { status: 500 });
  }
}
