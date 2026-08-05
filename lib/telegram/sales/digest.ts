/**
 * Sales digest — 10:00 / 15:00 / 20:00 IST. No aggregate revenue figures.
 */
import {
  getAllAccessOverrides,
  getAllCourseEnrollments,
  getAllCourses,
  getPayments,
  getWebinars,
} from "../../dataProvider";
import { isPaidStatus } from "../../paymentsAgg";
import { deriveEnrollment, isActiveEnrollment, isLineOutstanding } from "../../installments";
import { getSupabaseAdmin } from "../../supabase";
import { istTodayYMD, istYMD } from "../../dates";
import { lectureAccessForCourse } from "../../entitlements";
import type {
  Course,
  CourseAccessOverride,
  CourseEnrollment,
  Payment,
  Webinar,
  WebinarRegistration,
} from "../../types";
import {
  paidWebinarRegistrationCount,
  paidWebinarRegsOnYmd,
} from "../../webinarReg";
import { buildKeyboard, pinChatMessage } from "../botApi";
import { sendToChannel, salesChannelConfigured } from "../channels";
import { tgLog } from "../log";
import { istNowParts } from "../reports/format";
import { SITE_URL } from "../../config";
import { escapeHtml, optionalSalesInr, salesPhone } from "./format";
import { salesDigestEnabled } from "./settings";
import { flushSalesQueuedAlerts } from "./send";

const DIGEST_HOURS = [10, 15, 20] as const;

function daysFromNowIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Most recent 10/15/20 IST slot that has already started (catch-up like ops).
 * Cron runs at :35 UTC (= :05 IST), so we must NOT require minute 30–50 IST —
 * that window never overlaps the cron and digests never fired.
 */
export function salesDigestDueNow(d = new Date()): { due: boolean; slot: string | null } {
  const parts = istNowParts(d);
  let dueHour: number | null = null;
  for (const h of DIGEST_HOURS) {
    if (h <= parts.hour) dueHour = h;
  }
  if (dueHour == null) return { due: false, slot: null };
  return { due: true, slot: `sales:digest:${parts.ymd}:${dueHour}` };
}

async function alreadySentSlot(slot: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { data } = await db.from("telegram_report_snapshots").select("id").eq("slot_key", slot).maybeSingle();
  return !!data;
}

async function markSlot(slot: string): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db
    .from("telegram_report_snapshots")
    .upsert({ slot_key: slot, kind: "sales_digest", metrics: { ok: 1 } }, { onConflict: "slot_key" })
    .then(
      () => null,
      () => null,
    );
}

function phone(raw: string | null | undefined): string | null {
  const value = salesPhone(raw);
  return value ? escapeHtml(value) : null;
}

function money(value: unknown): string | null {
  return optionalSalesInr(Number(value));
}

function moreLine(total: number, shown: number): string[] {
  return total > shown ? [`· <i>and ${total - shown} more</i>`] : [];
}

export function capSalesDigestLines(lines: string[], max = 3900): string {
  const kept: string[] = [];
  const suffix = "\n<i>Digest truncated — open admin for the full list.</i>";
  for (const line of lines) {
    const next = [...kept, line].join("\n");
    if (next.length + suffix.length > max) break;
    kept.push(line);
  }
  const complete = kept.length === lines.length;
  return kept.join("\n") + (complete ? "" : suffix);
}

function enrollmentForPayment(
  payment: Payment,
  enrollments: readonly CourseEnrollment[],
): CourseEnrollment | null {
  const p10 = String(payment.phone || "").replace(/\D/g, "").slice(-10);
  return (
    enrollments.find(
      (e) =>
        isActiveEnrollment(e) &&
        (e.id === payment.enrollment_id ||
          (String(e.phone || "").replace(/\D/g, "").slice(-10) === p10 &&
            (e.course_slug === payment.item_slug || e.course_title === payment.item))),
    ) || null
  );
}

export async function buildSalesDigestHtml(): Promise<string> {
  const today = istTodayYMD();
  const now = Date.now();
  const horizon = daysFromNowIso(7);
  const todayStart = `${today}T00:00:00+05:30`;
  const db = getSupabaseAdmin();

  // Fixed query plan: 5 source reads + 3 bounded aggregate/detail reads. No N+1.
  const [pays, enrs, courses, overrides, webinars, proofResult, reminderResult, registrationResult]: [
    Payment[],
    CourseEnrollment[],
    Course[],
    CourseAccessOverride[],
    Webinar[],
    { data: unknown[] },
    { count: number },
    { data: unknown[] },
  ] = await Promise.all([
      getPayments().catch(() => []),
      getAllCourseEnrollments().catch(() => []),
      getAllCourses().catch(() => []),
      getAllAccessOverrides().catch(() => []),
      getWebinars().catch(() => []),
      db
        ? Promise.resolve(
            db
            .from("installment_payment_proofs")
            .select("id,phone,course_enrollment_id,created_at,status")
            .in("status", ["pending", "submitted", "reupload_requested"])
            .order("created_at", { ascending: true })
            .limit(200)
            .then((result) => ({ data: result.data || [] })),
          )
            .catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
      db
        ? Promise.resolve(
            db
            .from("student_access_events")
            .select("*", { count: "exact", head: true })
            .eq("event_type", "reminder_sent")
            .gte("created_at", todayStart)
            .then((result) => ({ count: result.count || 0 })),
          )
            .catch(() => ({ count: 0 }))
        : Promise.resolve({ count: 0 }),
      db
        ? Promise.resolve(
            db
            .from("webinar_registrations")
            .select("id,webinar_id,phone,created_at")
            .limit(2000)
            .then((result) => ({ data: result.data || [] })),
          )
            .catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] }),
    ]);

  const courseById = new Map(courses.map((c) => [c.id, c]));
  const overrideByEnrollment = new Map(
    overrides.map((o) => [`${String(o.phone).replace(/\D/g, "").slice(-10)}:${o.course_id}`, o]),
  );
  const enrollmentById = new Map(enrs.map((e) => [e.id, e]));

  const admissions = pays.filter(
    (p) =>
      !p.deleted_at &&
      isPaidStatus(p.status) &&
      p.item_type === "course" &&
      (p.payment_kind === "seat" ||
        p.payment_kind === "full" ||
        p.payment_kind === "one_time" ||
        p.payment_kind == null) &&
      istYMD(p.created_at) === today,
  );
  const ADMISSION_CAP = 6;
  const admissionLines = admissions.slice(0, ADMISSION_CAP).map((p) => {
    const e = enrollmentForPayment(p, enrs);
    const plan =
      e?.payment_plan === "FULL" || e?.plan_type === "full" ? "full" : e ? "instalment" : null;
    return [
      `· ${escapeHtml(p.student_name || "Student")}`,
      phone(p.phone),
      escapeHtml(p.item || p.item_slug || "Course"),
      plan,
      plan === "instalment" && e ? `bal ${money(deriveEnrollment(e).remaining)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  });

  const instPaid = pays.filter(
    (p) =>
      !p.deleted_at &&
      isPaidStatus(p.status) &&
      p.item_type === "course" &&
      p.payment_kind === "installment" &&
      istYMD(p.created_at) === today,
  );
  const INST_PAID_CAP = 6;
  const instLines = instPaid.slice(0, INST_PAID_CAP).map((p) => {
    const e = enrollmentForPayment(p, enrs);
    const total = e?.installment_count || null;
    const balance = e ? money(deriveEnrollment(e).remaining) : null;
    return [
      `· ${escapeHtml(p.student_name || "Student")}`,
      phone(p.phone),
      escapeHtml(p.item || p.item_slug || "Course"),
      p.installment_no
        ? `Inst ${p.installment_no}${total ? ` of ${total}` : ""}`
        : null,
      balance ? `bal ${balance}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  });

  const dueSoon: {
    name: string;
    phone: string;
    course: string;
    no: number;
    total: number | null;
    amount: number;
    due: string;
    daysRemaining: number;
    totalFee: number | null;
    paid: number | null;
    balance: number | null;
    access: string | null;
  }[] = [];
  for (const e of enrs) {
    if (!isActiveEnrollment(e)) continue;
    const course = courseById.get(e.course_id);
    const override = overrideByEnrollment.get(
      `${String(e.phone).replace(/\D/g, "").slice(-10)}:${e.course_id}`,
    );
    const access = lectureAccessForCourse(course, e, override, false, now).allowed
      ? "active"
      : "blocked";
    const derived = deriveEnrollment(e);
    for (const line of e.schedule || []) {
      if (line.kind === "seat" || !line.due || !isLineOutstanding(line)) continue;
      const dueYmd = String(line.due).slice(0, 10);
      if (dueYmd < today || dueYmd > horizon) continue;
      dueSoon.push({
        name: e.student_name || "Student",
        phone: e.phone,
        course: e.course_title || "Course",
        no: line.no,
        total: e.installment_count || null,
        amount: Number(line.amount) || 0,
        due: dueYmd,
        daysRemaining: Math.max(
          0,
          Math.ceil(
            (Date.parse(`${dueYmd}T00:00:00+05:30`) -
              Date.parse(`${today}T00:00:00+05:30`)) /
              86_400_000,
          ),
        ),
        totalFee: Number(e.total_fee) || null,
        paid: Number(derived.paid) || null,
        balance: Number(derived.remaining) || null,
        access: access || null,
      });
    }
  }
  dueSoon.sort((a, b) => a.due.localeCompare(b.due));
  const DUE_CAP = 8;
  const dueLines = dueSoon.slice(0, DUE_CAP).map((r) =>
    [
      `· ${escapeHtml(r.name)}`,
      phone(r.phone),
      escapeHtml(r.course),
      `Inst ${r.no}${r.total ? ` of ${r.total}` : ""}`,
      money(r.amount),
      r.due,
      `${r.daysRemaining}d`,
      r.totalFee ? `fee ${money(r.totalFee)}` : null,
      r.paid ? `paid ${money(r.paid)}` : null,
      r.balance ? `bal ${money(r.balance)}` : null,
      r.access,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  const proofs = (proofResult.data || []) as {
    id: string;
    phone: string;
    course_enrollment_id: string;
    created_at: string;
  }[];
  const oldestAgeH = proofs[0]?.created_at
    ? Math.max(0, Math.round((now - Date.parse(proofs[0].created_at)) / 3_600_000))
    : null;
  const PROOF_CAP = 6;
  const proofLines = proofs.slice(0, PROOF_CAP).map((proof) => {
    const e = enrollmentById.get(proof.course_enrollment_id);
    return [
      `· ${escapeHtml(e?.student_name || "Student")}`,
      phone(proof.phone || e?.phone),
      e?.course_title ? escapeHtml(e.course_title) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  });

  const registrationRows = (registrationResult.data || []) as WebinarRegistration[];
  const freeWebinarIds = new Set(webinars.filter((w) => !(Number(w.price) > 0)).map((w) => w.id));
  const freeToday = new Set(
    registrationRows
      .filter((r) => freeWebinarIds.has(r.webinar_id) && istYMD(r.created_at) === today)
      .map((r) => `${r.webinar_id}:${String(r.phone).replace(/\D/g, "").slice(-10)}`),
  ).size;
  const webinarToday = paidWebinarRegsOnYmd(pays, today) + freeToday;
  const upcoming = webinars
    .filter((w) => Date.parse(w.datetime) >= now && w.status !== "completed")
    .sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime))[0];
  let upcomingTotal: number | null = null;
  if (upcoming) {
    upcomingTotal =
      Number(upcoming.price) > 0
        ? paidWebinarRegistrationCount(pays, upcoming.slug || upcoming.id)
        : new Set(
            registrationRows
              .filter((r) => r.webinar_id === upcoming.id)
              .map((r) => String(r.phone).replace(/\D/g, "").slice(-10)),
          ).size;
  }

  const parts = istNowParts();
  const lines = [
    `📋 <b>Sales digest</b> · ${escapeHtml(parts.label)}`,
    ``,
    `<b>New admissions today</b>: ${admissions.length}`,
    ...(admissionLines.length ? admissionLines : ["· none"]),
    ...moreLine(admissions.length, admissionLines.length),
    ``,
    `<b>Instalments paid today</b>: ${instPaid.length}`,
    ...(instLines.length ? instLines : ["· none"]),
    ...moreLine(instPaid.length, instLines.length),
    ``,
    `<b>Instalments due next 7 days</b>: ${dueSoon.length}`,
    ...(dueLines.length ? dueLines : ["· none"]),
    ...moreLine(dueSoon.length, dueLines.length),
    ``,
    `<b>Proofs pending review</b>: ${proofs.length}${
      oldestAgeH != null ? ` · oldest ${oldestAgeH}h` : ""
    }`,
    ...proofLines,
    ...moreLine(proofs.length, proofLines.length),
    ``,
    `<b>Reminders sent today</b>: ${reminderResult.count || 0}`,
    `<b>Webinar registrations today</b>: ${webinarToday}`,
    upcoming
      ? `<b>Upcoming webinar registrations</b>: ${upcomingTotal ?? 0} · ${escapeHtml(upcoming.title)}`
      : `<b>Upcoming webinar registrations</b>: 0`,
  ];
  return capSalesDigestLines(lines);
}

export async function runSalesDigestIfDue(opts?: { force?: boolean }): Promise<{
  ok: boolean;
  sent: boolean;
  slot: string | null;
  flushed: number;
}> {
  try {
    if (!salesChannelConfigured()) return { ok: true, sent: false, slot: null, flushed: 0 };
    if (!(await salesDigestEnabled())) return { ok: true, sent: false, slot: null, flushed: 0 };

    const due = opts?.force
      ? { due: true, slot: `sales:digest:force:${Date.now()}` }
      : salesDigestDueNow();
    if (!due.due || !due.slot) return { ok: true, sent: false, slot: null, flushed: 0 };
    if (!opts?.force && (await alreadySentSlot(due.slot))) {
      return { ok: true, sent: false, slot: due.slot, flushed: 0 };
    }

    // Drain rate-limit backlog before posting digest.
    const flushed = await flushSalesQueuedAlerts({ force: !!opts?.force });

    const html = await buildSalesDigestHtml();
    const base = (SITE_URL || "https://www.namanias.com").replace(/\/$/, "");
    const res = await sendToChannel("sales", {
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      disable_notification: true,
      reply_markup: buildKeyboard([
        { label: "Admissions", url: `${base}/admin/course-payments` },
        { label: "Access at Risk", url: `${base}/admin/access-risk` },
      ]),
    });
    if (res.ok) {
      const messageId = (res.result as { message_id?: number } | undefined)?.message_id;
      const chatId = (process.env.TELEGRAM_SALES_CHAT_ID || "").trim();
      if (messageId != null && chatId) {
        await pinChatMessage(chatId, messageId).catch(() => null);
      }
      if (!opts?.force) await markSlot(due.slot);
    }
    return { ok: res.ok, sent: !!res.ok, slot: due.slot, flushed };
  } catch (e) {
    tgLog("sales_digest_failed", { error: (e as Error).message }, "error");
    return { ok: false, sent: false, slot: null, flushed: 0 };
  }
}
