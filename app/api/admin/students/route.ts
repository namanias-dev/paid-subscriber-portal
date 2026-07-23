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
  getAllCourseEnrollments,
  getPayments,
  getAllWebinarRegistrations,
  getWebinars,
  getAllCourses,
  getLeads,
  isPaidStatus,
  logAccess,
} from "@/lib/dataProvider";
import { buildLeadAttrByPhone } from "@/lib/marketing/leadAttrByPhone";
import { getAdminSession } from "@/lib/session";
import { requirePermission } from "@/lib/adminGuard";
import { getPlan } from "@/lib/config";
import { buildWelcomeMessage, buildWhatsAppLink } from "@/lib/whatsapp";
import { sendAccessCodeEmail } from "@/lib/email";
import { formatDate, formatINR, istInputToISO } from "@/lib/dates";
import { deriveEnrollment, deriveCollections, isActiveEnrollment } from "@/lib/installments";
import type { PlanId, Payment, CourseEnrollment, WebinarRegistration } from "@/lib/types";

export interface StudentSummary {
  courseCount: number;
  webinarCount: number;
  /** Human labels for each enrollment, e.g. "Safalta Foundation (EMI 0/3)". */
  labels: string[];
  courseSlugs: string[];
  courseIds: string[];
  webinarIds: string[];
  totalPaid: number;
  totalDue: number;
  paymentStatus: "fully_paid" | "partial" | "outstanding" | "free";
  /** ISO of most recent payment/enrollment/registration (for "latest" sort). */
  lastActivity: string;
  /** True when the student has no LMS subscription (course/webinar customer). */
  isCustomer: boolean;
}

function groupByPhone<T extends { phone: string }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const p = (r.phone || "").trim();
    if (!p) continue;
    const arr = m.get(p);
    if (arr) arr.push(r);
    else m.set(p, [r]);
  }
  return m;
}

function ms(t: string | null | undefined): number {
  if (!t) return 0;
  const n = Date.parse(t);
  return Number.isNaN(n) ? 0 : n;
}

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
    const [students, stats, enrollments, payments, regs, webinars, courses, leads] = await Promise.all([
      getStudents(),
      getStats(),
      getAllCourseEnrollments(),
      getPayments(),
      getAllWebinarRegistrations(),
      getWebinars(),
      getAllCourses(),
      // `includeLegacy: true` so a student whose ONLY lead match is a legacy
      // row can still surface an honest SourcePill when the scalar `channel`
      // is set. Non-legacy leads still WIN when both exist (collision-lead
      // rule G2) — see the same preference-order comment in the payments
      // route. Aggregate people-area finance is not affected by legacy leads.
      getLeads({ includeLegacy: true }),
    ]);

    const paid = payments.filter((p) => isPaidStatus(p.status));
    // Only REAL enrollments count toward course counts / outstanding. PENDING ₹0
    // payment attempts (and cancelled duplicates) are excluded so a student who
    // merely tried to pay is not shown as enrolled with an inflated balance.
    const enrByPhone = groupByPhone(enrollments.filter(isActiveEnrollment));
    const paidByPhone = groupByPhone<Payment>(paid);
    const regsByPhone = groupByPhone<WebinarRegistration>(regs);
    const webinarById = new Map(webinars.map((w) => [w.id, w]));
    const webinarBySlug = new Map(webinars.map((w) => [w.slug, w]));

    const summaries: Record<string, StudentSummary> = {};
    for (const s of students) {
      const phone = (s.phone || "").trim();
      const enr: CourseEnrollment[] = enrByPhone.get(phone) ?? [];
      const phonePaid: Payment[] = paidByPhone.get(phone) ?? [];

      let totalDue = 0;
      const labels: string[] = [];
      const courseSlugs: string[] = [];
      const courseIds: string[] = [];
      for (const e of enr) {
        const d = deriveEnrollment(e);
        totalDue += d.remaining;
        courseIds.push(e.course_id);
        if (e.course_slug) courseSlugs.push(e.course_slug);
        const tag =
          e.status === "seat_booked"
            ? " (Seat booked)"
            : e.plan_type === "emi"
              ? ` (EMI ${d.paidCount}/${d.installmentTotal})`
              : d.isFullyPaid
                ? ""
                : " (Pay in full)";
        labels.push(`${e.course_title}${tag}`);
      }

      const webKeys = new Set<string>();
      const webinarIds: string[] = [];
      for (const p of phonePaid.filter((p) => p.item_type === "webinar")) {
        const w = (p.item_slug && webinarBySlug.get(p.item_slug)) || null;
        const key = w?.id || p.item_slug || p.item;
        if (webKeys.has(key)) continue;
        webKeys.add(key);
        if (w) webinarIds.push(w.id);
        labels.push(`${w?.title || p.item} (Webinar)`);
      }
      for (const r of regsByPhone.get(phone) ?? []) {
        if (webKeys.has(r.webinar_id)) continue;
        webKeys.add(r.webinar_id);
        webinarIds.push(r.webinar_id);
        labels.push(`${webinarById.get(r.webinar_id)?.title || "Webinar"} (Webinar)`);
      }

      const totalPaid = phonePaid.reduce((a, p) => a + (p.amount || 0), 0);
      const paymentStatus: StudentSummary["paymentStatus"] =
        totalDue > 0 ? (totalPaid > 0 ? "partial" : "outstanding") : totalPaid > 0 ? "fully_paid" : "free";

      let lastMs = ms(s.created_at);
      for (const p of phonePaid) lastMs = Math.max(lastMs, ms(p.transaction_date || p.created_at));
      for (const e of enr) lastMs = Math.max(lastMs, ms(e.updated_at || e.created_at));
      for (const r of regsByPhone.get(phone) ?? []) lastMs = Math.max(lastMs, ms(r.created_at));

      summaries[s.id] = {
        courseCount: enr.length,
        webinarCount: webKeys.size,
        labels,
        courseSlugs,
        courseIds,
        webinarIds,
        totalPaid,
        totalDue,
        paymentStatus,
        lastActivity: new Date(lastMs || Date.now()).toISOString(),
        isCustomer: !s.plan,
      };
    }

    const catalog = {
      courses: courses
        .map((c) => ({ slug: c.slug, title: c.title }))
        .sort((a, b) => a.title.localeCompare(b.title)),
      webinars: webinars
        .map((w) => ({ id: w.id, title: w.title }))
        .sort((a, b) => a.title.localeCompare(b.title)),
    };

    // ---- Canonical People-area finance (ONE source of truth) ----
    // "Collected" = COURSE FEES only, derived the SAME way as Course EMI & Seats
    // (deriveCollections over confirmed course enrollments), so the Students KPI
    // reconciles EXACTLY with the Fees & EMI screen. Webinar/other receipts are
    // reported SEPARATELY (never folded into "Collected") so the figure is
    // unambiguous. Same filter as Fees & EMI: paid & not cancelled.
    const confirmedEnrollments = enrollments.filter(
      (e) => e.amount_paid > 0 && e.status !== "cancelled",
    );
    let courseFeesCollected = 0;
    let courseFeesOutstanding = 0;
    for (const e of confirmedEnrollments) {
      const d = deriveCollections(e);
      courseFeesCollected += d.paid;
      courseFeesOutstanding += d.remaining;
    }
    const webinarReceipts = paid
      .filter((p) => p.item_type === "webinar")
      .reduce((a, p) => a + (p.amount || 0), 0);
    const finance = { courseFeesCollected, courseFeesOutstanding, webinarReceipts };

    // Read-only phone -> marketing attribution stamp — same builder as the
    // payments route so the two admin surfaces stay in lock-step. Non-legacy
    // lead wins on collision. See {@link buildLeadAttrByPhone}.
    const leadAttrByPhone = buildLeadAttrByPhone(leads);

    return NextResponse.json({ ok: true, students, stats, summaries, catalog, finance, leadAttrByPhone });
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
