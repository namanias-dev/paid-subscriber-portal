import { NextResponse } from "next/server";
import {
  updateStudent,
  deleteStudent,
  getStudentById,
  getCourseEnrollmentsByPhone,
  getEnrollments,
  getAllCourses,
  getBuyerPurchases,
  getPaymentsByPhone,
  getReceiptsByPhone,
  getAttemptsByUser,
  getAllQuizzes,
  getBuyerByPhone,
  getWebinarRegistrationIdsByPhone,
  getWebinars,
  getSiteSettings,
  getAccessLogs,
  logAccess,
} from "@/lib/dataProvider";
import { getAdminSession } from "@/lib/session";
import { requirePermission } from "@/lib/adminGuard";
import { computeExpiry, istInputToISO } from "@/lib/dates";
import { deriveEnrollment, isActiveEnrollment, isAttemptEnrollment } from "@/lib/installments";
import { getEnrollmentPlanChangeLogs, findActiveLeadByPhone } from "@/lib/dataProvider";
import type { Student, PlanId, InstallmentItem, PaymentPlan } from "@/lib/types";

const DAY = 86400000;
const PRESET_MONTHS: Record<string, number> = { "1m": 1, "3m": 3, "6m": 6, "12m": 12 };

function humanizeCourseStatus(s: string): string {
  return (
    {
      pending: "Pending",
      seat_booked: "Seat booked",
      partially_paid: "Partially paid",
      fully_paid: "Fully paid",
      cancelled: "Cancelled",
      active: "Active",
      completed: "Completed",
    }[s] || s
  );
}

// ============================ GET — 360° profile bundle ============================
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_students_leads"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const student = await getStudentById(params.id);
    if (!student) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const phone = student.phone;
    const [
      courseEnrollmentsAll,
      legacyEnrollments,
      allCourses,
      paidPayments,
      allPhonePayments,
      receipts,
      attempts,
      quizzes,
      buyer,
      webinarRegIds,
      webinars,
      settings,
      accessLogs,
    ] = await Promise.all([
      getCourseEnrollmentsByPhone(phone),
      getEnrollments(student.id),
      getAllCourses(),
      getBuyerPurchases(phone),
      getPaymentsByPhone(phone),
      getReceiptsByPhone(phone),
      getAttemptsByUser(student.id),
      getAllQuizzes(),
      getBuyerByPhone(phone),
      getWebinarRegistrationIdsByPhone(phone),
      getWebinars(),
      getSiteSettings(),
      getAccessLogs(params.id),
    ]);

    const courseTitleById = new Map(allCourses.map((c) => [c.id, c]));

    // CORE FIX: a payment ATTEMPT is not an enrollment. Only confirmed/approved
    // (amount_paid > 0) or admin-granted (₹0 "fully_paid") enrollments are real;
    // PENDING/abandoned ₹0 attempts and cancelled/superseded duplicates are split
    // out so they never inflate the enrolled-courses count or outstanding balance.
    const courseEnrollments = courseEnrollmentsAll.filter(isActiveEnrollment);
    const attemptEnrollments = courseEnrollmentsAll.filter(isAttemptEnrollment);

    // ---- Unified course cards (phone-keyed CourseEnrollment + legacy student-keyed Enrollment) ----
    type CourseCard = {
      id: string;
      title: string;
      slug: string | null;
      batch: string | null;
      plan: string;
      status: string;
      total: number;
      paid: number;
      remaining: number;
      progressPct: number;
      hasOverdue: boolean;
      nextDue: { label: string; amount: number; due: string | null } | null;
      createdAt: string;
      source: "course" | "legacy";
      /** Unpaid schedule lines an admin can settle with a cash/offline payment. */
      unpaid: { kind: "seat" | "installment" | "full"; no: number; label: string; amount: number; due: string | null }[];
      /** Precise payment plan (FULL/EMI/CUSTOM_INSTALLMENTS) for admin actions. */
      paymentPlan?: PaymentPlan;
      installmentCount?: number;
      /** Full schedule (incl. paid/cancelled/waived lines) for the manage-plan view. */
      schedule?: InstallmentItem[];
      previousPlan?: PaymentPlan | null;
      planChangedAt?: string | null;
      planChangedReason?: string | null;
      /** Total-fee discount (cumulative rupees) + the pre-discount total, when applied. */
      discount?: number;
      originalTotal?: number | null;
      /** Plan-change audit history for this enrollment. */
      planHistory?: { id: string; oldPlan: string | null; newPlan: string | null; oldOutstanding: number; newOutstanding: number; reason: string | null; changedBy: string | null; createdAt: string }[];
    };

    const planLogsLists = await Promise.all(courseEnrollments.map((e) => getEnrollmentPlanChangeLogs(e.id).catch(() => [])));

    const courses: CourseCard[] = courseEnrollments.map((e, i) => {
      const d = deriveEnrollment(e);
      const paymentPlan: PaymentPlan = e.payment_plan || (e.plan_type === "emi" ? "EMI" : "FULL");
      const planLabel =
        e.status === "seat_booked" && paymentPlan !== "CUSTOM_INSTALLMENTS"
          ? "Seat booked"
          : paymentPlan === "CUSTOM_INSTALLMENTS"
            ? `Custom · ${e.installment_count || d.installmentTotal} parts`
            : paymentPlan === "EMI"
              ? `EMI · ${e.installment_count || d.installmentTotal} parts`
              : "Pay in full";
      return {
        id: e.id,
        title: e.course_title,
        slug: e.course_slug,
        batch: e.batch_label,
        plan: planLabel,
        status: humanizeCourseStatus(e.status),
        total: e.total_fee,
        paid: d.paid,
        remaining: d.remaining,
        progressPct: d.progressPct,
        hasOverdue: d.hasOverdue,
        nextDue: d.nextPayable
          ? { label: d.nextPayable.label, amount: d.nextPayable.amount, due: d.nextPayable.due }
          : null,
        createdAt: e.created_at,
        source: "course",
        unpaid: (e.schedule || [])
          .filter((s) => !s.paid && s.status !== "cancelled" && s.status !== "waived")
          .map((s) => ({ kind: s.kind, no: s.no, label: s.label, amount: s.amount, due: s.due })),
        paymentPlan,
        installmentCount: e.installment_count,
        schedule: e.schedule || [],
        previousPlan: e.previous_payment_plan ?? null,
        planChangedAt: e.payment_plan_changed_at ?? null,
        planChangedReason: e.payment_plan_change_reason ?? null,
        discount: e.discount_amount || 0,
        originalTotal: e.original_total_fee ?? null,
        planHistory: (planLogsLists[i] || []).map((l) => ({
          id: l.id,
          oldPlan: l.old_plan,
          newPlan: l.new_plan,
          oldOutstanding: l.old_outstanding,
          newOutstanding: l.new_outstanding,
          reason: l.reason,
          changedBy: l.changed_by,
          createdAt: l.created_at,
        })),
      };
    });

    for (const e of legacyEnrollments) {
      const nextUnpaid = (e.installments || []).find((i) => !i.paid) || null;
      courses.push({
        id: e.id,
        title: courseTitleById.get(e.course_id)?.title || "Course",
        slug: courseTitleById.get(e.course_id)?.slug || null,
        batch: null,
        plan: "Enrollment",
        status: humanizeCourseStatus(e.status),
        total: e.fee_total,
        paid: e.fee_collected,
        remaining: e.pending,
        progressPct: e.fee_total > 0 ? Math.round((e.fee_collected / e.fee_total) * 100) : 0,
        hasOverdue: false,
        nextDue: nextUnpaid ? { label: nextUnpaid.label, amount: nextUnpaid.amount, due: nextUnpaid.due } : null,
        createdAt: e.enrolled_at,
        source: "legacy",
        unpaid: [],
      });
    }

    // ---- Pending / Attempted course registrations (grouped per course+batch) ----
    // One card per course+batch that has NO active enrollment. Attempt count comes
    // from the real payment attempts (course payments), so multiple tries collapse
    // into a single intent. Once a payment is approved, the course leaves this list
    // and appears under Active Enrolled Courses (attempts become history only).
    const activeCourseKeys = new Set(courseEnrollments.map((e) => `${e.course_id}|${e.batch_label || ""}`));
    type AttemptCard = {
      key: string;
      courseId: string;
      title: string;
      slug: string | null;
      batch: string | null;
      attemptCount: number;
      latestStatus: string;
      latestAt: string;
      enrollmentIds: string[];
      attempts: { id: string; date: string; amount: number; status: string; reference: string | null }[];
    };
    const attemptMap = new Map<string, AttemptCard>();
    for (const e of attemptEnrollments) {
      const key = `${e.course_id}|${e.batch_label || ""}`;
      if (activeCourseKeys.has(key)) continue; // a real enrollment already exists — fold as history
      const card = attemptMap.get(key) || {
        key,
        courseId: e.course_id,
        title: e.course_title,
        slug: e.course_slug,
        batch: e.batch_label,
        attemptCount: 0,
        latestStatus: humanizeCourseStatus(e.status),
        latestAt: e.created_at,
        enrollmentIds: [],
        attempts: [],
      };
      card.enrollmentIds.push(e.id);
      if ((e.updated_at || e.created_at) > card.latestAt) {
        card.latestAt = e.updated_at || e.created_at;
        card.latestStatus = humanizeCourseStatus(e.status);
      }
      attemptMap.set(key, card);
    }
    // Attach the individual payment attempts (all statuses) per course and use their
    // count as the authoritative "attempts" number.
    for (const card of attemptMap.values()) {
      const enrIds = new Set(card.enrollmentIds);
      const pays = allPhonePayments.filter(
        (p) => p.item_type === "course" && ((p.enrollment_id && enrIds.has(p.enrollment_id)) || p.item_slug === card.slug),
      );
      card.attempts = pays
        .sort((a, b) => (b.transaction_date || b.created_at || "").localeCompare(a.transaction_date || a.created_at || ""))
        .map((p) => ({
          id: p.id,
          date: p.transaction_date || p.created_at,
          amount: p.amount,
          status: p.status,
          reference: p.reference_no || p.razorpay_payment_id || null,
        }));
      card.attemptCount = Math.max(card.attempts.length, card.enrollmentIds.length);
      const latestPay = card.attempts[0];
      if (latestPay && latestPay.date > card.latestAt) {
        card.latestAt = latestPay.date;
        card.latestStatus = latestPay.status;
      }
    }
    const attemptCards = [...attemptMap.values()].sort((a, b) => b.latestAt.localeCompare(a.latestAt));

    // ---- Webinars (paid payments + free registrations, deduped by webinar) ----
    const webinarById = new Map(webinars.map((w) => [w.id, w]));
    const webinarBySlug = new Map(webinars.map((w) => [w.slug, w]));
    type WebinarRow = { id: string; title: string; datetime: string | null; paid: boolean; amount: number | null; status: string };
    const webinarRows: WebinarRow[] = [];
    const seenWebinars = new Set<string>();

    for (const p of paidPayments.filter((p) => p.item_type === "webinar")) {
      const w = (p.item_slug && webinarBySlug.get(p.item_slug)) || null;
      const key = w?.id || p.item_slug || p.item;
      if (seenWebinars.has(key)) continue;
      seenWebinars.add(key);
      webinarRows.push({
        id: key,
        title: w?.title || p.item,
        datetime: w?.datetime || p.created_at,
        paid: true,
        amount: p.amount,
        status: "Registered (Paid)",
      });
    }
    for (const wid of webinarRegIds) {
      if (seenWebinars.has(wid)) continue;
      seenWebinars.add(wid);
      const w = webinarById.get(wid);
      webinarRows.push({
        id: wid,
        title: w?.title || "Webinar",
        datetime: w?.datetime || null,
        paid: false,
        amount: null,
        status: "Registered (Free)",
      });
    }

    // ---- Unified payments ledger (paid records) ----
    const receiptByRef = new Map<string, string>();
    for (const r of receipts) if (r.reference_no) receiptByRef.set(r.reference_no, r.receipt_no);
    const ledger = paidPayments.map((p) => ({
      id: p.id,
      date: p.transaction_date || p.created_at,
      amount: p.amount,
      type:
        p.payment_kind && p.payment_kind !== "one_time"
          ? p.payment_kind
          : p.item_type,
      label: p.item,
      method: p.payment_mode || p.gateway || p.mode || "Online",
      reference: p.reference_no || p.razorpay_payment_id || null,
      receiptNo: (p.receipt_no || (p.reference_no ? receiptByRef.get(p.reference_no) : null)) ?? null,
    }));

    const totalPaid = ledger.reduce((a, p) => a + p.amount, 0);
    const outstanding = courses.reduce((a, c) => a + c.remaining, 0);
    const nextDueCandidates = courses
      .map((c) => (c.nextDue ? { ...c.nextDue, course: c.title } : null))
      .filter((x): x is { label: string; amount: number; due: string | null; course: string } => !!x)
      .filter((x) => x.due != null)
      .sort((a, b) => new Date(a.due!).getTime() - new Date(b.due!).getTime());
    const nextDue = nextDueCandidates[0] || null;

    // ---- Performance / activity (quiz attempts) ----
    const quizById = new Map(quizzes.map((q) => [q.id, q]));
    const finalized = attempts.filter((a) => a.status !== "IN_PROGRESS");
    const totalAttempts = finalized.length;
    const avgAccuracy = totalAttempts ? Math.round(finalized.reduce((s, a) => s + a.accuracy, 0) / totalAttempts) : 0;
    const avgScorePct = totalAttempts
      ? Math.round(
          (finalized.reduce((s, a) => s + (a.max_score > 0 ? a.score / a.max_score : 0), 0) / totalAttempts) * 100
        )
      : 0;
    const bestPct = finalized.reduce((m, a) => Math.max(m, a.max_score > 0 ? Math.round((a.score / a.max_score) * 100) : 0), 0);
    const recentSorted = [...finalized].sort(
      (a, b) => new Date(b.submitted_at || b.created_at).getTime() - new Date(a.submitted_at || a.created_at).getTime()
    );
    const recent = recentSorted.slice(0, 8).map((a) => ({
      attemptId: a.id,
      slug: quizById.get(a.quiz_id)?.slug || "",
      title: quizById.get(a.quiz_id)?.title || "Quiz",
      score: a.score,
      max_score: a.max_score,
      accuracy: a.accuracy,
      submitted_at: a.submitted_at,
    }));
    // Oldest → newest accuracy trend for a sparkline.
    const trend = [...finalized]
      .sort((a, b) => new Date(a.submitted_at || a.created_at).getTime() - new Date(b.submitted_at || b.created_at).getTime())
      .map((a) => a.accuracy);

    // Read-only marketing attribution for the profile header pill. Pulled from
    // the existing lead record via findActiveLeadByPhone (idempotent, honours
    // the fold-by-phone contract). Never rewritten, never touches student /
    // enrolment / payment data. Renders NOTHING when no lead attribution matches.
    const attributionLead = await findActiveLeadByPhone(phone).catch(() => null);
    const leadAttribution = attributionLead
      ? {
          channel: attributionLead.channel ?? null,
          utm_campaign: attributionLead.utm_campaign ?? null,
          utm_source: attributionLead.utm_source ?? null,
        }
      : null;

    const { brand, logo_url, logo_alt } = settings;
    const contact = {
      name: brand.name || "Naman Sharma IAS Academy",
      address: brand.address || "",
      phone: brand.support_phone || "",
      email: brand.support_email || "",
      whatsapp: brand.whatsapp || brand.support_phone || "",
      logoUrl: logo_url || null,
      logoAlt: logo_alt || brand.name || "Naman Sharma IAS Academy",
    };

    return NextResponse.json({
      ok: true,
      profile: {
        student,
        buyerCode: buyer?.login_code || null,
        leadAttribution,
        courses,
        attempts: attemptCards,
        webinars: webinarRows,
        ledger,
        receipts,
        contact,
        totals: { totalPaid, outstanding, nextDue },
        performance: {
          totalAttempts,
          avgAccuracy,
          avgScorePct,
          bestPct,
          lastActive: student.last_active_date,
          streak: student.streak_count,
          recent,
          trend,
        },
        accessLogs,
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load student profile." }, { status: 500 });
  }
}

// ============================ PATCH — access control + edits ============================
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getAdminSession();
    if (!session || !(await requirePermission("manage_students_leads"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const actor = (session as { username?: string }).username || "admin";
    const body = await req.json().catch(() => ({}));
    const patch: Partial<Student> = {};
    let logLine: string | null = null;

    const current = await getStudentById(params.id);
    if (!current) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    if (body.action === "extend") {
      const days = Number(body.days) || 30;
      const base =
        current.expiry_date && new Date(current.expiry_date).getTime() > Date.now()
          ? new Date(current.expiry_date).getTime()
          : Date.now();
      patch.expiry_date = new Date(base + days * DAY).toISOString();
      patch.is_active = true;
      logLine = `extend +${days}d`;
    } else if (body.action === "revoke") {
      patch.is_active = false;
      logLine = "revoke access";
    } else if (body.action === "restore") {
      patch.is_active = true;
      // Optionally set a fresh valid-till on restore.
      if (body.valid_till) patch.expiry_date = istInputToISO(`${body.valid_till}T23:59`);
      logLine = body.valid_till ? `restore (valid till ${body.valid_till})` : "restore access";
    } else if (body.action === "set_validity") {
      const preset = String(body.preset || "");
      if (preset === "lifetime") {
        patch.plan = "lifetime";
        patch.months = null;
        patch.expiry_date = null;
      } else if (PRESET_MONTHS[preset] != null) {
        const months = PRESET_MONTHS[preset];
        const start = current.start_date || new Date().toISOString();
        patch.plan = preset as PlanId;
        patch.months = months;
        patch.expiry_date = computeExpiry(start, months);
      } else if (preset === "custom" && body.valid_till) {
        patch.expiry_date = istInputToISO(`${body.valid_till}T23:59`);
      } else {
        return NextResponse.json({ ok: false, error: "Invalid validity preset." }, { status: 400 });
      }
      patch.is_active = true;
      logLine = `set validity → ${preset === "custom" ? body.valid_till : preset}`;
    } else {
      // generic edit (kept for backward compatibility)
      if (body.name != null) patch.name = String(body.name);
      if (body.email != null) patch.email = body.email ? String(body.email) : null;
      if (body.phone != null) patch.phone = String(body.phone);
      if (body.target_year != null) patch.target_year = body.target_year ? Number(body.target_year) : null;
      if (body.optional_subject != null)
        patch.optional_subject = body.optional_subject ? String(body.optional_subject) : null;
      if (body.notes != null) patch.notes = body.notes ? String(body.notes) : null;
      if (body.amount_paid != null) patch.amount_paid = Number(body.amount_paid);
      if (body.is_active != null) patch.is_active = Boolean(body.is_active);
      if (body.start_date != null) patch.start_date = new Date(body.start_date).toISOString();
      if (body.months != null || body.start_date != null) {
        const months = body.months != null ? Number(body.months) : current.months ?? null;
        const start = patch.start_date || current.start_date || new Date().toISOString();
        patch.months = months;
        patch.expiry_date = computeExpiry(start, months);
      }
      logLine = "edit profile";
    }

    const updated = await updateStudent(params.id, patch);
    if (!updated) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    if (logLine) await logAccess(params.id, `admin:${logLine} (by ${actor})`);

    return NextResponse.json({ ok: true, student: updated });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to update student." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await requirePermission("manage_students_leads"))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    const ok = await deleteStudent(params.id);
    if (!ok) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to delete student." }, { status: 500 });
  }
}
