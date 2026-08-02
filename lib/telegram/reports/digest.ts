/**
 * Build + send Telegram CEO digests.
 * Metrics reuse getExecutivePulse where possible — no alternate revenue definitions.
 */
import { SITE_URL } from "../../config";
import { getExecutivePulse, type MetricDelta } from "../../analytics/executiveOverview";
import {
  getAllCourseEnrollments,
  getAllCourses,
  getAllWebinarRegistrations,
  getPayments,
  getWebinars,
} from "../../dataProvider";
import { istYMD, istTodayYMD } from "../../dates";
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
} from "../../webinarReg";
import type { Course, CourseBatch, CourseEnrollment, LearningMode, Payment } from "../../types";
import { normalizeIndianMobile } from "../../phone";
import { buildKeyboard, sendMessage } from "../botApi";
import { tgLog } from "../log";
import { escapeHtml, formatIstShort, inr, istNowParts } from "./format";
import { resolveLoginAverages } from "./loginAvg";
import {
  digestHoursForFrequency,
  getReportSettings,
  inQuietHours,
  markDigestResult,
  maskChannelId,
  resolveReportsChannelId,
  type ReportSettings,
} from "./settings";
import { getPreviousSnapshot, getSnapshotBySlot, saveSnapshot, type SnapshotMetrics } from "./snapshots";
import { assertReportsChannel } from "./channelGuard";

function mVal(m: MetricDelta | null | undefined): number | null {
  if (!m || m.value == null || !Number.isFinite(m.value)) return null;
  return m.value;
}
function mPrev(m: MetricDelta | null | undefined): number | null {
  if (!m || m.prev == null || !Number.isFinite(m.prev)) return null;
  return m.prev;
}

/**
 * Meaningful period delta only when there is a real non-zero base.
 * Suppresses zero-vs-zero and 0→N “100%” noise.
 */
function meaningfulDeltaPct(curr: number | null, prev: number | null): number | null {
  if (curr == null || prev == null) return null;
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return null;
  if (prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function deltaLabel(curr: number | null, prev: number | null): string | null {
  const pct = meaningfulDeltaPct(curr, prev);
  if (pct == null) return null;
  const abs = Math.abs(Math.round(pct));
  if (abs === 0) return null;
  return pct > 0 ? `▲ ${abs}%` : `▼ ${abs}%`;
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

async function pickUpcomingWebinar(): Promise<{
  title: string;
  dateLabel: string;
  registered: number;
  pendingCheckout: number;
  attendedLastPct: number | null;
  webinarId: string;
  slug: string;
} | null> {
  try {
    const [webinars, regs, payments] = await Promise.all([
      getWebinars(),
      getAllWebinarRegistrations(),
      getPayments(),
    ]);
    const now = Date.now();
    const upcoming = [...webinars]
      .filter((w) => w.datetime && new Date(w.datetime).getTime() >= now - 6 * 3600_000)
      .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())[0];
    if (!upcoming) return null;

    const price = Number(upcoming.price) || 0;
    // Paid webinars: paid-only seat count. Free webinars: registration rows (= confirmed).
    const registered =
      price > 0
        ? paidWebinarRegistrationCount(payments, upcoming.slug)
        : regs.filter((r) => r.webinar_id === upcoming.id).length;
    const pendingCheckout =
      price > 0 ? pendingWebinarCheckoutCount(payments, upcoming.slug) : 0;

    let attendedLastPct: number | null = null;
    const past = [...webinars]
      .filter((w) => w.datetime && new Date(w.datetime).getTime() < now && w.id !== upcoming.id)
      .sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime())[0];
    if (past) {
      const pastRegs = regs.filter((r) => r.webinar_id === past.id);
      const attended = pastRegs.filter((r) => r.attended === true).length;
      if (pastRegs.length > 0 && attended > 0) {
        attendedLastPct = Math.round((attended / pastRegs.length) * 100);
      }
    }

    return {
      title: upcoming.title,
      dateLabel: formatIstShort(upcoming.datetime),
      registered,
      pendingCheckout,
      attendedLastPct,
      webinarId: upcoming.id,
      slug: upcoming.slug,
    };
  } catch {
    return null;
  }
}

function displayPhone(raw: string | null | undefined): string {
  const n = normalizeIndianMobile(raw);
  if (n.ok && n.display) return n.display;
  return String(raw || "").trim() || "—";
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

function pushSection(lines: string[], header: string, body: string[]): void {
  if (!body.length) return;
  if (lines.length && lines[lines.length - 1] !== "") lines.push("");
  lines.push(header);
  for (const row of body) lines.push(row);
}

export interface DigestBuildResult {
  html: string;
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

  let pulseToday: Awaited<ReturnType<typeof getExecutivePulse>> | null = null;
  let pulseMtd: Awaited<ReturnType<typeof getExecutivePulse>> | null = null;
  let courses: Awaited<ReturnType<typeof getAllCourses>> = [];
  let enrollments: Awaited<ReturnType<typeof getAllCourseEnrollments>> = [];
  let webinar: Awaited<ReturnType<typeof pickUpcomingWebinar>> = null;
  let failedRows: Payment[] = [];
  let allPayments: Payment[] = [];
  let loginAvg: number | null = null;
  let loginAvg30: number | null = null;
  let loginsToday: number | null = null;
  let loginsYday: number | null = null;

  try {
    const settled = await Promise.allSettled([
      getExecutivePulse({ preset: "today", canRevenue: true }),
      getExecutivePulse({ preset: "this_month", canRevenue: true }),
      getAllCourses(),
      getAllCourseEnrollments(),
      pickUpcomingWebinar(),
      getPayments(),
      resolveLoginAverages(),
    ]);
    if (settled[0].status === "fulfilled") pulseToday = settled[0].value;
    if (settled[1].status === "fulfilled") pulseMtd = settled[1].value;
    if (settled[2].status === "fulfilled") courses = settled[2].value;
    if (settled[3].status === "fulfilled") enrollments = settled[3].value;
    if (settled[4].status === "fulfilled") webinar = settled[4].value;
    if (settled[5].status === "fulfilled") {
      allPayments = settled[5].value;
      const today = istTodayYMD();
      failedRows = allPayments
        .filter(
          (p) =>
            !p.deleted_at &&
            String(p.status || "").toUpperCase() === "FAILED" &&
            istYMD(p.created_at) === today,
        )
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    if (settled[6].status === "fulfilled") {
      loginAvg = settled[6].value.allTimeAvg;
      loginAvg30 = settled[6].value.rolling30Avg;
      loginsToday = settled[6].value.today;
      loginsYday = settled[6].value.yesterday;
    }
  } catch {
    /* sections omit missing data */
  }

  const failedToday = failedRows.length;
  void opts?.previous;
  const courseBlocks = courseBreakdown(courses, enrollments);
  const collections = collectionsStats(enrollments);

  const revenueToday = pulseToday
    ? (mVal(pulseToday.pulse.courseRevenue) || 0) + (mVal(pulseToday.pulse.webinarRevenue) || 0)
    : null;
  const revenueMtd = pulseMtd
    ? (mVal(pulseMtd.pulse.courseRevenue) || 0) + (mVal(pulseMtd.pulse.webinarRevenue) || 0)
    : null;
  const revenueYday = pulseToday
    ? (mPrev(pulseToday.pulse.courseRevenue) || 0) + (mPrev(pulseToday.pulse.webinarRevenue) || 0)
    : null;

  const metrics: SnapshotMetrics = {
    logins_today: loginsToday,
    logins_yday: loginsYday,
    logins_avg: loginAvg,
    logins_avg_30d: loginAvg30,
    revenue_today: revenueToday,
    revenue_mtd: revenueMtd,
    revenue_yday: revenueYday,
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

  const lines: string[] = [];
  const headerLabel = parts.label.replace(/\b(am|pm)\b/i, (m) => m.toUpperCase());
  lines.push(`📊 <b><u>NAMAN IAS</u> · ${escapeHtml(headerLabel)}</b>`);
  lines.push("");

  // ── WEBINAR ──
  if (webinar && (webinar.registered > 0 || webinar.pendingCheckout > 0)) {
    const body: string[] = [
      `<b>${escapeHtml(webinar.title)}</b>`,
      webinar.dateLabel ? `<i>${escapeHtml(webinar.dateLabel)}</i>` : "",
      `Registered <b>${webinar.registered}</b> (paid)`,
    ].filter(Boolean);
    if (webinar.pendingCheckout > 0) {
      body.push(`Pending checkout <b>${webinar.pendingCheckout}</b>`);
    }
    if (webinar.attendedLastPct != null) {
      body.push(`Last attendance <b>${webinar.attendedLastPct}%</b>`);
    }
    pushSection(lines, `📣 <b>WEBINAR</b>`, body);
  }

  // ── ADMISSIONS (per course) ──
  for (const c of courseBlocks.filter((x) => x.total > 0).slice(0, 3)) {
    const body: string[] = [];
    const seats =
      c.capacity != null && c.capacity > 0
        ? `Total <b>${c.total}</b> · Seats <b>${c.total}/${c.capacity}</b>`
        : `Total <b>${c.total}</b>`;
    body.push(seats);

    if (c.modeOk) {
      body.push(`Online <b>${c.online}</b> · Offline <b>${c.offline}</b>`);
    } else if (!c.modeEmpty) {
      tgLog("digest_admissions_mode_render_fail", { course: c.title, online: c.online, offline: c.offline, total: c.total }, "error");
      // Still show counted numbers when partial — never a fake ⚠ placeholder that hides real splits.
      body.push(`Online <b>${c.online}</b> · Offline <b>${c.offline}</b> · Unmapped <b>${c.total - c.online - c.offline}</b>`);
    }

    if (c.timingOk) {
      body.push(`Morning <b>${c.morning}</b> · Evening <b>${c.evening}</b>`);
    } else if (!c.timingEmpty) {
      body.push(
        `Morning <b>${c.morning}</b> · Evening <b>${c.evening}</b> · Unmapped <b>${c.total - c.morning - c.evening}</b>`,
      );
    }

    const payBits = [
      `Full paid <b>${c.fullPaid}</b>`,
      `Partial <b>${c.partial}</b>`,
      c.unpaid > 0 ? `Unpaid <b>${c.unpaid}</b>` : null,
    ].filter(Boolean);
    body.push(payBits.join(" · "));

    pushSection(lines, `🎓 <b>ADMISSIONS — ${escapeHtml(c.title)}</b>`, body);
  }

  // ── LOGINS ──
  {
    const hasToday = loginsToday != null;
    const hasYday = loginsYday != null;
    const hasAvg = loginAvg != null && loginAvg > 0;
    const has30 = loginAvg30 != null && loginAvg30 > 0;
    if ((hasToday && (loginsToday ?? 0) > 0) || (hasYday && (loginsYday ?? 0) > 0) || hasAvg || has30) {
      const row1: string[] = [];
      if (loginsToday != null) row1.push(`Today <b>${loginsToday}</b>`);
      if (loginsYday != null) row1.push(`Yesterday <b>${loginsYday}</b>`);
      const row2: string[] = [];
      if (has30) row2.push(`30-day avg <b>${loginAvg30}</b>`);
      if (hasAvg) row2.push(`All-time avg <b>${loginAvg}</b>`);
      const body = [row1.join(" · "), row2.join(" · ")].filter(Boolean);
      pushSection(lines, `👥 <b>LOGINS</b>`, body);
    }
  }

  // ── REVENUE ──
  if (revenueToday != null || revenueMtd != null || (revenueYday != null && revenueYday > 0)) {
    const body: string[] = [
      `Today <b>${inr(revenueToday)}</b> · MTD <b>${inr(revenueMtd)}</b>`,
    ];
    if (revenueYday != null && revenueYday > 0) {
      body.push(`Yesterday <b>${inr(revenueYday)}</b>`);
    }
    const d = deltaLabel(revenueToday, revenueYday);
    if (d) body.push(`<b>${d}</b>`);
    pushSection(lines, `💰 <b>REVENUE</b>`, body);
  }

  // ── COLLECTIONS ──
  if (collections.overdueCount > 0 || collections.due7dAmount > 0) {
    const body: string[] = [];
    if (collections.overdueCount > 0) {
      body.push(
        `<b>${inr(collections.overdueAmount)}</b> overdue · <b>${collections.overdueCount}</b> students`,
      );
    }
    if (collections.due7dAmount > 0) {
      body.push(`Due this week <b>${inr(collections.due7dAmount)}</b>`);
    }
    pushSection(lines, `⚠️ <b>COLLECTIONS</b>`, body);
  }

  // ── FAILED PAYMENTS (named detail — spacious, no truncation) ──
  if (failedRows.length > 0) {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push(
      `🚨 <b>${failedRows.length} payment${failedRows.length === 1 ? "" : "s"} failed today</b>`,
    );

    failedRows.slice(0, 8).forEach((p, idx) => {
      const name = escapeHtml(p.student_name || "Student");
      const phone = escapeHtml(displayPhone(p.phone));
      const kind = escapeHtml(paymentKindLabel(p));
      const item = escapeHtml(fullItemName(p));
      const when = escapeHtml(formatIstShort(p.created_at));
      const reason = failureReasonShort(p);
      const recovered = laterPaidSameItem(p, allPayments);
      const status = recovered ? "✅ Later paid successfully" : "❌ Still failed — no later payment";

      lines.push("");
      lines.push(`<b>${idx + 1}. ${name}</b>`);
      lines.push(`Phone: ${phone}`);
      lines.push(`Type: ${kind}`);
      lines.push(`Item: <b>${item}</b>`);
      lines.push(`Amount: <b>${inr(p.amount)}</b>`);
      lines.push(`When: ${when}`);
      if (reason) lines.push(`Reason: ${escapeHtml(reason)}`);
      lines.push(`Status: <b>${status}</b>`);
    });

    if (failedRows.length > 8) {
      lines.push("");
      lines.push(`…and <b>${failedRows.length - 8}</b> more failed today`);
    }
  }

  // ── 6 AM only ──
  if (isMorningSummary && pulseToday) {
    const yBody: string[] = [];
    const yLeads = mPrev(pulseToday.pulse.leadsToday);
    const yAdm = mPrev(pulseToday.pulse.seatBookingsToday);
    const yRev =
      (mPrev(pulseToday.pulse.courseRevenue) || 0) + (mPrev(pulseToday.pulse.webinarRevenue) || 0);
    if (yLeads != null || yAdm != null || yRev) {
      yBody.push(
        `Leads ${yLeads ?? "—"} · Admissions ${yAdm ?? "—"} · Revenue ${inr(yRev || null)}`.replace(
          / · —/g,
          "",
        ),
      );
    }
    if (yBody.length) pushSection(lines, `🗓 <b>YESTERDAY CLOSE</b>`, yBody);

    const leadSum = pulseToday.history.leads.slice(-7).reduce((s, p) => s + (p.value || 0), 0);
    const seatSum = pulseToday.history.seatBookings.slice(-7).reduce((s, p) => s + (p.value || 0), 0);
    const revSum =
      pulseToday.history.courseRevenue.slice(-7).reduce((s, p) => s + (p.value || 0), 0) +
      pulseToday.history.webinarRevenue.slice(-7).reduce((s, p) => s + (p.value || 0), 0);
    if (leadSum || seatSum || revSum) {
      pushSection(lines, `📉 <b>7-DAY TREND</b>`, [
        `Leads ${leadSum} · Admissions ${seatSum} · Revenue ${inr(revSum || null)}`,
      ]);
    }
  }

  return {
    html: lines.join("\n"),
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
    await markDigestResult(false, reason);
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

  const prev = await getPreviousSnapshot();
  let built: DigestBuildResult;
  try {
    built = await buildDigest({
      previous: prev?.metrics || null,
      forceMorningExtras: opts?.morningExtras === true,
    });
  } catch (e) {
    const msg = (e as Error).message || "build_failed";
    await markDigestResult(false, msg);
    return { ok: false, reason: msg, channelMasked: maskChannelId(channel) };
  }

  const base = SITE_URL.replace(/\/$/, "") || "https://www.namanias.com";
  const silent = built.isMorningSummary ? false : built.silent;
  const sent = await sendWithRetry(channel, built.html, {
    silent,
    buttons: [
      { label: "Dashboard", url: `${base}/admin` },
      { label: "Collections", url: `${base}/admin/at-risk` },
      { label: "Admissions", url: `${base}/admin/course-payments` },
    ],
  });

  if (!sent.ok) {
    await markDigestResult(false, sent.error || "send_failed");
    return {
      ok: false,
      reason: sent.error || "send_failed",
      html: built.html,
      channelMasked: maskChannelId(channel),
    };
  }

  await saveSnapshot({
    slotKey: opts?.skipIdempotency ? `${slotKey}:manual:${Date.now()}` : slotKey,
    kind: built.isMorningSummary ? "daily_summary" : "digest",
    metrics: { ...built.metrics, message_id: sent.messageId ?? null },
    messageHtml: built.html,
  });
  await markDigestResult(true);
  return {
    ok: true,
    html: built.html,
    messageId: sent.messageId,
    channelMasked: maskChannelId(channel),
  };
}

export async function maybeRunScheduledDigest(): Promise<{
  ok: boolean;
  ran: boolean;
  reason?: string;
  html?: string;
  messageId?: number;
}> {
  const settings = await getReportSettings();
  if (!settings.digest_enabled) return { ok: true, ran: false, reason: "digest_disabled" };

  const parts = istNowParts();
  if (parts.hour === 3) return { ok: true, ran: false, reason: "skip_3am" };

  const hours = digestHoursForFrequency(settings.digest_frequency);
  if (!hours.includes(parts.hour)) return { ok: true, ran: false, reason: "not_slot_hour" };
  if (parts.minute > 20) return { ok: true, ran: false, reason: "outside_window" };
  if (inQuietHours(settings, parts.hour) && parts.hour !== 6) {
    return { ok: true, ran: false, reason: "quiet_hours" };
  }

  const result = await sendDigestNow({ slotKey: parts.slotKey });
  return {
    ok: result.ok || !!result.skipped,
    ran: result.ok && !result.skipped,
    reason: result.reason,
    html: result.html,
    messageId: result.messageId,
  };
}

export async function shouldSendDigestForSettings(settings: ReportSettings): Promise<boolean> {
  const parts = istNowParts();
  if (!settings.digest_enabled) return false;
  if (parts.hour === 3) return false;
  return digestHoursForFrequency(settings.digest_frequency).includes(parts.hour);
}
