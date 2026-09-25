/**
 * Build + send Telegram CEO digests.
 * Cash collected is computeCollections on successful payments.amount.
 * Executive pulse supplies non-cash morning context only (leads, seat counts).
 */
import { SITE_URL } from "../../config";
import { getExecutivePulse, type MetricDelta } from "../../analytics/executiveOverview";
import {
  getAllCourseEnrollments,
  getAllCourses,
  getPayments,
  getWebinars,
} from "../../dataProvider";
import { istYMD, istTodayYMD, istYMDToMs } from "../../dates";
import {
  computeAdmissions,
  computeCollections,
  DAY_MS,
  istDayWindow,
  istMonthToDateWindow,
  type CollectionMetrics,
} from "../../analytics/businessMetrics";
import { loadPeopleMetrics, loadReportExclusions } from "../../analytics/loadBusinessMetrics";
import {
  digestSnapshotSlot,
  executiveBriefLines,
  packTelegramMessages,
  type CourseBrief,
  type FailedBrief,
} from "./businessFormat";
import { loadSmsDelivery } from "../../analytics/loadSmsDelivery";
import type { SmsDeliveryMetrics } from "../../analytics/smsDelivery";
import {
  batchModes,
  batchTimings,
  deriveCollections,
  deriveEnrollment,
  isActiveEnrollment,
} from "../../installments";
import { countsTowardCapacity } from "../../enrollmentScope";
import { isPaidStatus } from "../../paymentsAgg";
import {
  paidWebinarRegistrationCount,
  pendingWebinarCheckoutCount,
  webinarRegistrationReport,
} from "../../webinarReg";
import type { Course, CourseBatch, CourseEnrollment, LearningMode, Payment } from "../../types";
import { buildKeyboard, sendMessage } from "../botApi";
import { tgLog } from "../log";
import { formatIstClock, formatIstEvent, inrExact, istBriefStamp, istNowParts } from "./format";
import { ensureReportingReference } from "./definitions";
import { resolveLoginAverages } from "./loginAvg";
import {
  getReportSettings,
  inQuietHours,
  markDigestResult,
  maskChannelId,
  resolveDueDigestSlot,
  resolveReportsChannelId,
  type ReportSettings,
} from "./settings";
import { getPreviousSnapshot, getSnapshotBySlot, saveSnapshot, type SnapshotMetrics } from "./snapshots";
import { assertReportsChannel } from "./channelGuard";

function mPrev(m: MetricDelta | null | undefined): number | null {
  if (!m || m.prev == null || !Number.isFinite(m.prev)) return null;
  return m.prev;
}

/** Previous IST calendar day as YYYY-MM-DD. */
function previousIstYmd(ymd: string): string {
  return istYMD(new Date(istYMDToMs(ymd) - 1)) || ymd;
}

type ModeBucket = "online" | "offline";
type TimingBucket = "morning" | "evening";

function modeFromModes(modes: LearningMode[] | string[]): ModeBucket | null {
  const set = new Set<ModeBucket>();
  for (const m of modes) {
    const s = String(m);
    if (/offline/i.test(s)) set.add("offline");
    else if (/online|recorded|hybrid/i.test(s)) set.add("online");
  }
  if (set.size === 1) return [...set][0]!;
  return null;
}

function timingFromList(timings: string[]): TimingBucket | null {
  const set = new Set<TimingBucket>();
  for (const t of timings) {
    if (/morning/i.test(t)) set.add("morning");
    if (/evening/i.test(t)) set.add("evening");
  }
  if (set.size === 1) return [...set][0]!;
  return null;
}

function timingFromLabel(label: string): TimingBucket | null {
  const hasM = /\bmorning\b/i.test(label);
  const hasE = /\bevening\b/i.test(label);
  if (hasM && !hasE) return "morning";
  if (hasE && !hasM) return "evening";
  return null;
}

function modeFromLabel(label: string): ModeBucket | null {
  const hasOff = /\boffline\b/i.test(label);
  const hasOn = /\bonline\b|\brecorded\b|\bhybrid\b/i.test(label);
  if (hasOff && !hasOn) return "offline";
  if (hasOn && !hasOff) return "online";
  return null;
}

/** Price anchors on a batch used to match enrollments with missing batch_id. */
function batchPriceAnchors(b: CourseBatch): number[] {
  return [b.price, b.pay_in_full_price, b.original_price]
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * Resolve the catalog batch for an enrollment.
 * Prefer batch_id; else match timing (from label) + closest fee to batch price.
 */
function resolveEnrollmentBatch(
  course: Course,
  e: CourseEnrollment,
): CourseBatch | null {
  const batches = course.batches || [];
  if (!batches.length) return null;
  if (e.batch_id) {
    const hit = batches.find((b) => b.id === e.batch_id);
    if (hit) return hit;
  }

  const timing = timingFromLabel(e.batch_label || "");
  const fee = Number(e.total_fee) || 0;
  let best: { batch: CourseBatch; dist: number } | null = null;

  for (const b of batches) {
    const bTiming = timingFromList(batchTimings(b));
    if (timing && bTiming && timing !== bTiming) continue;
    if (timing && !bTiming && !timingFromLabel(b.label || "")) continue;

    const anchors = batchPriceAnchors(b);
    if (!anchors.length || fee <= 0) continue;
    const dist = Math.min(...anchors.map((p) => Math.abs(p - fee)));
    if (!best || dist < best.dist) best = { batch: b, dist };
  }

  // Accept only a clear fee match (within ₹15k of a listed price).
  if (best && best.dist <= 15_000) return best.batch;
  return null;
}

/**
 * ONE mode per enrollment — never double-count.
 * Order: linked/matched batch → label → fee-vs-batch-prices → single course.modes.
 */
function classifyMode(
  course: Course,
  batch: CourseBatch | null,
  e: CourseEnrollment,
): ModeBucket | null {
  if (batch) {
    const fromBatch = modeFromModes(batchModes(batch));
    if (fromBatch) return fromBatch;
  }
  const fromLabel = modeFromLabel(e.batch_label || "");
  if (fromLabel) return fromLabel;

  // Fee proximity to Online vs Offline batch prices on this course.
  const fee = Number(e.total_fee) || 0;
  if (fee > 0 && course.batches?.length) {
    let bestOn = Infinity;
    let bestOff = Infinity;
    for (const b of course.batches) {
      const m = modeFromModes(batchModes(b));
      if (!m) continue;
      for (const p of batchPriceAnchors(b)) {
        const d = Math.abs(p - fee);
        if (m === "online") bestOn = Math.min(bestOn, d);
        if (m === "offline") bestOff = Math.min(bestOff, d);
      }
    }
    if (bestOn < bestOff && bestOn <= 15_000) return "online";
    if (bestOff < bestOn && bestOff <= 15_000) return "offline";
  }

  // Course catalog has a single exclusive mode → safe default for unlabeled rows.
  return modeFromModes(course.modes || []);
}

/** ONE timing per enrollment — never fall back to course.batch_timings catalog. */
function classifyTiming(batch: CourseBatch | null, batchLabel: string): TimingBucket | null {
  if (batch) {
    const fromBatch = timingFromList(batchTimings(batch));
    if (fromBatch) return fromBatch;
  }
  return timingFromLabel(batchLabel);
}

interface CourseBlock {
  title: string;
  total: number;
  capacity: number | null;
  online: number;
  offline: number;
  morning: number;
  evening: number;
  fullPaid: number;
  partial: number;
  unpaid: number;
  modeOk: boolean;
  timingOk: boolean;
  timingEmpty: boolean;
  modeEmpty: boolean;
}

function courseBreakdown(
  courses: Awaited<ReturnType<typeof getAllCourses>>,
  enrollments: Awaited<ReturnType<typeof getAllCourseEnrollments>>,
): CourseBlock[] {
  const enabled = courses.filter((c) => c.status === "published" && c.active !== false);
  const out: CourseBlock[] = [];
  const now = Date.now();

  for (const course of enabled) {
    const seen = new Set<string>();
    const enrs = enrollments.filter((e) => {
      if (e.course_id !== course.id || !isActiveEnrollment(e) || !countsTowardCapacity(e)) return false;
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
    if (!enrs.length && (course.capacity == null || course.capacity <= 0)) continue;

    let online = 0,
      offline = 0,
      morning = 0,
      evening = 0,
      fullPaid = 0,
      partial = 0,
      unpaid = 0;

    let capacity: number | null = null;
    if (course.batches?.length) {
      let sum = 0;
      let any = false;
      for (const b of course.batches) {
        if (b.capacity != null && Number.isFinite(b.capacity) && b.capacity > 0) {
          sum += b.capacity;
          any = true;
        }
      }
      capacity = any ? sum : course.capacity ?? null;
    } else {
      capacity = course.capacity ?? null;
    }

    for (const e of enrs) {
      const batch = resolveEnrollmentBatch(course, e);
      const mode = classifyMode(course, batch, e);
      if (mode === "online") online++;
      else if (mode === "offline") offline++;

      const timing = classifyTiming(batch, e.batch_label || "");
      if (timing === "morning") morning++;
      else if (timing === "evening") evening++;

      const der = deriveEnrollment(e, now);
      if (der.isFullyPaid) fullPaid++;
      else if ((e.amount_paid || 0) > 0 || der.paid > 0) partial++;
      else unpaid++;
    }

    const total = enrs.length;
    const modeSum = online + offline;
    const timingSum = morning + evening;
    const modeEmpty = modeSum === 0;
    const timingEmpty = timingSum === 0;
    const modeOk = !modeEmpty && modeSum === total;
    const timingOk = !timingEmpty && timingSum === total;

    if (!modeOk && !modeEmpty) {
      tgLog(
        "digest_admissions_mode_invariant",
        { course: course.title, total, online, offline },
        "error",
      );
    }
    if (!timingOk && !timingEmpty) {
      tgLog(
        "digest_admissions_timing_invariant",
        { course: course.title, total, morning, evening },
        "error",
      );
    }

    out.push({
      title: course.title,
      total,
      capacity,
      online,
      offline,
      morning,
      evening,
      fullPaid,
      partial,
      unpaid,
      modeOk,
      timingOk,
      timingEmpty,
      modeEmpty,
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

function collectionsStats(enrollments: Awaited<ReturnType<typeof getAllCourseEnrollments>>) {
  const now = Date.now();
  const weekMs = 7 * 86400_000;
  let overdueCount = 0;
  let overdueAmount = 0;
  let due7dAmount = 0;

  for (const e of enrollments) {
    if (!isActiveEnrollment(e) || e.status === "cancelled" || e.status === "transferred_out") continue;
    const col = deriveCollections(e, now);
    if (col.overdueAmount > 0) {
      overdueCount++;
      overdueAmount += col.overdueAmount;
    }
    if (col.nextDueDate && col.nextDueAmount > 0) {
      const due = new Date(col.nextDueDate).getTime();
      if (Number.isFinite(due) && due >= now && due <= now + weekMs) {
        due7dAmount += col.nextDueAmount;
      }
    }
  }
  return { overdueCount, overdueAmount, due7dAmount };
}

async function pickUpcomingWebinar(payments: Payment[]): Promise<{
  title: string;
  dateLabel: string;
  registered: number;
  newToday: number | null;
  pendingCheckout: number;
  attendedLastPct: number | null;
  sources: { label: string; count: number }[] | null;
  webinarId: string;
  slug: string;
} | null> {
  try {
    // Payments already loaded by buildDigest — avoid a second full payments scan.
    // Skip registration-table scan (attendance %) so preview/send stay snappy.
    const webinars = await getWebinars();
    const now = Date.now();
    const upcoming = [...webinars]
      .filter((w) => w.datetime && new Date(w.datetime).getTime() >= now - 6 * 3600_000)
      .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())[0];
    if (!upcoming) return null;

    const price = Number(upcoming.price) || 0;
    const todayYmd = istTodayYMD();
    let registered = 0;
    let newToday: number | null = null;
    let sources: { label: string; count: number }[] | null = null;
    if (price > 0) {
      const report = webinarRegistrationReport(payments, upcoming.slug, todayYmd);
      registered = report.paidTotal || paidWebinarRegistrationCount(payments, upcoming.slug);
      newToday = report.paidToday;
      sources = report.hasAttribution ? report.sources : null;
    } else {
      const { getAllWebinarRegistrations } = await import("../../dataProvider");
      const regs = await getAllWebinarRegistrations();
      registered = regs.filter((r) => r.webinar_id === upcoming.id).length;
    }
    const pendingCheckout =
      price > 0 ? pendingWebinarCheckoutCount(payments, upcoming.slug) : 0;

    return {
      title: upcoming.title,
      dateLabel: formatIstEvent(upcoming.datetime),
      registered,
      newToday,
      pendingCheckout,
      attendedLastPct: null,
      sources,
      webinarId: upcoming.id,
      slug: upcoming.slug,
    };
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(fallback);
      }
    }, ms);
    promise.then(
      (v) => {
        if (!done) {
          done = true;
          clearTimeout(t);
          resolve(v);
        }
      },
      () => {
        if (!done) {
          done = true;
          clearTimeout(t);
          resolve(fallback);
        }
      },
    );
  });
}

function paymentKindLabel(p: Payment): string {
  if (p.item_type === "webinar") return "Webinar registration";
  const kind = String(p.payment_kind || "");
  if (kind === "seat") return "Course seat booking";
  if (kind === "installment") {
    return p.installment_no != null
      ? `Course installment #${p.installment_no}`
      : "Course installment";
  }
  if (kind === "full" || kind === "one_time") return "Course full payment";
  return p.item_type === "course" ? "Course payment" : "Payment";
}

/** Full item title — never truncate in the failed-payments block. */
function fullItemName(p: Payment): string {
  return String(p.item || p.item_slug || "Item").trim();
}

/** True if this phone later has a PAID row for the same item (slug/type). */
function laterPaidSameItem(failed: Payment, all: Payment[]): boolean {
  const phone = (failed.phone || "").replace(/\D/g, "").slice(-10);
  if (!phone) return false;
  const failedAt = new Date(failed.created_at).getTime();
  const slug = (failed.item_slug || "").toLowerCase();
  return all.some((p) => {
    if (p.deleted_at || !isPaidStatus(p.status)) return false;
    if ((p.phone || "").replace(/\D/g, "").slice(-10) !== phone) return false;
    if (p.item_type !== failed.item_type) return false;
    const pSlug = (p.item_slug || "").toLowerCase();
    if (slug && pSlug && slug !== pSlug) return false;
    if (!slug && (p.item || "") !== (failed.item || "")) return false;
    const t = new Date(p.created_at).getTime();
    return Number.isFinite(t) && t > failedAt;
  });
}

function failureReasonShort(p: Payment): string | null {
  const raw =
    (p.verify_status && String(p.verify_status).trim()) ||
    (p.response_code && String(p.response_code).trim()) ||
    null;
  if (!raw || /^(success|ok|00|0)$/i.test(raw)) return null;
  return raw;
}

export interface DigestBuildResult {
  html: string;
  parts: string[];
  metrics: SnapshotMetrics;
  isMorningSummary: boolean;
  silent: boolean;
}

export async function buildDigest(opts?: {
  forceMorningExtras?: boolean;
  previous?: SnapshotMetrics | null;
}): Promise<DigestBuildResult> {
  const parts = istNowParts();
  // Yesterday close / 7-day trend only at real 6 AM IST — not on manual force sends.
  const isMorningSummary = parts.hour === 6;
  void opts?.forceMorningExtras;

  let pulseToday: Awaited<ReturnType<typeof getExecutivePulse>> | null = null;
  let pulseMtd: Awaited<ReturnType<typeof getExecutivePulse>> | null = null;
  let courses: Awaited<ReturnType<typeof getAllCourses>> = [];
  let enrollments: Awaited<ReturnType<typeof getAllCourseEnrollments>> = [];
  let webinar: Awaited<ReturnType<typeof pickUpcomingWebinar>> = null;
  let failedRows: Payment[] = [];
  let allPayments: Payment[] = [];
  let paymentsOk = false;
  let enrollmentsOk = false;
  let loginAvg: number | null = null;
  let loginAvg30: number | null = null;
  let loginAvg90: number | null = null;
  let loginsToday: number | null = null;
  let loginsYday: number | null = null;

  const prev = opts?.previous || null;
  const emptyLogins = {
    allTimeAvg: null as number | null,
    rolling30Avg: null as number | null,
    rolling90Avg: null as number | null,
    today: null as number | null,
    yesterday: null as number | null,
    activeDays: 0,
    uniqueSum: 0,
    firstActiveYmd: null as string | null,
    method: "tracked_days" as const,
  };
  void prev;

  try {
    // One payments fetch shared by failed-today + upcoming webinar (was double-scanned).
    const paymentsPromise = getPayments();
    const settled = await Promise.allSettled([
      withTimeout(getExecutivePulse({ preset: "today", canRevenue: true }), 12_000, null),
      withTimeout(getExecutivePulse({ preset: "this_month", canRevenue: true }), 12_000, null),
      getAllCourses(),
      getAllCourseEnrollments(),
      paymentsPromise,
      withTimeout(resolveLoginAverages(), 60_000, emptyLogins),
    ]);
    if (settled[0].status === "fulfilled") pulseToday = settled[0].value;
    if (settled[1].status === "fulfilled") pulseMtd = settled[1].value;
    if (settled[2].status === "fulfilled") courses = settled[2].value;
    if (settled[3].status === "fulfilled") {
      enrollments = settled[3].value;
      enrollmentsOk = true;
    }
    if (settled[4].status === "fulfilled") {
      paymentsOk = true;
      allPayments = settled[4].value;
      const today = istTodayYMD();
      failedRows = allPayments
        .filter(
          (p) =>
            !p.deleted_at &&
            String(p.status || "").toUpperCase() === "FAILED" &&
            istYMD(p.created_at) === today,
        )
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      webinar = await pickUpcomingWebinar(allPayments);
    }
    if (settled[5].status === "fulfilled") {
      loginAvg = settled[5].value.allTimeAvg;
      loginAvg30 = settled[5].value.rolling30Avg;
      loginAvg90 = settled[5].value.rolling90Avg;
      loginsToday = settled[5].value.today;
      loginsYday = settled[5].value.yesterday;
    }
  } catch {
    /* sections omit missing data */
  }

  const failedToday = failedRows.length;
  const courseBlocks = courseBreakdown(courses, enrollments);
  const collections = collectionsStats(enrollments);

  let todayMoney: CollectionMetrics | null = null;
  let ydayMoney: CollectionMetrics | null = null;
  let mtdMoney: CollectionMetrics | null = null;
  let weekMoney: CollectionMetrics | null = null;
  const todayYmd = istTodayYMD();
  const ydayYmd = previousIstYmd(todayYmd);

  let people: Awaited<ReturnType<typeof loadPeopleMetrics>> | null = null;
  let todayAdmissions: ReturnType<typeof computeAdmissions> | null = null;
  let sms: SmsDeliveryMetrics | null = null;
  if (paymentsOk || enrollmentsOk) {
    try {
      const exclusions = await withTimeout(
        loadReportExclusions(),
        4_000,
        { staffPhones: new Set<string>(), leadPhones: new Set<string>() },
      );
      const [peopleLoaded, smsLoaded] = await Promise.all([
        withTimeout(loadPeopleMetrics(istDayWindow(todayYmd), exclusions), 8_000, null),
        withTimeout(loadSmsDelivery(istDayWindow(todayYmd), exclusions.staffPhones), 8_000, null),
      ]);
      people = peopleLoaded;
      sms = smsLoaded;
      if (paymentsOk) {
        const staff = exclusions.staffPhones;
        todayMoney = computeCollections(allPayments, istDayWindow(todayYmd), staff);
        ydayMoney = computeCollections(allPayments, istDayWindow(ydayYmd), staff);
        mtdMoney = computeCollections(allPayments, istMonthToDateWindow(todayYmd), staff);
        if (isMorningSummary) {
          weekMoney = computeCollections(
            allPayments,
            { fromMs: istYMDToMs(todayYmd) - 6 * DAY_MS, toMs: istDayWindow(todayYmd).toMs },
            staff,
          );
        }
      }
      if (enrollmentsOk) {
        todayAdmissions = computeAdmissions(enrollments, istDayWindow(todayYmd), exclusions.staffPhones);
      }
    } catch {
      people = null;
    }
  }

  if (people?.uniqueLoginUsers != null && loginsToday != null && people.uniqueLoginUsers !== loginsToday) {
    tgLog(
      "login_trend_mismatch",
      { unique: people.uniqueLoginUsers, trend: loginsToday },
      "warn",
    );
  }

  const metrics: SnapshotMetrics = {
    logins_today: people?.uniqueLoginUsers ?? loginsToday,
    logins_yday: loginsYday,
    logins_avg: loginAvg,
    logins_avg_30d: loginAvg30,
    logins_avg_90d: loginAvg90,
    revenue_today: todayMoney?.netCollection ?? null,
    revenue_mtd: mtdMoney?.netCollection ?? null,
    revenue_yday: ydayMoney?.netCollection ?? null,
    overdue_count: collections.overdueCount,
    overdue_amount: collections.overdueAmount,
    due_7d_amount: collections.due7dAmount,
    webinar_registered: webinar?.registered ?? null,
    webinar_id: webinar?.webinarId ?? null,
    failed_today: failedToday,
  };
  for (const c of courseBlocks) {
    metrics[`course:${c.title}:total`] = c.total;
  }
  void pulseMtd;

  const coursesForBrief: CourseBrief[] = courseBlocks.map((c) => ({ ...c }));
  for (const c of coursesForBrief) {
    if (!c.modeOk && !c.modeEmpty) {
      tgLog("digest_admissions_mode_render_fail", { course: c.title, online: c.online, offline: c.offline, total: c.total }, "error");
    }
  }

  const failed: FailedBrief[] = failedRows.map((p) => ({
    name: p.student_name || "Student",
    amount: p.amount,
    item: `${paymentKindLabel(p)} — ${fullItemName(p)}`,
    when: formatIstClock(p.created_at),
    reason: failureReasonShort(p),
    recovered: laterPaidSameItem(p, allPayments),
  }));

  let morningNote: string | null = null;
  if (isMorningSummary && pulseToday) {
    const bits: string[] = [];
    const yLeads = mPrev(pulseToday.pulse.leadsToday);
    const yAdm = mPrev(pulseToday.pulse.seatBookingsToday);
    if (yLeads != null) bits.push(`Leads ${yLeads}`);
    if (yAdm != null) bits.push(`Admissions ${yAdm}`);
    const leadSum = pulseToday.history.leads.slice(-7).reduce((s, p) => s + (p.value || 0), 0);
    const seatSum = pulseToday.history.seatBookings.slice(-7).reduce((s, p) => s + (p.value || 0), 0);
    const collectedSum = weekMoney?.netCollection ?? null;
    const linesNote = [
      bits.length ? `Yesterday close  ${bits.join(" · ")}` : "",
      leadSum || seatSum || collectedSum
        ? `7-day trend  Leads ${leadSum} · Admissions ${seatSum} · Collected ${inrExact(collectedSum)}`
        : "",
    ].filter(Boolean);
    morningNote = linesNote.join("\n") || null;
  }

  const stamp = istBriefStamp();
  const lines = executiveBriefLines({
    dateLabel: stamp.dateLabel,
    timeLabel: stamp.timeLabel,
    people,
    login: {
      todayFallback: people?.uniqueLoginUsers == null ? loginsToday : null,
      yesterday: loginsYday,
      avg30: loginAvg30,
      avg90: loginAvg90,
    },
    today: todayMoney,
    yesterday: ydayMoney,
    mtd: mtdMoney,
    todayAdmissions,
    sms,
    webinar: webinar
      ? {
          title: webinar.title,
          dateLabel: webinar.dateLabel,
          registered: webinar.registered,
          newToday: webinar.newToday,
          pendingCheckout: webinar.pendingCheckout,
          attendedLastPct: webinar.attendedLastPct,
          sources: webinar.sources,
        }
      : null,
    courses: coursesForBrief,
    outstanding: {
      overdueCount: collections.overdueCount,
      overdueAmount: collections.overdueAmount,
      due7dAmount: collections.due7dAmount,
    },
    failed,
    morningNote,
  });

  return {
    html: lines.join("\n"),
    parts: packTelegramMessages(lines),
    metrics,
    isMorningSummary,
    silent: !isMorningSummary,
  };
}

async function sendWithRetry(
  chatId: string,
  text: string,
  opts: { silent: boolean; buttons?: { label: string; url: string }[] },
): Promise<{ ok: boolean; error?: string; messageId?: number }> {
  const markup = buildKeyboard((opts.buttons || []).map((b) => ({ label: b.label, url: b.url })));
  let lastErr = "send_failed";
  for (let i = 0; i < 3; i++) {
    const res = await sendMessage({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      disable_notification: opts.silent,
      reply_markup: markup,
    });
    if (res.ok) return { ok: true, messageId: res.result?.message_id };
    lastErr = res.description || `error_${res.error_code || "unknown"}`;
    tgLog("report_send_retry", { attempt: i + 1, error: lastErr }, "warn");
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  return { ok: false, error: lastErr };
}

export async function sendDigestNow(opts?: {
  force?: boolean;
  slotKey?: string;
  skipIdempotency?: boolean;
  morningExtras?: boolean;
  /** When set (admin manual send), post this exact HTML instead of rebuilding. */
  html?: string;
}): Promise<{
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  html?: string;
  messageId?: number;
  channelMasked?: string | null;
  getChatError?: string;
}> {
  const settings = await getReportSettings();
  if (!settings.digest_enabled && !opts?.force) {
    return { ok: false, skipped: true, reason: "digest_disabled" };
  }

  const parts = istNowParts();
  const slotKey = opts?.slotKey || parts.slotKey;

  if (!opts?.skipIdempotency) {
    const existing = await getSnapshotBySlot(slotKey);
    if (existing) {
      return { ok: true, skipped: true, reason: "already_sent", html: existing.message_html || undefined };
    }
  }

  const resolved = resolveReportsChannelId(settings);
  const guarded = await assertReportsChannel(resolved);
  if (!guarded.ok || !guarded.id) {
    const reason = guarded.error || "channel_not_configured";
    if (!opts?.skipIdempotency) await markDigestResult(false, reason);
    return {
      ok: false,
      reason,
      getChatError: reason,
      channelMasked: maskChannelId(resolved),
    };
  }
  const channel = guarded.id;

  if (!opts?.force && inQuietHours(settings, parts.hour)) {
    return { ok: false, skipped: true, reason: "quiet_hours", channelMasked: maskChannelId(channel) };
  }

  let built: DigestBuildResult;
  const overrideHtml = typeof opts?.html === "string" ? opts.html.trim() : "";
  if (overrideHtml) {
    if (overrideHtml.length > 60_000) {
      return { ok: false, reason: "html_too_large", channelMasked: maskChannelId(channel) };
    }
    built = {
      html: overrideHtml,
      parts: [overrideHtml],
      metrics: {},
      isMorningSummary: false,
      silent: false,
    };
  } else {
    const prev = await getPreviousSnapshot();
    try {
      built = await buildDigest({
        previous: prev?.metrics || null,
        forceMorningExtras: opts?.morningExtras === true,
      });
    } catch (e) {
      const msg = (e as Error).message || "build_failed";
      if (!opts?.skipIdempotency) await markDigestResult(false, msg);
      return { ok: false, reason: msg, channelMasked: maskChannelId(channel) };
    }
  }

  const base = SITE_URL.replace(/\/$/, "") || "https://www.namanias.com";
  const silent = built.isMorningSummary ? false : built.silent;
  const messages = built.parts?.length ? built.parts : [built.html];
  const messageIds: number[] = [];
  let sendError: string | undefined;
  for (let i = 0; i < messages.length; i++) {
    const sent = await sendWithRetry(channel, messages[i], {
      silent: opts?.html ? false : silent,
      buttons:
        i === 0
          ? [
              { label: "Dashboard", url: `${base}/admin` },
              { label: "Outstanding fees", url: `${base}/admin/at-risk` },
              { label: "Admissions", url: `${base}/admin/course-payments` },
            ]
          : [],
    });
    if (!sent.ok) {
      sendError = sent.error || "send_failed";
      break;
    }
    if (sent.messageId != null) messageIds.push(sent.messageId);
  }

  if (sendError || !messageIds.length) {
    if (!opts?.skipIdempotency) await markDigestResult(false, sendError || "send_failed");
    return {
      ok: false,
      reason: sendError || "send_failed",
      html: built.html,
      messageId: messageIds[0],
      channelMasked: maskChannelId(channel),
    };
  }

  const manual = opts?.skipIdempotency === true;
  await saveSnapshot({
    slotKey: digestSnapshotSlot(slotKey, manual, Date.now()),
    kind: built.isMorningSummary ? "daily_summary" : "digest",
    metrics: {
      ...built.metrics,
      message_id: messageIds[0] ?? null,
      message_id_2: messageIds[1] ?? null,
    },
    messageHtml: built.html,
  });
  if (!manual) await markDigestResult(true);
  await ensureReportingReference(channel);
  return {
    ok: true,
    html: built.html,
    messageId: messageIds[0],
    channelMasked: maskChannelId(channel),
  };
}

/**
 * Build the live CEO digest HTML without sending — for admin preview.
 * Does not write snapshots or touch last_digest_at.
 */
export async function previewDigestNow(opts?: {
  morningExtras?: boolean;
}): Promise<{
  ok: boolean;
  html?: string;
  reason?: string;
  channelMasked?: string | null;
  channelTitle?: string | null;
  channelId?: string | null;
  isMorningSummary?: boolean;
  digestEnabled?: boolean;
  lastDigestAt?: string | null;
}> {
  const settings = await getReportSettings();
  const resolved = resolveReportsChannelId(settings);
  const guarded = await assertReportsChannel(resolved);
  if (!guarded.ok || !guarded.id) {
    return {
      ok: false,
      reason: guarded.error || "channel_not_configured",
      channelMasked: maskChannelId(resolved),
      digestEnabled: settings.digest_enabled,
      lastDigestAt: settings.last_digest_at,
    };
  }

  try {
    const prev = await getPreviousSnapshot();
    const built = await buildDigest({
      previous: prev?.metrics || null,
      forceMorningExtras: opts?.morningExtras === true,
    });
    return {
      ok: true,
      html: built.html,
      channelMasked: maskChannelId(guarded.id),
      channelTitle: guarded.title,
      channelId: guarded.id,
      isMorningSummary: built.isMorningSummary,
      digestEnabled: settings.digest_enabled,
      lastDigestAt: settings.last_digest_at,
    };
  } catch (e) {
    return {
      ok: false,
      reason: (e as Error).message || "build_failed",
      channelMasked: maskChannelId(guarded.id),
      channelTitle: guarded.title,
      channelId: guarded.id,
      digestEnabled: settings.digest_enabled,
      lastDigestAt: settings.last_digest_at,
    };
  }
}

export async function maybeRunScheduledDigest(): Promise<{
  ok: boolean;
  ran: boolean;
  reason?: string;
  html?: string;
  messageId?: number;
  slotKey?: string;
}> {
  const settings = await getReportSettings();
  if (!settings.digest_enabled) return { ok: true, ran: false, reason: "digest_disabled" };

  const due = resolveDueDigestSlot(settings.digest_frequency);
  if (!due) return { ok: true, ran: false, reason: "no_slot" };

  if (inQuietHours(settings, due.hour) && due.hour !== 6) {
    return { ok: true, ran: false, reason: "quiet_hours", slotKey: due.slotKey };
  }

  const result = await sendDigestNow({ slotKey: due.slotKey });
  return {
    ok: result.ok || !!result.skipped,
    ran: result.ok && !result.skipped,
    reason: result.reason,
    html: result.html,
    messageId: result.messageId,
    slotKey: due.slotKey,
  };
}

export async function shouldSendDigestForSettings(settings: ReportSettings): Promise<boolean> {
  if (!settings.digest_enabled) return false;
  return resolveDueDigestSlot(settings.digest_frequency) != null;
}
