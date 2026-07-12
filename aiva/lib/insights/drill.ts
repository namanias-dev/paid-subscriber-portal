import {
  fetchPayments,
  fetchCourseEnrollments,
  fetchWebinarRegistrations,
  fetchWebinars,
  fetchCoursesLite,
  fetchSmsForPhones,
  fetchStudentIdsByPhone,
  type SmsLogLite,
} from "../data";
import { isPaidStatus } from "@portal/lib/paymentsAgg";
import { deriveEnrollment, isActiveEnrollment, isLineOutstanding } from "@portal/lib/installments";
import { normPhone } from "./calc";
import { maskPhone } from "../mask";
import { recordLinks, type PortalLink } from "../portal/links";
import type { CourseEnrollment, WebinarRegistration, Webinar, Payment, InstallmentItem } from "@portal/lib/types";

/**
 * Drill-down stitcher: turns a clicked metric into the ACTUAL records behind it, read-only.
 * Every row is a stitched cross-table story (webinar → attendance → batch → enrollment →
 * payments → SMS history → timeline). PII is masked (phone to last 4). Pure list/format
 * helpers live at the top (unit-tested); the DB stitching lives in getDrill().
 */

const DAY = 86_400_000;

export type SmsSummary = {
  count: number;
  lastType: string | null;
  lastSent: string | null;
  lastStatus: string | null;
  hasReminder: boolean;
};

export type TimelineStep = { label: string; date: string | null; done: boolean };

export type DrillRow = {
  id: string;
  name: string;
  phoneMasked: string;
  webinar: { title: string; date: string | null; attended: boolean | null } | null;
  batch: { id: string | null; label: string | null } | null;
  enrollment: { status: string; amountPaid: number; outstanding: number } | null;
  amount: number | null;
  amountLabel: string | null;
  reminderSent: boolean | null;
  matchConfidence: "confirmed" | "probable" | null;
  sms: SmsSummary;
  timeline: TimelineStep[];
  links: PortalLink[];
};

export type DrillResult = {
  ok: true;
  metric: string;
  title: string;
  note?: string;
  total: number;
  page: number;
  pageSize: number;
  rows: DrillRow[];
};

// ---------------------------------------------------------------------------
// PURE HELPERS (unit-tested in tests/drill-calc.test.ts)
// ---------------------------------------------------------------------------

/** True when an SMS trigger/template looks like a payment/installment reminder. */
export function isReminderTrigger(triggerOrTemplate: string | null | undefined): boolean {
  if (!triggerOrTemplate) return false;
  return /remind|installment|instalment|overdue|due|payment|fee/i.test(triggerOrTemplate);
}

/** Collapse a phone's SMS rows into a compact comms summary (latest by sent_at||created_at). */
export function summarizeSms(rows: SmsLogLite[]): SmsSummary {
  if (!rows.length) return { count: 0, lastType: null, lastSent: null, lastStatus: null, hasReminder: false };
  const sorted = [...rows].sort((a, b) => tms(b.sent_at || b.created_at) - tms(a.sent_at || a.created_at));
  const last = sorted[0];
  const hasReminder = rows.some((r) => isReminderTrigger(r.trigger_event) || isReminderTrigger(r.template_name));
  return {
    count: rows.length,
    lastType: last.template_name || last.trigger_event || "SMS",
    lastSent: last.sent_at || last.created_at || null,
    lastStatus: last.status || null,
    hasReminder,
  };
}

function tms(iso: string | null | undefined): number {
  return iso ? Date.parse(iso) || 0 : 0;
}

/** Case-insensitive match of a query against a subject's name + last-4 phone. */
export function matchesQuery(name: string, phone: string, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = `${name} ${normPhone(phone)}`.toLowerCase();
  return hay.includes(needle);
}

/** Slice a list into a page (1-based). */
export function paginate<T>(rows: T[], page: number, pageSize: number): T[] {
  const p = Math.max(1, Math.floor(page) || 1);
  const start = (p - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

// ---------------------------------------------------------------------------
// DB STITCHER
// ---------------------------------------------------------------------------

type RegRow = WebinarRegistration & { matched_enrollment_id?: string | null; match_method?: string | null };
type EnrRow = CourseEnrollment & { batch_id?: string | null };

/** An intermediate subject before SMS enrichment (SMS is fetched only for the page slice). */
type Subject = {
  id: string;
  name: string;
  phone: string;
  webinarId?: string | null;
  attended?: boolean | null;
  registeredAt?: string | null;
  enrollmentId?: string | null;
  matchMethod?: string | null;
  amount?: number | null;
  amountLabel?: string | null;
  dueDate?: string | null;
};

const PAGE_SIZE = 10;

export async function getDrill(domain: string, metric: string, q: string, page: number): Promise<DrillResult | null> {
  const [payments, enrollments, regs, webinars, courses] = await Promise.all([
    fetchPayments(),
    fetchCourseEnrollments(),
    fetchWebinarRegistrations(),
    fetchWebinars(),
    fetchCoursesLite(),
  ]);

  const enrById = new Map(enrollments.map((e) => [e.id, e as EnrRow]));
  const webById = new Map(webinars.map((w) => [w.id, w]));
  const batchLabelById = new Map<string, string>();
  for (const c of courses) for (const b of c.batches || []) if (b.id) batchLabelById.set(b.id, b.label || b.id);

  // earliest PAID payment date per phone (for the "paid" timeline step)
  const firstPaidByPhone = new Map<string, string>();
  for (const p of payments as Payment[]) {
    if (!isPaidStatus(p.status as never)) continue;
    const ph = normPhone(p.phone);
    if (!ph) continue;
    const t = p.created_at;
    const cur = firstPaidByPhone.get(ph);
    if (!cur || tms(t) < tms(cur)) firstPaidByPhone.set(ph, t);
  }

  let subjects: Subject[] = [];
  let title = "Records";
  let note: string | undefined;

  const buildRegSubjects = (filter: (r: RegRow) => boolean): Subject[] => {
    const byPhone = new Map<string, Subject>();
    for (const r of regs as RegRow[]) {
      if (!filter(r)) continue;
      const ph = normPhone(r.phone);
      if (ph.length !== 10) continue;
      const prev = byPhone.get(ph);
      const cand: Subject = {
        id: ph,
        name: r.name || "—",
        phone: r.phone,
        webinarId: r.webinar_id,
        attended: !!r.attended,
        registeredAt: r.created_at,
        enrollmentId: r.matched_enrollment_id ?? null,
        matchMethod: r.match_method ?? null,
      };
      // keep the most recent registration for display; OR-in attendance
      if (!prev || tms(r.created_at) > tms(prev.registeredAt)) {
        if (prev) cand.attended = cand.attended || prev.attended;
        byPhone.set(ph, cand);
      } else if (r.attended) {
        prev.attended = true;
      }
    }
    return [...byPhone.values()];
  };

  switch (`${domain}:${metric}`) {
    // ---- Webinar funnel (analytics) ----
    case "analytics:webinar:registrants": {
      subjects = buildRegSubjects(() => true);
      title = "Row-level webinar registrants";
      break;
    }
    case "analytics:webinar:converted": {
      subjects = buildRegSubjects((r) => r.match_method === "phone");
      title = "Converted — phone-confirmed";
      break;
    }
    case "analytics:webinar:probable": {
      subjects = buildRegSubjects((r) => r.match_method === "name_probable");
      title = "Probable converts (name-match — UNCONFIRMED)";
      note = "These are matched by name with a DIFFERENT phone than they registered with. Treat as unconfirmed — not counted in the hard conversion rate.";
      break;
    }
    case "analytics:webinar:paid": {
      subjects = buildRegSubjects((r) => r.match_method === "phone").filter((s) => {
        const e = s.enrollmentId ? enrById.get(s.enrollmentId) : null;
        return e ? deriveEnrollment(e).paid > 0 : false;
      });
      title = "Paid cohort (converted + paid ≥ 1 installment)";
      break;
    }

    // ---- Admissions (per-batch / active) ----
    case "admissions:active": {
      subjects = enrollments.filter((e) => isActiveEnrollment(e)).map(enrToSubject);
      title = "Active enrollments";
      break;
    }
    case "admissions:batch:unmapped": {
      subjects = enrollments.filter((e) => isActiveEnrollment(e) && !(e as EnrRow).batch_id).map(enrToSubject);
      title = "Active enrollments — unmapped to a batch";
      break;
    }

    // ---- Revenue lists ----
    case "revenue:abandoned": {
      subjects = (payments as Payment[])
        .filter((p) => String(p.status) === "ABANDONED")
        .map((p) => ({ id: p.id, name: p.student_name || "—", phone: p.phone, amount: Number(p.amount) || 0, amountLabel: "Abandoned", registeredAt: p.created_at }));
      title = "Abandoned checkouts (value at risk)";
      break;
    }
    case "revenue:overdue":
    case "revenue:overdue15":
    case "revenue:aging:today":
    case "revenue:aging:1_3":
    case "revenue:aging:4_7":
    case "revenue:aging:8plus":
    case "revenue:atrisk": {
      const parts = metric.split(":");
      const bucket = metric === "overdue15" ? "15plus" : parts[0] === "aging" ? parts[1] || "all" : "all";
      const now = Date.now();
      const lines: Subject[] = [];
      for (const e of enrollments) {
        if (!isActiveEnrollment(e)) continue;
        const schedule: InstallmentItem[] = Array.isArray(e.schedule) ? e.schedule : [];
        for (const [i, line] of schedule.entries()) {
          if (!isLineOutstanding(line)) continue;
          const amt = Math.max(0, (Number(line.amount) || 0) - (Number(line.paid_amount) || 0));
          const od = line.due ? Math.floor((now - (Date.parse(line.due) || now)) / DAY) : 0;
          if (od < 0) continue;
          const inBucket =
            bucket === "today" ? od === 0 :
            bucket === "1_3" ? od >= 1 && od <= 3 :
            bucket === "4_7" ? od >= 4 && od <= 7 :
            bucket === "8plus" ? od >= 8 :
            bucket === "15plus" ? od >= 15 :
            true; // overdue/atrisk = all outstanding+overdue lines
          if (!inBucket) continue;
          lines.push({ id: `${e.id}:${i}`, name: e.student_name || "—", phone: e.phone, enrollmentId: e.id, amount: amt, amountLabel: od === 0 ? "Due today" : `${od}d overdue`, dueDate: line.due });
        }
      }
      if (metric === "atrisk") {
        for (const p of payments as Payment[]) {
          if (String(p.status) !== "ABANDONED") continue;
          lines.push({ id: p.id, name: p.student_name || "—", phone: p.phone, amount: Number(p.amount) || 0, amountLabel: "Abandoned", registeredAt: p.created_at });
        }
      }
      subjects = lines;
      title =
        metric === "atrisk" ? "At-risk revenue (overdue + abandoned)" :
        bucket === "today" ? "Installments due today" :
        bucket === "1_3" ? "Overdue 1–3 days" :
        bucket === "4_7" ? "Overdue 4–7 days" :
        bucket === "8plus" ? "Overdue 8+ days" :
        bucket === "15plus" ? "Overdue 15+ days" :
        "Overdue installments";
      break;
    }

    case "revenue:paidnoenroll": {
      const activePhones = new Set(enrollments.filter((e) => isActiveEnrollment(e)).map((e) => normPhone(e.phone)));
      const byPhone = new Map<string, Subject>();
      for (const p of payments as Payment[]) {
        if (p.item_type !== "course" || !isPaidStatus(p.status as never)) continue;
        const ph = normPhone(p.phone);
        if (!ph || activePhones.has(ph)) continue;
        if (!byPhone.has(ph)) byPhone.set(ph, { id: ph, name: p.student_name || "—", phone: p.phone, amount: Number(p.amount) || 0, amountLabel: "Paid, no active enrollment", registeredAt: p.created_at });
      }
      subjects = [...byPhone.values()];
      title = "Paid but no active enrollment";
      break;
    }

    case "revenue:recentpaid": {
      const cut = Date.now() - 30 * DAY;
      subjects = (payments as Payment[])
        .filter((p) => isPaidStatus(p.status as never) && (Date.parse(p.created_at) || 0) >= cut)
        .map((p) => ({ id: p.id, name: p.student_name || "—", phone: p.phone, amount: Number(p.amount) || 0, amountLabel: "Paid", registeredAt: p.created_at }));
      title = "Payments collected (last 30 days)";
      break;
    }

    case "admissions:nosms": {
      const active = enrollments.filter((e) => isActiveEnrollment(e));
      const smsRows = await fetchSmsForPhones(active.map((e) => e.phone));
      const withSms = new Set(smsRows.map((l) => normPhone(l.normalized_mobile || l.mobile)).filter(Boolean));
      subjects = active.filter((e) => !withSms.has(normPhone(e.phone))).map(enrToSubject);
      title = "Active enrollments with zero SMS contact";
      break;
    }

    default: {
      // per-batch drill: metric = "batch:<batchId>"
      if (metric.startsWith("batch:")) {
        const batchId = metric.slice("batch:".length);
        subjects = enrollments
          .filter((e) => isActiveEnrollment(e) && (e as EnrRow).batch_id === batchId)
          .map(enrToSubject);
        title = `Batch — ${batchLabelById.get(batchId) || batchId}`;
        break;
      }
      return null;
    }
  }

  function enrToSubject(e: CourseEnrollment): Subject {
    const er = e as EnrRow;
    return { id: e.id, name: e.student_name || "—", phone: e.phone, enrollmentId: e.id, dueDate: null, amount: null };
  }

  // search + total, then paginate BEFORE the SMS join (SMS only for the visible page)
  const filtered = subjects.filter((s) => matchesQuery(s.name, s.phone, q));
  const total = filtered.length;
  const pageRows = paginate(filtered, page, PAGE_SIZE);

  const [smsLogs, studentIds] = await Promise.all([
    fetchSmsForPhones(pageRows.map((s) => s.phone)),
    fetchStudentIdsByPhone(pageRows.map((s) => s.phone)),
  ]);
  const smsByPhone = new Map<string, SmsLogLite[]>();
  for (const l of smsLogs) {
    const ph = normPhone(l.normalized_mobile || l.mobile);
    if (!ph) continue;
    const arr = smsByPhone.get(ph) || [];
    arr.push(l);
    smsByPhone.set(ph, arr);
  }

  const rows: DrillRow[] = pageRows.map((s) => {
    const ph = normPhone(s.phone);
    const e = s.enrollmentId ? enrById.get(s.enrollmentId) : null;
    const der = e ? deriveEnrollment(e) : null;
    const w = s.webinarId ? webById.get(s.webinarId) : null;
    const sms = summarizeSms(smsByPhone.get(ph) || []);
    const batchId = e ? (e as EnrRow).batch_id ?? null : null;

    const timeline: TimelineStep[] = [];
    if (s.registeredAt || w) timeline.push({ label: "Registered", date: s.registeredAt || w?.datetime || null, done: !!(s.registeredAt || w) });
    if (s.attended != null && (w || s.webinarId)) timeline.push({ label: s.attended ? "Attended" : "No-show", date: w?.datetime || null, done: !!s.attended });
    if (e) timeline.push({ label: "Enrolled", date: e.created_at, done: true });
    const paidDate = firstPaidByPhone.get(ph) || null;
    if (der && der.paid > 0) timeline.push({ label: "Paid", date: paidDate, done: true });

    return {
      id: s.id,
      name: s.name,
      phoneMasked: maskPhone(s.phone),
      webinar: w ? { title: w.title, date: w.datetime, attended: s.attended ?? null } : (s.webinarId ? { title: s.webinarId, date: null, attended: s.attended ?? null } : null),
      batch: e ? { id: batchId, label: batchId ? batchLabelById.get(batchId) || null : (e.batch_label ?? null) } : null,
      enrollment: e && der ? { status: String(e.status), amountPaid: der.paid, outstanding: der.remaining } : null,
      amount: s.amount ?? null,
      amountLabel: s.amountLabel ?? null,
      reminderSent: s.amountLabel ? sms.hasReminder : null,
      matchConfidence: s.matchMethod === "phone" ? "confirmed" : s.matchMethod === "name_probable" ? "probable" : null,
      sms,
      timeline,
      links: recordLinks({ studentId: studentIds.get(ph) || null, webinarId: s.webinarId || null, courseId: e?.course_id || null, showPayments: true }),
    };
  });

  return { ok: true, metric, title, note, total, page: Math.max(1, Math.floor(page) || 1), pageSize: PAGE_SIZE, rows };
}

export type ProbableMatch = {
  name: string;
  registeredPhoneMasked: string;
  enrollmentPhoneMasked: string;
  webinar: { title: string; date: string | null } | null;
  batch: string | null;
  enrollmentStatus: string;
  amountPaid: number;
  outstanding: number;
};

/**
 * BUILD 2 — the 20 name_probable webinar→enrollment matches, side by side, for human review.
 * Read-only: AIVA cannot confirm/merge these. Both phone numbers are masked to last 4.
 */
export async function getProbableMatches(): Promise<{ ok: true; total: number; unconfirmed: true; rows: ProbableMatch[] }> {
  const [enrollments, regs, webinars, courses] = await Promise.all([
    fetchCourseEnrollments(),
    fetchWebinarRegistrations(),
    fetchWebinars(),
    fetchCoursesLite(),
  ]);
  const enrById = new Map(enrollments.map((e) => [e.id, e as EnrRow]));
  const webById = new Map(webinars.map((w) => [w.id, w]));
  const batchLabelById = new Map<string, string>();
  for (const c of courses) for (const b of c.batches || []) if (b.id) batchLabelById.set(b.id, b.label || b.id);

  const rows: ProbableMatch[] = [];
  const seen = new Set<string>();
  for (const r of regs as RegRow[]) {
    if (r.match_method !== "name_probable" || !r.matched_enrollment_id) continue;
    const key = `${normPhone(r.phone)}:${r.matched_enrollment_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const e = enrById.get(r.matched_enrollment_id);
    if (!e) continue;
    const der = deriveEnrollment(e);
    const w = r.webinar_id ? webById.get(r.webinar_id) : null;
    const batchId = (e as EnrRow).batch_id ?? null;
    rows.push({
      name: r.name || e.student_name || "—",
      registeredPhoneMasked: maskPhone(r.phone),
      enrollmentPhoneMasked: maskPhone(e.phone),
      webinar: w ? { title: w.title, date: w.datetime } : null,
      batch: batchId ? batchLabelById.get(batchId) || batchId : e.batch_label ?? null,
      enrollmentStatus: String(e.status),
      amountPaid: der.paid,
      outstanding: der.remaining,
    });
  }
  return { ok: true, total: rows.length, unconfirmed: true, rows };
}
