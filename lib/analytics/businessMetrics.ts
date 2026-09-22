/**
 * Academy business metrics — one definition for Telegram, and any later dashboard.
 *
 * Money is integer rupees (the `payments.amount` ledger). There is no paise column.
 * Day and month boundaries are Asia/Kolkata [start, next start).
 *
 * newAccounts
 *   Unique buyer accounts created in the window, excluding staff (`buyers.is_staff`)
 *   and quiz-only leads (`buyers.is_lead`). A legacy student row with no buyer is
 *   included. Student rows created only to attach an older buyer are not.
 *
 * uniqueLoginUsers
 *   Unique students with a genuine credential login in the window.
 *   Sources: `analytics_events.event_name = login` (portal / unified login / quiz
 *   auto-session — written only from those handlers, never from token refresh,
 *   middleware, or page views) and `access_logs.action = login` (subscription
 *   dashboard login). Same person counts once. Staff, leads, and documented
 *   internal student ids are excluded.
 *
 * loginEvents
 *   Count of those login rows before unique-ing. Five logins by one student → 5.
 *
 * activeUsers
 *   Unique non-staff students with meaningful authenticated use in the window:
 *   a login (above) OR `portal_active` (one server event per signed-in portal or
 *   dashboard visit per IST day, from deployment forward) OR `course_opened`,
 *   `zoom_link_clicked`, `enrolled_card_viewed`.
 *   Not bot traffic, health checks, anonymous page views, or token refresh.
 *   Someone who logged in yesterday and only continues a session today is counted
 *   once `portal_active` exists for that day. Before that event was recorded,
 *   this is a lower bound (login + course/zoom/card events only).
 *
 * returningActiveUsers
 *   activeUsers who are not newAccounts. Holds only when both inputs loaded:
 *   activeUsers = newUsersActive + returningActiveUsers.
 *
 * payingStudents
 *   Unique phones on deduped successful collection rows in the window.
 *
 * successfulPayments
 *   Count of those rows (one student can pay more than once).
 *
 * grossCollection
 *   Sum of deduped successful positive `payments.amount` values — the rupees
 *   actually recorded on that transaction (seat, installment, full payment,
 *   webinar, plan, or offline/cash/UPI/bank entry). Never `course_enrollments.total_fee`,
 *   `amount_paid`, remaining balance, or `payments.total_amount` (that column can
 *   include a gateway surcharge). Collected Today / Net starts here.
 *
 * refundAmount
 *   Absolute rupees of dated reversal rows (negative PAID proof reversals) whose
 *   `created_at` is in the window. A status flip to `refunded` or a reverse that
 *   only clears PAID, with no reversal row and no reversal timestamp, is NOT
 *   invented as a refund figure — that payment simply leaves gross because it
 *   is no longer PAID.
 *
 * netCollection
 *   grossCollection − refundAmount.
 *
 * Payment categories (partition of gross, so they sum to grossCollection):
 *   admission — course payment_kind full / one_time / null (null is the legacy one-time fee).
 *     Reported as "Full payments". This is cash received, not an admission count.
 *   installment — course payment_kind installment
 *   seat — course payment_kind seat
 *   webinar — item_type webinar
 *   plan — item_type plan
 *   other — anything else that still qualifies as collected
 */
import type { CourseEnrollment, Payment } from "../types";
import { normPhone } from "../phone";
import { isPaidStatus, dedupePaidRows } from "../paymentsAgg";
import { isActiveEnrollment } from "../installments";
import { istYMDToMs } from "../dates";
import { LEADERBOARD_EXCLUDED_STUDENT_IDS } from "../leaderboardExclusions";

export const DAY_MS = 86_400_000;

export interface TimeWindow {
  /** Inclusive UTC ms. */
  fromMs: number;
  /** Exclusive UTC ms. */
  toMs: number;
}

export function istDayWindow(ymd: string): TimeWindow {
  const fromMs = istYMDToMs(ymd);
  return { fromMs, toMs: fromMs + DAY_MS };
}

/** Calendar month in Asia/Kolkata. `month` is 1–12. */
export function istMonthWindow(year: number, month: number): TimeWindow {
  const fromMs = istYMDToMs(`${year}-${String(month).padStart(2, "0")}-01`);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const toMs = istYMDToMs(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01`);
  return { fromMs, toMs };
}

/** Month-to-date: IST month start through the end of today (rest of month is empty). */
export function istMonthToDateWindow(todayYmd: string): TimeWindow {
  const [y, m] = todayYmd.split("-").map(Number);
  const start = istMonthWindow(y, m);
  const endOfToday = istDayWindow(todayYmd).toMs;
  return { fromMs: start.fromMs, toMs: endOfToday };
}

export function inWindow(iso: string | null | undefined, w: TimeWindow): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= w.fromMs && t < w.toMs;
}

/** Stable person key. Phone wins so a buyer and a student row for the same mobile collapse. */
export function personKey(parts: {
  phone?: string | null;
  buyerId?: string | null;
  studentId?: string | null;
}): string | null {
  const ph = normPhone(parts.phone);
  if (ph) return `p:${ph}`;
  const buyerId = (parts.buyerId || "").trim();
  if (buyerId) return `b:${buyerId}`;
  const studentId = (parts.studentId || "").trim();
  if (studentId) return `s:${studentId}`;
  return null;
}

export function isInternalStudentId(id: string | null | undefined): boolean {
  return !!id && LEADERBOARD_EXCLUDED_STUDENT_IDS.has(id);
}

export interface PeopleMetrics {
  /** Null when that input could not be loaded — never a fabricated zero. */
  newAccounts: number | null;
  uniqueLoginUsers: number | null;
  loginEvents: number | null;
  activeUsers: number | null;
  returningActiveUsers: number | null;
  newUsersActive: number | null;
}

/**
 * activeUsers = newUsersActive + returningActiveUsers
 * when both new-account keys and activity keys were loaded.
 * Login keys are activity. Staff filtering happens before this function.
 */
export function computePeople(input: {
  newAccountKeys: string[] | null;
  /** One entry per login event (duplicates kept). Null if login sources failed. */
  loginEventKeys: string[] | null;
  /** One entry per non-login activity hit is enough; duplicates are fine. */
  activityKeys: string[] | null;
}): PeopleMetrics {
  const newAccounts =
    input.newAccountKeys == null ? null : new Set(input.newAccountKeys).size;

  const loginEvents = input.loginEventKeys == null ? null : input.loginEventKeys.length;
  const uniqueLoginUsers =
    input.loginEventKeys == null ? null : new Set(input.loginEventKeys).size;

  if (input.activityKeys == null || input.loginEventKeys == null) {
    return {
      newAccounts,
      uniqueLoginUsers,
      loginEvents,
      activeUsers: null,
      returningActiveUsers: null,
      newUsersActive: null,
    };
  }

  const active = new Set<string>([...input.activityKeys, ...input.loginEventKeys]);
  const fresh = new Set(input.newAccountKeys || []);
  let newUsersActive = 0;
  if (input.newAccountKeys != null) {
    for (const k of active) if (fresh.has(k)) newUsersActive++;
  }
  const returning =
    input.newAccountKeys == null ? null : active.size - newUsersActive;

  return {
    newAccounts,
    uniqueLoginUsers,
    loginEvents,
    activeUsers: active.size,
    returningActiveUsers: returning,
    newUsersActive: input.newAccountKeys == null ? null : newUsersActive,
  };
}

export type CollectionCategory =
  | "admission"
  | "installment"
  | "seat"
  | "webinar"
  | "plan"
  | "other";

export interface CategoryLine {
  key: CollectionCategory;
  amount: number;
  payments: number;
  students: number;
}

export interface CollectionMetrics {
  /**
   * Successful money received in the window before refunds.
   * Status PAID or captured only. Failed, pending, initiated, abandoned,
   * expired, refunded-without-a-dated-reversal-row, deleted, demo, staff,
   * and duplicate webhook rows are excluded.
   */
  grossCollection: number;
  refundAmount: number;
  /** grossCollection − refundAmount. This is "Collected Today" when the window is today. */
  netCollection: number;
  successfulPayments: number;
  payingStudents: number;
  categories: CategoryLine[];
}

export interface AdmissionMetrics {
  /** Active course enrollments created in the window (one per course admission). */
  admissions: number;
  /** Unique phones among those enrollments. */
  students: number;
  byCourse: { title: string; admissions: number }[];
}

const CATEGORY_ORDER: CollectionCategory[] = [
  "admission",
  "installment",
  "seat",
  "webinar",
  "plan",
  "other",
];

export function collectionCategory(p: Pick<Payment, "item_type" | "payment_kind">): CollectionCategory {
  if (p.item_type === "webinar") return "webinar";
  if (p.item_type === "plan") return "plan";
  if (p.item_type === "course") {
    const k = p.payment_kind || "full";
    if (k === "seat") return "seat";
    if (k === "installment") return "installment";
    if (k === "full" || k === "one_time") return "admission";
    return "other";
  }
  return "other";
}

function rupees(n: number | null | undefined): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v);
}

function isReversal(p: Payment): boolean {
  if (p.reversal_of_payment_id) return true;
  if (p.payment_source === "student_proof_reversal") return true;
  return rupees(p.amount) < 0;
}

function isDemoPayment(p: Payment): boolean {
  const ref = `${p.gateway_ref || ""} ${p.reference_no || ""}`;
  return /\bDEMO-/i.test(ref);
}

function excludedPhone(p: Payment, staffPhones: Set<string>): boolean {
  const ph = normPhone(p.phone);
  return !!ph && staffPhones.has(ph);
}

/**
 * Real successful collection for one window.
 * Deduped with the same phone + item + kind + installment + amount key the
 * finance pages use, so a repeated webhook does not add the same money twice.
 */
export function computeCollections(
  payments: Payment[],
  window: TimeWindow,
  staffPhones: Set<string>,
): CollectionMetrics {
  const grossRows: Payment[] = [];
  const refundRows: Payment[] = [];

  for (const p of payments) {
    if (p.deleted_at) continue;
    if (!isPaidStatus(p.status)) continue;
    if (!inWindow(p.created_at, window)) continue;
    if (isDemoPayment(p)) continue;
    if (excludedPhone(p, staffPhones)) continue;
    if (p.duplicate_of_payment_id) continue;
    if (isReversal(p)) refundRows.push(p);
    else if (rupees(p.amount) > 0) grossRows.push(p);
  }

  const grossDeduped = dedupePaidRows(grossRows);
  const refundDeduped = dedupePaidRows(refundRows);

  const buckets = new Map<CollectionCategory, { amount: number; rows: Payment[] }>();
  for (const key of CATEGORY_ORDER) buckets.set(key, { amount: 0, rows: [] });

  let gross = 0;
  const payers = new Set<string>();
  for (const p of grossDeduped) {
    const amt = rupees(p.amount);
    gross += amt;
    const key = collectionCategory(p);
    const b = buckets.get(key)!;
    b.amount += amt;
    b.rows.push(p);
    const ph = normPhone(p.phone);
    if (ph) payers.add(ph);
  }

  let refundAmount = 0;
  for (const p of refundDeduped) refundAmount += Math.abs(rupees(p.amount));

  const categories: CategoryLine[] = CATEGORY_ORDER.map((key) => {
    const b = buckets.get(key)!;
    const students = new Set<string>();
    for (const p of b.rows) {
      const ph = normPhone(p.phone);
      if (ph) students.add(ph);
    }
    return { key, amount: b.amount, payments: b.rows.length, students: students.size };
  });

  return {
    grossCollection: gross,
    refundAmount,
    netCollection: gross - refundAmount,
    successfulPayments: grossDeduped.length,
    payingStudents: payers.size,
    categories,
  };
}

/** Category amounts are a partition of gross. */
export function collectionsReconcile(m: CollectionMetrics): boolean {
  const sum = m.categories.reduce((a, c) => a + c.amount, 0);
  return sum === m.grossCollection && m.netCollection === m.grossCollection - m.refundAmount;
}

export function computeAdmissions(
  enrollments: CourseEnrollment[],
  window: TimeWindow,
  staffPhones: Set<string>,
): AdmissionMetrics {
  const rows = enrollments.filter((e) => {
    if (e.superseded_by) return false;
    if (!isActiveEnrollment(e)) return false;
    if (!inWindow(e.created_at, window)) return false;
    const ph = normPhone(e.phone);
    if (ph && staffPhones.has(ph)) return false;
    if (isInternalStudentId(e.student_id)) return false;
    return true;
  });

  const byTitle = new Map<string, number>();
  const students = new Set<string>();
  for (const e of rows) {
    const title = (e.course_title || "Course").trim() || "Course";
    byTitle.set(title, (byTitle.get(title) || 0) + 1);
    const ph = normPhone(e.phone);
    if (ph) students.add(ph);
    else students.add(`e:${e.id}`);
  }

  const byCourse = [...byTitle.entries()]
    .map(([title, admissions]) => ({ title, admissions }))
    .sort((a, b) => b.admissions - a.admissions || a.title.localeCompare(b.title));

  return { admissions: rows.length, students: students.size, byCourse };
}
