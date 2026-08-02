/**
 * Build + send Telegram business digests.
 * Metrics come from getExecutivePulse + the same shared helpers Overview uses
 * (deriveCollections, paid webinar regs, enrollments) — no alternate definitions.
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
import { batchModes, batchTimings, deriveCollections, isActiveEnrollment } from "../../installments";
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
  seats: number;
  online: number;
  offline: number;
  morning: number;
  evening: number;
  inst1Paid: number;
  pending: number;
  outstanding: number;
}

function courseBreakdown(
  courses: Awaited<ReturnType<typeof getAllCourses>>,
  enrollments: Awaited<ReturnType<typeof getAllCourseEnrollments>>,
): CourseBlock[] {
  const enabled = courses.filter((c) => c.status === "published" && c.active !== false);
  const now = Date.now();
  const out: CourseBlock[] = [];

  for (const course of enabled) {
    const enrs = enrollments.filter(
      (e) => e.course_id === course.id && isActiveEnrollment(e) && countsTowardCapacity(e),
    );
    if (!enrs.length) continue;

    let online = 0,
      offline = 0,
      morning = 0,
      evening = 0,
      inst1Paid = 0,
      pending = 0,
      outstanding = 0;
    const batchById = new Map((course.batches || []).map((b) => [b.id, b]));

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

      const schedule = e.schedule || [];
      const first = schedule.find((s) => s.kind === "installment" && s.no === 1) || schedule[0];
      if (first?.paid) inst1Paid++;
      else pending++;

      outstanding += Math.max(0, Number(deriveCollections(e, now).remaining || 0));
    }

    out.push({
      title: course.title,
      total: enrs.length,
      seats: enrs.length,
      online,
      offline,
      morning,
      evening,
      inst1Paid,
      pending,
      outstanding,
    });
  }
  return out.sort((a, b) => b.total - a.total);
}

function seatsUnpaid7d(enrollments: Awaited<ReturnType<typeof getAllCourseEnrollments>>): number {
  const cutoff = Date.now() - 7 * 86400_000;
  let n = 0;
  for (const e of enrollments) {
    if (!isActiveEnrollment(e)) continue;
    if (e.amount_paid > 0) continue;
    const created = new Date(e.created_at).getTime();
    if (Number.isFinite(created) && created <= cutoff) n++;
  }
  return n;
}

function collectionsFromEnrollments(enrollments: Awaited<ReturnType<typeof getAllCourseEnrollments>>) {
  const now = Date.now();
  let overdueCount = 0;
  let overdueAmount = 0;
  for (const e of enrollments) {
    if (!isActiveEnrollment(e) || e.status === "cancelled" || e.status === "transferred_out") continue;
    const col = deriveCollections(e, now);
    if (col.overdueAmount > 0) {
      overdueCount++;
      overdueAmount += col.overdueAmount;
    }
  }
  return { overdueCount, overdueAmount };
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
    // Same Overview methodology: paid distinct registrations for this webinar slug.
    const paid = payments.filter(
      (p) =>
        !p.deleted_at &&
        isPaidStatus(p.status) &&
        p.item_type === "webinar" &&
        (p.item_slug || "").toLowerCase() === (upcoming.slug || "").toLowerCase(),
    );
    const confirmed = distinctRegistrations(paid);

    return {
      title: upcoming.title,
      dateLabel: formatIstShort(upcoming.datetime),
      registered,
      confirmed,
      attendedLastPct: null, // omit heavy funnel scan in digest path; show —
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

  let pulse: Awaited<ReturnType<typeof getExecutivePulse>> | null = null;
  let courses: Awaited<ReturnType<typeof getAllCourses>> = [];
  let enrollments: Awaited<ReturnType<typeof getAllCourseEnrollments>> = [];
  let webinar: Awaited<ReturnType<typeof pickUpcomingWebinar>> = null;

  try {
    const settled = await Promise.allSettled([
      getExecutivePulse({ preset: "today", canRevenue: true }),
      getAllCourses(),
      getAllCourseEnrollments(),
      pickUpcomingWebinar(),
    ]);
    if (settled[0].status === "fulfilled") pulse = settled[0].value;
    if (settled[1].status === "fulfilled") courses = settled[1].value;
    if (settled[2].status === "fulfilled") enrollments = settled[2].value;
    if (settled[3].status === "fulfilled") webinar = settled[3].value;
  } catch {
    /* sections fall back to — */
  }

  const prev = opts?.previous || null;
  const courseBlocks = courseBreakdown(courses, enrollments);
  const unpaid7d = seatsUnpaid7d(enrollments);
  const collections = collectionsFromEnrollments(enrollments);

  const loginsToday = pulse ? mVal(pulse.pulse.loginUsersToday) : null;
  const loginsYday = pulse ? mPrev(pulse.pulse.loginUsersToday) : null;
  const last7 = pulse?.history.loginUsers.slice(-7) || [];
  const loginAvg =
    last7.length > 0 ? Math.round((last7.reduce((s, p) => s + (p.value || 0), 0) / last7.length) * 10) / 10 : null;

  const leadsToday = pulse ? mVal(pulse.pulse.leadsToday) : null;
  const admissionsToday = pulse ? mVal(pulse.pulse.seatBookingsToday) : null;
  const revenueToday = pulse
    ? (mVal(pulse.pulse.courseRevenue) || 0) + (mVal(pulse.pulse.webinarRevenue) || 0)
    : null;

  const metrics: SnapshotMetrics = {
    logins_today: loginsToday,
    logins_yesterday: loginsYday,
    login_avg: loginAvg,
    leads_today: leadsToday,
    admissions_today: admissionsToday,
    revenue_today: revenueToday,
    overdue_count: collections.overdueCount,
    overdue_amount: collections.overdueAmount,
    unpaid_seats_7d: unpaid7d,
    webinar_registered: webinar?.registered ?? null,
    webinar_confirmed: webinar?.confirmed ?? null,
    webinar_id: webinar?.webinarId ?? null,
  };
  for (const c of courseBlocks) {
    metrics[`course:${c.title}:total`] = c.total;
    metrics[`course:${c.title}:outstanding`] = c.outstanding;
  }

  const webinarDelta = deltaAbsLabel(
    webinar?.registered ?? null,
    num(prev, "webinar_registered"),
    " since last",
  );

  const lines: string[] = [];
  lines.push(`📊 <b>NAMAN IAS · ${escapeHtml(parts.label)}</b>`);
  lines.push("");
  lines.push(`👥 <b>LOGINS</b>`);
  lines.push(`Today ${dash(loginsToday)} · Yesterday ${dash(loginsYday)} · Avg ${dash(loginAvg)}`);
  lines.push(`${deltaArrow(pulse ? mPct(pulse.pulse.loginUsersToday) : null)} vs yesterday`);
  lines.push("");

  if (webinar) {
    const shortDate = webinar.dateLabel.replace(/\s+\d{1,2}:\d{2}.*/, "").trim() || webinar.dateLabel;
    lines.push(`🎓 <b>WEBINAR — ${escapeHtml(webinar.title)} (${escapeHtml(shortDate)})</b>`);
    lines.push(`Registered ${dash(webinar.registered)}${escapeHtml(webinarDelta)}`);
    lines.push(`Confirmed ${dash(webinar.confirmed)} · Attended last time ${pct(webinar.attendedLastPct)}`);
    lines.push("");
  } else {
    lines.push(`🎓 <b>WEBINAR</b>`);
    lines.push(`—`);
    lines.push("");
  }

  for (const c of courseBlocks.slice(0, 6)) {
    const instPct = c.total > 0 ? Math.round((c.inst1Paid / c.total) * 100) : null;
    lines.push(`💰 <b>ADMISSIONS — ${escapeHtml(c.title)}</b>`);
    lines.push(`Total ${dash(c.total)} · Seats booked ${dash(c.seats)}`);
    lines.push(`Online ${dash(c.online)} · Offline ${dash(c.offline)}`);
    lines.push(`Morning ${dash(c.morning)} · Evening ${dash(c.evening)}`);
    lines.push(`1st installment paid ${dash(c.inst1Paid)}${instPct != null ? ` (${instPct}%)` : ""}`);
    lines.push(`Pending ${dash(c.pending)} · ${inr(c.outstanding)} outstanding`);
    const prevTotal = num(prev, `course:${c.title}:total`);
    if (prevTotal != null) {
      lines.push(`${deltaArrow(((c.total - prevTotal) / Math.max(1, prevTotal)) * 100)} vs last digest`);
    }
    lines.push("");
  }
  if (!courseBlocks.length) {
    lines.push(`💰 <b>ADMISSIONS</b>`);
    lines.push(`—`);
    lines.push("");
  }

  lines.push(`📈 <b>TODAY</b>`);
  lines.push(
    `New leads ${dash(leadsToday)} · Admissions ${dash(admissionsToday)} · Revenue ${inr(revenueToday)}`,
  );
  lines.push(`${deltaArrow(pulse ? mPct(pulse.pulse.leadsToday) : null)} leads vs yesterday`);
  lines.push("");
  lines.push(`⚠️ ${dash(collections.overdueCount)} installments overdue · ${dash(unpaid7d)} seats unpaid 7d+`);
  if (collections.overdueAmount > 0) lines.push(`${inr(collections.overdueAmount)} overdue`);

  if (isMorningSummary) {
    lines.push("");
    lines.push(`🗓 <b>YESTERDAY CLOSE</b>`);
    if (pulse) {
      lines.push(
        `Leads ${dash(mPrev(pulse.pulse.leadsToday))} · Admissions ${dash(mPrev(pulse.pulse.seatBookingsToday))} · Revenue ${inr((mPrev(pulse.pulse.courseRevenue) || 0) + (mPrev(pulse.pulse.webinarRevenue) || 0) || null)}`,
      );
    } else {
      lines.push(`Leads — · Admissions — · Revenue —`);
    }
    lines.push("");
    lines.push(`📉 <b>7-DAY TREND</b>`);
    if (pulse) {
      const leadSum = pulse.history.leads.slice(-7).reduce((s, p) => s + (p.value || 0), 0);
      const seatSum = pulse.history.seatBookings.slice(-7).reduce((s, p) => s + (p.value || 0), 0);
      const revSum =
        pulse.history.courseRevenue.slice(-7).reduce((s, p) => s + (p.value || 0), 0) +
        pulse.history.webinarRevenue.slice(-7).reduce((s, p) => s + (p.value || 0), 0);
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
      if (soon.length) {
        lines.push("");
        lines.push(`📅 <b>UPCOMING</b>`);
        for (const w of soon.slice(0, 5)) {
          lines.push(`· ${escapeHtml(w.title)} — ${escapeHtml(w.datetime ? formatIstShort(w.datetime) : "—")}`);
        }
      }
    } catch {
      /* ignore */
    }
  }

  return { html: lines.join("\n"), metrics, isMorningSummary, silent: !isMorningSummary };
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

  const channel = resolveReportsChannelId(settings);
  if (!channel) {
    await markDigestResult(false, "channel_not_configured");
    return { ok: false, reason: "channel_not_configured", channelMasked: null };
  }

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
  // 6 AM–style digest (or forced morning) always notifies; other digests silent.
  const silent = built.isMorningSummary ? false : built.silent;
  const sent = await sendWithRetry(channel, built.html, {
    silent,
    buttons: [
      { label: "Open Dashboard", url: `${base}/admin` },
      { label: "View Admissions", url: `${base}/admin/course-payments` },
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
    metrics: built.metrics,
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
  };
}

export async function shouldSendDigestForSettings(settings: ReportSettings): Promise<boolean> {
  const parts = istNowParts();
  if (!settings.digest_enabled) return false;
  if (parts.hour === 3) return false;
  return digestHoursForFrequency(settings.digest_frequency).includes(parts.hour);
}
