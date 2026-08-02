/**
 * Build + send Telegram CEO digests.
 * Metrics reuse getExecutivePulse / shared helpers Overview uses — no alternate definitions.
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
import { distinctRegistrations, isPaidStatus } from "../../paymentsAgg";
import { buildKeyboard, sendMessage } from "../botApi";
import { tgLog } from "../log";
import {
  dash,
  deltaAbsLabel,
  deltaArrow,
  escapeHtml,
  formatIstShort,
  inr,
  istNowParts,
  pct,
} from "./format";
import {
  digestHoursForFrequency,
  getReportSettings,
  inQuietHours,
  markDigestResult,
  maskChannelId,
  resolveReportsChannelId,
  type ReportSettings,
} from "./settings";
import { getPreviousSnapshot, getSnapshotBySlot, num, saveSnapshot, type SnapshotMetrics } from "./snapshots";
import { assertReportsChannel } from "./channelGuard";

function mVal(m: MetricDelta | null | undefined): number | null {
  if (!m || m.value == null || !Number.isFinite(m.value)) return null;
  return m.value;
}
function mPrev(m: MetricDelta | null | undefined): number | null {
  if (!m || m.prev == null || !Number.isFinite(m.prev)) return null;
  return m.prev;
}
function mPct(m: MetricDelta | null | undefined): number | null {
  if (!m || m.deltaPct == null || !Number.isFinite(m.deltaPct)) return null;
  return m.deltaPct;
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
  todayNew: number;
}

function courseBreakdown(
  courses: Awaited<ReturnType<typeof getAllCourses>>,
  enrollments: Awaited<ReturnType<typeof getAllCourseEnrollments>>,
): CourseBlock[] {
  const enabled = courses.filter((c) => c.status === "published" && c.active !== false);
  const now = Date.now();
  const today = istTodayYMD();
  const out: CourseBlock[] = [];

  for (const course of enabled) {
    const enrs = enrollments.filter(
      (e) => e.course_id === course.id && isActiveEnrollment(e) && countsTowardCapacity(e),
    );
    if (!enrs.length && (course.capacity == null || course.capacity <= 0)) continue;

    let online = 0,
      offline = 0,
      morning = 0,
      evening = 0,
      fullPaid = 0,
      partial = 0,
      unpaid = 0,
      todayNew = 0;
    const batchById = new Map((course.batches || []).map((b) => [b.id, b]));

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
      const batch = e.batch_id ? batchById.get(e.batch_id) : null;
      const modes = batch ? batchModes(batch) : course.modes || [];
      const timings = batch ? batchTimings(batch) : course.batch_timings || [];
      const label = (e.batch_label || "").toLowerCase();

      const isOnline = modes.some((m) => /online|recorded|hybrid/i.test(m)) || /online/.test(label);
      const isOffline = modes.some((m) => /offline/i.test(m)) || /offline/.test(label);
      if (isOffline && !isOnline) offline++;
      else if (isOnline && !isOffline) online++;
      else if (isOffline) offline++;
      else if (isOnline) online++;

      if (timings.some((t) => /morning/i.test(t)) || /morning/.test(label)) morning++;
      if (timings.some((t) => /evening/i.test(t)) || /evening/.test(label)) evening++;

      const der = deriveEnrollment(e, now);
      if (der.isFullyPaid) fullPaid++;
      else if ((e.amount_paid || 0) > 0 || der.paid > 0) partial++;
      else unpaid++;

      if (istYMD(e.created_at) === today) todayNew++;
    }

    out.push({
      title: course.title,
      total: enrs.length,
      capacity,
      online,
      offline,
      morning,
      evening,
      fullPaid,
      partial,
      unpaid,
      todayNew,
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

function collectionsStats(enrollments: Awaited<ReturnType<typeof getAllCourseEnrollments>>) {
  const now = Date.now();
  const weekMs = 7 * 86400_000;
  let overdueCount = 0;
  let overdueAmount = 0;
  let overdue7d = 0;
  let overdue30d = 0;
  let due7dAmount = 0;
  let billed = 0;
  let collected = 0;

  for (const e of enrollments) {
    if (!isActiveEnrollment(e) || e.status === "cancelled" || e.status === "transferred_out") continue;
    const col = deriveCollections(e, now);
    billed += Number(e.total_fee) || 0;
    collected += col.paid || 0;
    if (col.overdueAmount > 0) {
      overdueCount++;
      overdueAmount += col.overdueAmount;
      if (col.daysOverdue >= 7) overdue7d++;
      if (col.daysOverdue >= 30) overdue30d++;
    }
    if (col.nextDueDate && col.nextDueAmount > 0) {
      const due = new Date(col.nextDueDate).getTime();
      if (Number.isFinite(due) && due >= now && due <= now + weekMs) {
        due7dAmount += col.nextDueAmount;
      }
    }
  }
  const collectedPct = billed > 0 ? Math.round((collected / billed) * 100) : null;
  return { overdueCount, overdueAmount, overdue7d, overdue30d, due7dAmount, collectedPct };
}

async function pickUpcomingWebinar(): Promise<{
  title: string;
  dateLabel: string;
  registered: number;
  confirmed: number;
  attendedLastPct: number | null;
  webinarId: string;
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

    const registered = regs.filter((r) => r.webinar_id === upcoming.id).length;
    const paid = payments.filter(
      (p) =>
        !p.deleted_at &&
        isPaidStatus(p.status) &&
        p.item_type === "webinar" &&
        (p.item_slug || "").toLowerCase() === (upcoming.slug || "").toLowerCase(),
    );
    const confirmed = upcoming.price && upcoming.price > 0 ? distinctRegistrations(paid) : registered;

    let attendedLastPct: number | null = null;
    const past = [...webinars]
      .filter((w) => w.datetime && new Date(w.datetime).getTime() < now && w.id !== upcoming.id)
      .sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime())[0];
    if (past) {
      const pastRegs = regs.filter((r) => r.webinar_id === past.id);
      const attended = pastRegs.filter((r) => (r as { attended?: boolean }).attended === true).length;
      if (pastRegs.length > 0 && attended > 0) {
        attendedLastPct = Math.round((attended / pastRegs.length) * 100);
      }
    }

    return {
      title: upcoming.title,
      dateLabel: formatIstShort(upcoming.datetime),
      registered,
      confirmed,
      attendedLastPct,
      webinarId: upcoming.id,
    };
  } catch {
    return null;
  }
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
  const isMorningSummary = opts?.forceMorningExtras === true || parts.hour === 6;

  let pulseToday: Awaited<ReturnType<typeof getExecutivePulse>> | null = null;
  let pulseMtd: Awaited<ReturnType<typeof getExecutivePulse>> | null = null;
  let courses: Awaited<ReturnType<typeof getAllCourses>> = [];
  let enrollments: Awaited<ReturnType<typeof getAllCourseEnrollments>> = [];
  let webinar: Awaited<ReturnType<typeof pickUpcomingWebinar>> = null;
  let failedToday: number | null = null;

  try {
    const settled = await Promise.allSettled([
      getExecutivePulse({ preset: "today", canRevenue: true }),
      getExecutivePulse({ preset: "this_month", canRevenue: true }),
      getAllCourses(),
      getAllCourseEnrollments(),
      pickUpcomingWebinar(),
      getPayments(),
    ]);
    if (settled[0].status === "fulfilled") pulseToday = settled[0].value;
    if (settled[1].status === "fulfilled") pulseMtd = settled[1].value;
    if (settled[2].status === "fulfilled") courses = settled[2].value;
    if (settled[3].status === "fulfilled") enrollments = settled[3].value;
    if (settled[4].status === "fulfilled") webinar = settled[4].value;
    if (settled[5].status === "fulfilled") {
      const today = istTodayYMD();
      failedToday = settled[5].value.filter(
        (p) => !p.deleted_at && String(p.status || "").toUpperCase() === "FAILED" && istYMD(p.created_at) === today,
      ).length;
    }
  } catch {
    /* sections fall back to — */
  }

  const prev = opts?.previous || null;
  const courseBlocks = courseBreakdown(courses, enrollments);
  const collections = collectionsStats(enrollments);

  const loginsToday = pulseToday ? mVal(pulseToday.pulse.loginUsersToday) : null;
  const leadsToday = pulseToday ? mVal(pulseToday.pulse.leadsToday) : null;
  const admissionsToday = pulseToday ? mVal(pulseToday.pulse.seatBookingsToday) : null;
  const revenueToday = pulseToday
    ? (mVal(pulseToday.pulse.courseRevenue) || 0) + (mVal(pulseToday.pulse.webinarRevenue) || 0)
    : null;
  const revenueMtd = pulseMtd
    ? (mVal(pulseMtd.pulse.courseRevenue) || 0) + (mVal(pulseMtd.pulse.webinarRevenue) || 0)
    : null;

  const convPct =
    leadsToday != null && leadsToday > 0 && admissionsToday != null
      ? Math.round((admissionsToday / leadsToday) * 1000) / 10
      : null;
  const avgTicket =
    admissionsToday != null && admissionsToday > 0 && revenueToday != null
      ? Math.round(revenueToday / admissionsToday)
      : null;

  const webinarDelta = deltaAbsLabel(
    webinar?.registered ?? null,
    num(prev, "webinar_registered"),
    " in 3h",
  );

  const metrics: SnapshotMetrics = {
    logins_today: loginsToday,
    leads_today: leadsToday,
    admissions_today: admissionsToday,
    revenue_today: revenueToday,
    revenue_mtd: revenueMtd,
    collected_pct: collections.collectedPct,
    overdue_count: collections.overdueCount,
    overdue_amount: collections.overdueAmount,
    overdue_7d: collections.overdue7d,
    overdue_30d: collections.overdue30d,
    due_7d_amount: collections.due7dAmount,
    webinar_registered: webinar?.registered ?? null,
    webinar_confirmed: webinar?.confirmed ?? null,
    webinar_id: webinar?.webinarId ?? null,
    failed_today: failedToday,
    conv_pct: convPct,
    avg_ticket: avgTicket,
  };
  for (const c of courseBlocks) {
    metrics[`course:${c.title}:total`] = c.total;
  }

  const lines: string[] = [];
  lines.push(`📊 <b>NAMAN IAS · ${escapeHtml(parts.label)}</b>`);
  lines.push("");

  // REVENUE
  lines.push(`💰 <b>REVENUE</b>`);
  lines.push(`Today ${inr(revenueToday)} · MTD ${inr(revenueMtd)}`);
  lines.push(
    `${deltaArrow(pulseToday ? mPct(pulseToday.pulse.courseRevenue) : null)} vs yesterday · Collected ${collections.collectedPct != null ? `${collections.collectedPct}%` : "—"} of billed`,
  );
  lines.push("");

  // ADMISSIONS per course
  if (courseBlocks.length) {
    for (const c of courseBlocks.slice(0, 6)) {
      const seats =
        c.capacity != null && c.capacity > 0 ? `${c.total}/${c.capacity}` : `${dash(c.total)}/—`;
      const todayBit = c.todayNew > 0 ? ` (+${c.todayNew} today)` : "";
      lines.push(`🎓 <b>ADMISSIONS — ${escapeHtml(c.title)}</b>`);
      lines.push(`Total ${dash(c.total)}${escapeHtml(todayBit)} · Seats ${escapeHtml(seats)}`);
      lines.push(`Online ${dash(c.online)} · Offline ${dash(c.offline)}`);
      lines.push(`Morning ${dash(c.morning)} · Evening ${dash(c.evening)}`);
      lines.push(`Full paid ${dash(c.fullPaid)} · Partial ${dash(c.partial)} · Unpaid ${dash(c.unpaid)}`);
      const prevTotal = num(prev, `course:${c.title}:total`);
      lines.push(`${deltaArrow(prevTotal != null && prevTotal > 0 ? ((c.total - prevTotal) / prevTotal) * 100 : null)} vs last digest`);
      lines.push("");
    }
  } else {
    lines.push(`🎓 <b>ADMISSIONS</b>`);
    lines.push(`—`);
    lines.push("");
  }

  // COLLECTIONS
  lines.push(`⚠️ <b>COLLECTIONS</b>`);
  lines.push(
    `Overdue ${inr(collections.overdueAmount)} across ${dash(collections.overdueCount)} students`,
  );
  lines.push(`7d+ overdue: ${dash(collections.overdue7d)} · 30d+: ${dash(collections.overdue30d)}`);
  lines.push(`Due next 7 days: ${inr(collections.due7dAmount)}`);
  lines.push("");

  // WEBINAR
  if (webinar) {
    const shortDate = webinar.dateLabel.replace(/\s+\d{1,2}:\d{2}.*/, "").trim() || webinar.dateLabel;
    lines.push(`📣 <b>WEBINAR — ${escapeHtml(webinar.title)} (${escapeHtml(shortDate)})</b>`);
    lines.push(
      `Registered ${dash(webinar.registered)}${escapeHtml(webinarDelta)} · Confirmed ${dash(webinar.confirmed)}`,
    );
    lines.push(`Last webinar attendance ${pct(webinar.attendedLastPct)}`);
    lines.push("");
  } else {
    lines.push(`📣 <b>WEBINAR</b>`);
    lines.push(`—`);
    lines.push("");
  }

  // FUNNEL
  lines.push(`👥 <b>FUNNEL</b>`);
  lines.push(
    `New leads ${dash(leadsToday)}${escapeHtml(
      pulseToday && mPct(pulseToday.pulse.leadsToday) != null
        ? ` (${deltaArrow(mPct(pulseToday.pulse.leadsToday)).replace(/^· /, "")})`
        : "",
    )} · Logins ${dash(loginsToday)}`,
  );
  lines.push(
    `Lead→admission ${convPct != null ? `${convPct}%` : "—"} · Avg ticket ${inr(avgTicket)}`,
  );
  lines.push("");

  // Failed payments
  if (failedToday != null && failedToday > 0) {
    lines.push(`🚨 ${failedToday} payment${failedToday === 1 ? "" : "s"} failed today`);
  } else {
    lines.push(`🚨 ${dash(failedToday)} payments failed today`);
  }

  if (isMorningSummary) {
    lines.push("");
    lines.push(`🗓 <b>YESTERDAY CLOSE</b>`);
    if (pulseToday) {
      lines.push(
        `Leads ${dash(mPrev(pulseToday.pulse.leadsToday))} · Admissions ${dash(mPrev(pulseToday.pulse.seatBookingsToday))} · Revenue ${inr((mPrev(pulseToday.pulse.courseRevenue) || 0) + (mPrev(pulseToday.pulse.webinarRevenue) || 0) || null)}`,
      );
    } else {
      lines.push(`Leads — · Admissions — · Revenue —`);
    }
    lines.push("");
    lines.push(`📉 <b>7-DAY TREND</b>`);
    if (pulseToday) {
      const leadSum = pulseToday.history.leads.slice(-7).reduce((s, p) => s + (p.value || 0), 0);
      const seatSum = pulseToday.history.seatBookings.slice(-7).reduce((s, p) => s + (p.value || 0), 0);
      const revSum =
        pulseToday.history.courseRevenue.slice(-7).reduce((s, p) => s + (p.value || 0), 0) +
        pulseToday.history.webinarRevenue.slice(-7).reduce((s, p) => s + (p.value || 0), 0);
      lines.push(`Leads ${dash(leadSum)} · Admissions ${dash(seatSum)} · Revenue ${inr(revSum || null)}`);
    } else {
      lines.push(`Leads — · Admissions — · Revenue —`);
    }

    try {
      const webinars = await getWebinars();
      const today = istTodayYMD();
      const soon = webinars.filter((w) => {
        const ymd = istYMD(w.datetime || "");
        return ymd && ymd >= today;
      });
      // Payment deadlines: enrollments with next due today
      const dueToday: string[] = [];
      const now = Date.now();
      for (const e of enrollments) {
        if (!isActiveEnrollment(e)) continue;
        const col = deriveCollections(e, now);
        if (col.nextDueDate && istYMD(col.nextDueDate) === today && col.nextDueAmount > 0) {
          dueToday.push(
            `${escapeHtml(e.student_name || "Student")} · ${inr(col.nextDueAmount)}`,
          );
        }
      }
      if (soon.length || dueToday.length) {
        lines.push("");
        lines.push(`📅 <b>UPCOMING</b>`);
        for (const w of soon.slice(0, 5)) {
          lines.push(`· ${escapeHtml(w.title)} — ${escapeHtml(w.datetime ? formatIstShort(w.datetime) : "—")}`);
        }
        for (const row of dueToday.slice(0, 5)) {
          lines.push(`· Due today — ${row}`);
        }
      }
    } catch {
      /* ignore */
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
      forceMorningExtras: opts?.morningExtras === true || parts.hour === 6,
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
