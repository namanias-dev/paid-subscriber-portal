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
  isActiveEnrollment,
} from "../../installments";
import { countsTowardCapacity } from "../../enrollmentScope";
import { distinctRegistrations, isPaidStatus } from "../../paymentsAgg";
import { getSupabaseAdmin } from "../../supabase";
import { buildKeyboard, sendMessage } from "../botApi";
import { tgLog } from "../log";
import { escapeHtml, formatIstShort, inr, istNowParts } from "./format";
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

/** Truncate display names for Telegram (~40 chars). */
function truncName(s: string, max = 40): string {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
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

/**
 * Classify ONE mode per enrollment. Never fall back to course.modes
 * (those list catalog options and would double-count).
 */
function classifyMode(
  batch: { mode?: unknown } | null,
  batchLabel: string,
): ModeBucket | null {
  const modes = batch ? batchModes(batch as { mode?: import("../../types").LearningMode | import("../../types").LearningMode[] | null }) : [];
  const fromBatch = new Set<ModeBucket>();
  for (const m of modes) {
    const s = String(m);
    if (/offline/i.test(s)) fromBatch.add("offline");
    else if (/online|recorded|hybrid/i.test(s)) fromBatch.add("online");
  }
  if (fromBatch.size === 1) return [...fromBatch][0]!;
  if (fromBatch.size > 1) return null;

  const label = batchLabel.toLowerCase();
  const hasOff = /\boffline\b/.test(label);
  const hasOn = /\bonline\b|\brecorded\b|\bhybrid\b/.test(label);
  if (hasOff && !hasOn) return "offline";
  if (hasOn && !hasOff) return "online";
  return null;
}

/**
 * Classify ONE timing per enrollment. Never fall back to course.batch_timings
 * (catalog lists both Morning and Evening → Morning 24 · Evening 14 on Total 24).
 */
function classifyTiming(
  batch: { timing?: unknown } | null,
  batchLabel: string,
): TimingBucket | null {
  const timings = batch ? batchTimings(batch as { timing?: string | string[] | null }) : [];
  const fromBatch = new Set<TimingBucket>();
  for (const t of timings) {
    const s = String(t);
    if (/morning/i.test(s)) fromBatch.add("morning");
    if (/evening/i.test(s)) fromBatch.add("evening");
  }
  if (fromBatch.size === 1) return [...fromBatch][0]!;
  if (fromBatch.size > 1) return null; // e.g. ["Morning","Evening"] — ambiguous

  const label = batchLabel.toLowerCase();
  const hasM = /\bmorning\b/.test(label);
  const hasE = /\bevening\b/.test(label);
  if (hasM && !hasE) return "morning";
  if (hasE && !hasM) return "evening";
  return null;
}

interface CourseBlock {
  title: string;
  total: number;
  capacity: number | null;
  seatsLeft: number | null;
  online: number;
  offline: number;
  morning: number;
  evening: number;
  modeOk: boolean;
  timingOk: boolean;
  /** True when morning+evening are both 0 (suppress timing line). */
  timingEmpty: boolean;
  /** True when online+offline are both 0 (suppress mode line). */
  modeEmpty: boolean;
}

function courseBreakdown(
  courses: Awaited<ReturnType<typeof getAllCourses>>,
  enrollments: Awaited<ReturnType<typeof getAllCourseEnrollments>>,
): CourseBlock[] {
  const enabled = courses.filter((c) => c.status === "published" && c.active !== false);
  const out: CourseBlock[] = [];

  for (const course of enabled) {
    // One row per enrollment id — never expand by installment/payment.
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
      evening = 0;
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
      const batch = e.batch_id ? batchById.get(e.batch_id) || null : null;
      const label = e.batch_label || "";
      const mode = classifyMode(batch, label);
      if (mode === "online") online++;
      else if (mode === "offline") offline++;
      const timing = classifyTiming(batch, label);
      if (timing === "morning") morning++;
      else if (timing === "evening") evening++;
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

    const seatsLeft =
      capacity != null && capacity > 0 ? Math.max(0, capacity - total) : null;

    out.push({
      title: course.title,
      total,
      capacity,
      seatsLeft,
      online,
      offline,
      morning,
      evening,
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
  confirmed: number | null;
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
    let confirmed: number | null = null;
    if (upcoming.price && upcoming.price > 0) {
      const paid = payments.filter(
        (p) =>
          !p.deleted_at &&
          isPaidStatus(p.status) &&
          p.item_type === "webinar" &&
          (p.item_slug || "").toLowerCase() === (upcoming.slug || "").toLowerCase(),
      );
      confirmed = distinctRegistrations(paid);
    }

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
      confirmed,
      attendedLastPct,
      webinarId: upcoming.id,
    };
  } catch {
    return null;
  }
}

/** total login events ÷ days since first login (all-time daily average). */
async function loginAllTimeDailyAvg(): Promise<number | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  try {
    const { count, error: cErr } = await db
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("event_name", "login");
    if (cErr) {
      tgLog("digest_login_avg_count_failed", { error: cErr.message }, "warn");
      return null;
    }
    if (count == null || count <= 0) return null;

    const { data: rows, error: fErr } = await db
      .from("analytics_events")
      .select("occurred_at")
      .eq("event_name", "login")
      .order("occurred_at", { ascending: true })
      .limit(1);
    if (fErr) {
      tgLog("digest_login_avg_first_failed", { error: fErr.message }, "warn");
      return null;
    }
    const firstIso = Array.isArray(rows) && rows[0] ? (rows[0] as { occurred_at?: string }).occurred_at : null;
    if (!firstIso) return null;
    const first = new Date(firstIso).getTime();
    if (!Number.isFinite(first)) return null;
    const days = Math.max(1, Math.ceil((Date.now() - first) / 86400_000));
    return Math.round(count / days);
  } catch (e) {
    tgLog("digest_login_avg_error", { error: (e as Error).message }, "warn");
    return null;
  }
}

function pushSection(lines: string[], header: string, body: string[]): void {
  if (!body.length) return;
  // Blank line between sections (header already ends with one blank after title).
  if (lines.length && lines[lines.length - 1] !== "") lines.push("");
  lines.push(header);
  for (const row of body.slice(0, 4)) lines.push(row);
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
  let failedToday: number | null = null;
  let loginAvg: number | null = null;

  try {
    const settled = await Promise.allSettled([
      getExecutivePulse({ preset: "today", canRevenue: true }),
      getExecutivePulse({ preset: "this_month", canRevenue: true }),
      getAllCourses(),
      getAllCourseEnrollments(),
      pickUpcomingWebinar(),
      getPayments(),
      loginAllTimeDailyAvg(),
    ]);
    if (settled[0].status === "fulfilled") pulseToday = settled[0].value;
    if (settled[1].status === "fulfilled") pulseMtd = settled[1].value;
    if (settled[2].status === "fulfilled") courses = settled[2].value;
    if (settled[3].status === "fulfilled") enrollments = settled[3].value;
    if (settled[4].status === "fulfilled") webinar = settled[4].value;
    if (settled[5].status === "fulfilled") {
      const today = istTodayYMD();
      failedToday = settled[5].value.filter(
        (p) =>
          !p.deleted_at &&
          String(p.status || "").toUpperCase() === "FAILED" &&
          istYMD(p.created_at) === today,
      ).length;
    }
    if (settled[6].status === "fulfilled") loginAvg = settled[6].value;
  } catch {
    /* sections omit missing data */
  }

  void opts?.previous;
  const courseBlocks = courseBreakdown(courses, enrollments);
  const collections = collectionsStats(enrollments);

  const loginsToday = pulseToday ? mVal(pulseToday.pulse.loginUsersToday) : null;
  const loginsYday = pulseToday ? mPrev(pulseToday.pulse.loginUsersToday) : null;
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
  lines.push(`📊 <b>NAMAN IAS · ${escapeHtml(headerLabel)}</b>`);
  lines.push("");

  // ── WEBINAR ──
  if (webinar && webinar.registered > 0) {
    const body: string[] = [];
    const dateBit = webinar.dateLabel || "";
    body.push(
      `${escapeHtml(truncName(webinar.title))} — ${escapeHtml(dateBit)}`,
    );
    body.push(`Registered ${webinar.registered}`);
    if (webinar.confirmed != null && webinar.confirmed > 0) {
      body.push(`Confirmed ${webinar.confirmed}`);
    }
    if (webinar.attendedLastPct != null) {
      body.push(`Last attendance ${webinar.attendedLastPct}%`);
    }
    pushSection(lines, `📣 <b>WEBINAR</b>`, body);
  }

  // ── ADMISSIONS ──
  {
    const body: string[] = [];
    for (const c of courseBlocks.filter((x) => x.total > 0).slice(0, 2)) {
      body.push(escapeHtml(truncName(c.title)));
      const seats =
        c.seatsLeft != null
          ? `${c.total} admissions · ${c.seatsLeft} seats left`
          : `${c.total} admissions`;
      body.push(escapeHtml(seats));
      if (!c.modeEmpty) {
        if (c.modeOk) {
          body.push(`Offline ${c.offline} · Online ${c.online}`);
        } else {
          body.push(`Offline/Online — ⚠`);
        }
      }
      // Timing only when invariant passes (and not empty).
      if (c.timingOk) {
        body.push(`Morning ${c.morning} · Evening ${c.evening}`);
      } else if (!c.timingEmpty) {
        body.push(`Morning/Evening — ⚠`);
      }
    }
    if (body.length) {
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      lines.push(`🎓 <b>ADMISSIONS</b>`);
      for (const row of body) lines.push(row);
    }
  }

  // ── LOGINS ──
  {
    const hasToday = loginsToday != null && loginsToday > 0;
    const hasYday = loginsYday != null && loginsYday > 0;
    const hasAvg = loginAvg != null && loginAvg > 0;
    if (hasToday || hasYday || hasAvg) {
      const body: string[] = [];
      if (hasToday || hasYday) {
        const t = loginsToday != null ? `Today ${loginsToday}` : null;
        const y = loginsYday != null ? `Yesterday ${loginsYday}` : null;
        body.push([t, y].filter(Boolean).join(" · "));
      }
      if (hasAvg) body.push(`All-time daily average ${loginAvg}`);
      pushSection(lines, `👥 <b>LOGINS</b>`, body);
    }
  }

  // ── REVENUE ──
  if (revenueToday != null || revenueMtd != null || (revenueYday != null && revenueYday > 0)) {
    const body: string[] = [];
    body.push(`Today ${inr(revenueToday)} · MTD ${inr(revenueMtd)}`);
    if (revenueYday != null && revenueYday > 0) {
      body.push(`Yesterday ${inr(revenueYday)}`);
    }
    const d = deltaLabel(revenueToday, revenueYday);
    if (d) body.push(d);
    pushSection(lines, `💰 <b>REVENUE</b>`, body);
  }

  // ── COLLECTIONS ──
  if (collections.overdueCount > 0 || collections.due7dAmount > 0) {
    const body: string[] = [];
    if (collections.overdueCount > 0) {
      body.push(
        `${inr(collections.overdueAmount)} overdue · ${collections.overdueCount} students`,
      );
    }
    if (collections.due7dAmount > 0) {
      body.push(`Due this week ${inr(collections.due7dAmount)}`);
    }
    pushSection(lines, `⚠️ <b>COLLECTIONS</b>`, body);
  }

  // ── ALERTS (failed payments) ──
  if (failedToday != null && failedToday > 0) {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push(`🚨 ${failedToday} payment${failedToday === 1 ? "" : "s"} failed today`);
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
