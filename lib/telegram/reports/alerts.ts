/**
 * Real-time Telegram business report alerts.
 * Digests are silent; alerts always notify.
 */
import { SITE_URL } from "../../config";
import {
  getLeads,
  getWebinars,
  getAllWebinarRegistrations,
  getAllCourseEnrollments,
  getPayments,
} from "../../dataProvider";
import { isPaidStatus } from "../../paymentsAgg";
import { deriveCollections, deriveEnrollment, isActiveEnrollment } from "../../installments";
import { istTodayYMD, istYMD } from "../../dates";
import type { Payment } from "../../types";
import { buildKeyboard, sendMessage } from "../botApi";
import { tgLog } from "../log";
import { escapeHtml, formatIstShort, inr, istNowParts } from "./format";
import {
  getReportSettings,
  isAlertEnabled,
  markAlertSent,
  resolveReportsChannelId,
  type ReportAlertKey,
} from "./settings";
import { getSupabaseAdmin } from "../../supabase";
import { assertReportsChannel } from "./channelGuard";
import { normalizeIndianMobile } from "../../phone";

function displayPhone(raw: string | null | undefined): string {
  const n = normalizeIndianMobile(raw);
  if (n.ok && n.display) return n.display;
  const s = String(raw || "").trim();
  return s || "—";
}

function failureReason(p: Payment): string | null {
  const raw =
    (p.verify_status && String(p.verify_status).trim()) ||
    (p.response_code && String(p.response_code).trim()) ||
    null;
  if (!raw) return null;
  // Skip opaque success-like codes
  if (/^(success|ok|00|0)$/i.test(raw)) return null;
  return raw;
}

async function postAlert(
  key: ReportAlertKey,
  html: string,
  buttons?: { label: string; url: string }[],
): Promise<boolean> {
  try {
    const settings = await getReportSettings();
    if (!isAlertEnabled(settings, key)) return false;
    const resolved = resolveReportsChannelId(settings);
    const guarded = await assertReportsChannel(resolved);
    if (!guarded.ok || !guarded.id) return false;
    const channel = guarded.id;

    const base = SITE_URL.replace(/\/$/, "") || "https://www.namanias.com";
    const markup = buildKeyboard(
      (buttons || [
        { label: "Dashboard", url: `${base}/admin` },
        { label: "Admissions", url: `${base}/admin/course-payments` },
      ]).map((b) => ({ label: b.label, url: b.url })),
    );

    let lastErr = "";
    for (let i = 0; i < 3; i++) {
      const res = await sendMessage({
        chat_id: channel,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        disable_notification: false,
        reply_markup: markup,
      });
      if (res.ok) {
        await markAlertSent();
        return true;
      }
      lastErr = res.description || "send_failed";
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
    tgLog("report_alert_failed", { key, error: lastErr }, "error");
    return false;
  } catch (e) {
    tgLog("report_alert_error", { key, error: (e as Error).message }, "error");
    return false;
  }
}

async function findEnrollmentForPayment(p: Payment) {
  try {
    const enrs = await getAllCourseEnrollments();
    return (
      enrs.find(
        (e) =>
          isActiveEnrollment(e) &&
          (e.id === p.enrollment_id ||
            ((e.course_slug === p.item_slug || e.course_title === p.item) &&
              (e.phone === p.phone || (!!p.email && e.email === p.email)))),
      ) || null
    );
  } catch {
    return null;
  }
}

/** Seat booked / payment received / full payment from verified PAID chokepoint. */
export async function alertPaymentPaid(p: Payment): Promise<void> {
  if (p.item_type !== "course") return;
  const name = escapeHtml(p.student_name || "Student");
  const course = escapeHtml(p.item || p.item_slug || "Course");
  const when = formatIstShort(p.created_at || new Date().toISOString());
  const amount = inr(p.amount);
  const enr = await findEnrollmentForPayment(p);
  const now = Date.now();
  const der = enr ? deriveEnrollment(enr, now) : null;
  const col = enr ? deriveCollections(enr, now) : null;
  const mode = enr?.batch_label || "—";
  const phone = displayPhone(p.phone || enr?.phone);
  const balance = col ? inr(Math.max(0, (col.remaining ?? der?.remaining) || 0)) : "—";
  const paidSoFar = col ? inr(col.paid) : amount;
  const fee = enr ? inr(Number(enr.total_fee) || null) : "—";

  let courseTotal = "—";
  try {
    const enrs = await getAllCourseEnrollments();
    const same = enrs.filter(
      (e) =>
        isActiveEnrollment(e) &&
        (e.course_slug === p.item_slug || e.course_title === p.item || e.course_id === p.item_slug),
    );
    courseTotal = String(same.length);
  } catch {
    /* ignore */
  }

  if (p.payment_kind === "seat") {
    const phoneDisp = displayPhone(p.phone || enr?.phone);
    const html = [
      `🎉 <b>SEAT BOOKED</b>`,
      `${name} · ${escapeHtml(phoneDisp)}`,
      `${course}`,
      `Mode/batch: ${escapeHtml(String(mode))}`,
      `Paid ${amount} · Fee ${fee} · Balance ${balance}`,
      when,
      `Course admissions: ${courseTotal}`,
    ].join("\n");
    await postAlert("seat_booked", html);
    return;
  }

  if (p.payment_kind === "installment") {
    const inst = p.installment_no != null ? `Inst #${p.installment_no}` : "Installment";
    const html = [
      `💳 <b>PAYMENT RECEIVED</b>`,
      `${name} · ${course}`,
      `${escapeHtml(inst)} · ${amount}`,
      `Paid to date ${paidSoFar} · Balance ${balance}`,
      when,
    ].join("\n");
    await postAlert("full_payment", html);
    if (!der?.isFullyPaid) return;
  }

  if (p.payment_kind === "full" || p.payment_kind === "one_time" || p.payment_kind == null || der?.isFullyPaid) {
    let todayTotal = 0;
    try {
      const pays = await getPayments();
      const today = istTodayYMD();
      todayTotal = pays
        .filter(
          (x) =>
            !x.deleted_at &&
            isPaidStatus(x.status) &&
            istYMD(x.created_at) === today &&
            (x.item_type === "course" || x.item_type === "webinar"),
        )
        .reduce((s, x) => s + (Number(x.amount) || 0), 0);
    } catch {
      todayTotal = Number(p.amount) || 0;
    }
    const html = [
      `✅ <b>FULL PAYMENT</b>`,
      `${name} · ${course}`,
      `${amount} · Fee ${fee}`,
      `Balance ${balance}`,
      when,
      `Collections today: ${inr(todayTotal)}`,
    ].join("\n");
    await postAlert("full_payment", html);
  }
}

export async function alertGatewayFailure(p: Payment): Promise<void> {
  const name = escapeHtml(p.student_name || "Student");
  const phoneDisp = escapeHtml(displayPhone(p.phone));
  const item = escapeHtml(truncItem(p.item || p.item_slug || "Item"));
  const reason = failureReason(p);
  const html = [
    `🚨 <b>PAYMENT FAILED</b>`,
    `${name} · ${phoneDisp}`,
    `${item} · ${inr(p.amount)}`,
    formatIstShort(p.created_at || new Date().toISOString()),
    reason ? `Reason: ${escapeHtml(reason)}` : `Status: ${escapeHtml(String(p.status || "FAILED"))}`,
  ].join("\n");
  await postAlert("gateway_failure", html);
}

function truncItem(s: string, max = 40): string {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Every 25 registrations; call out paid/hot names when available. */
export async function alertWebinarMilestone(regCount: number, webinarTitle: string, webinarId?: string): Promise<void> {
  if (regCount <= 0 || regCount % 25 !== 0) return;
  let hotLines: string[] = [];
  try {
    if (webinarId) {
      const [regs, pays, webs] = await Promise.all([
        getAllWebinarRegistrations(),
        getPayments(),
        getWebinars(),
      ]);
      const w = webs.find((x) => x.id === webinarId);
      const slug = (w?.slug || "").toLowerCase();
      const paidPhones = new Set(
        pays
          .filter(
            (p) =>
              !p.deleted_at &&
              isPaidStatus(p.status) &&
              p.item_type === "webinar" &&
              (p.item_slug || "").toLowerCase() === slug,
          )
          .map((p) => (p.phone || "").toLowerCase())
          .filter(Boolean),
      );
      const mine = regs
        .filter((r) => r.webinar_id === webinarId)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 8);
      for (const r of mine) {
        const key = (r.phone || "").toLowerCase();
        const paid = key && paidPhones.has(key);
        if (paid) {
          hotLines.push(`· ${escapeHtml(r.name || "Student")} · paid`);
        }
      }
    }
  } catch {
    hotLines = [];
  }

  const html = [
    `🎯 <b>WEBINAR +${regCount} REGS</b>`,
    `${escapeHtml(webinarTitle)}`,
    `${regCount} registrations`,
    ...(hotLines.length ? ["Notable:", ...hotLines.slice(0, 5)] : []),
    formatIstShort(new Date()),
  ].join("\n");
  await postAlert("webinar_milestone", html);
}

/**
 * Overdue: daily summary around 10 AM IST, plus immediate alerts at 7d and 30d thresholds.
 */
export async function alertOverdueInstallments(): Promise<{ sent: number }> {
  const settings = await getReportSettings();
  if (!isAlertEnabled(settings, "installment_overdue")) return { sent: 0 };
  const channel = resolveReportsChannelId(settings);
  if (!channel) return { sent: 0 };

  const db = getSupabaseAdmin();
  const enrs = await getAllCourseEnrollments();
  const now = Date.now();
  const parts = istNowParts();
  let sent = 0;

  const overdueRows: { name: string; course: string; amount: number; days: number; id: string }[] = [];
  for (const e of enrs) {
    if (!isActiveEnrollment(e)) continue;
    const col = deriveCollections(e, now);
    if (col.daysOverdue < 1 || col.overdueAmount <= 0) continue;
    overdueRows.push({
      id: e.id,
      name: e.student_name || "Student",
      course: e.course_title || "Course",
      amount: col.overdueAmount,
      days: col.daysOverdue,
    });

    // Immediate threshold alerts at exactly 7 / 30 days
    if (col.daysOverdue === 7 || col.daysOverdue === 30) {
      const dedupeKey = `overdue_threshold:${e.id}:${col.daysOverdue}`;
      let already = false;
      if (db) {
        try {
          const { data } = await db
            .from("telegram_report_snapshots")
            .select("id")
            .eq("slot_key", dedupeKey)
            .maybeSingle();
          already = !!data;
        } catch {
          already = false;
        }
      }
      if (!already) {
        const html = [
          `⏰ <b>${col.daysOverdue}d OVERDUE</b>`,
          `${escapeHtml(e.student_name || "Student")} · ${escapeHtml(e.course_title || "Course")}`,
          `${inr(col.overdueAmount)} · ${col.daysOverdue} days`,
          formatIstShort(new Date()),
        ].join("\n");
        const ok = await postAlert("installment_overdue", html);
        if (ok && db) {
          await db.from("telegram_report_snapshots").upsert(
            { slot_key: dedupeKey, kind: "alert_dedupe", metrics: { days: col.daysOverdue } },
            { onConflict: "slot_key" },
          );
        }
        if (ok) sent++;
      }
    }
  }

  // Daily 10 AM IST summary (window :00–:20 via cron)
  if (parts.hour === 10 && parts.minute <= 20 && overdueRows.length > 0) {
    const dedupeKey = `overdue_daily:${parts.ymd}`;
    let already = false;
    if (db) {
      const { data } = await db.from("telegram_report_snapshots").select("id").eq("slot_key", dedupeKey).maybeSingle();
      already = !!data;
    }
    if (!already) {
      const totalAmt = overdueRows.reduce((s, r) => s + r.amount, 0);
      const top = [...overdueRows].sort((a, b) => b.days - a.days).slice(0, 8);
      const html = [
        `⚠️ <b>OVERDUE DAILY</b>`,
        `${overdueRows.length} students · ${inr(totalAmt)}`,
        ...top.map(
          (r) =>
            `· ${escapeHtml(r.name)} · ${escapeHtml(r.course)} · ${inr(r.amount)} · ${r.days}d`,
        ),
        formatIstShort(new Date()),
      ].join("\n");
      const ok = await postAlert("installment_overdue", html, [
        {
          label: "Collections",
          url: `${(SITE_URL.replace(/\/$/, "") || "https://www.namanias.com")}/admin/at-risk`,
        },
      ]);
      if (ok && db) {
        await db.from("telegram_report_snapshots").upsert(
          { slot_key: dedupeKey, kind: "alert_dedupe", metrics: { count: overdueRows.length } },
          { onConflict: "slot_key" },
        );
      }
      if (ok) sent++;
    }
  }

  return { sent };
}

/** No leads for 6h during business hours (10–20 IST). */
export async function alertNoLeadsIfStale(): Promise<boolean> {
  const settings = await getReportSettings();
  if (!isAlertEnabled(settings, "no_leads_6h")) return false;
  const parts = istNowParts();
  if (parts.hour < 10 || parts.hour >= 20) return false;

  const leads = await getLeads({ includeLegacy: false });
  const newest = leads
    .map((l) => new Date(l.created_at).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a)[0];
  if (!newest) return false;
  const ageH = (Date.now() - newest) / 3600_000;
  if (ageH < 6) return false;

  const dedupeKey = `no_leads:${parts.ymd}:${Math.floor(parts.hour / 6)}`;
  const db = getSupabaseAdmin();
  if (db) {
    const { data } = await db.from("telegram_report_snapshots").select("id").eq("slot_key", dedupeKey).maybeSingle();
    if (data) return false;
  }

  const html = [
    `🕳 <b>NO LEADS FOR 6h</b>`,
    `Last lead ${Math.round(ageH)}h ago`,
    `Possible form / tracking breakage — check Meta + site forms`,
    formatIstShort(new Date()),
  ].join("\n");
  const ok = await postAlert("no_leads_6h", html);
  if (ok && db) {
    await db.from("telegram_report_snapshots").upsert(
      { slot_key: dedupeKey, kind: "alert_dedupe", metrics: { age_h: ageH } },
      { onConflict: "slot_key" },
    );
  }
  return ok;
}

/** No portal logins for 3h during business hours (analytics_events.login). */
export async function alertNoLoginsIfStale(): Promise<boolean> {
  const settings = await getReportSettings();
  if (!isAlertEnabled(settings, "no_logins_3h")) return false;
  const parts = istNowParts();
  if (parts.hour < 10 || parts.hour >= 20) return false;

  const db = getSupabaseAdmin();
  if (!db) return false;

  const sinceIso = new Date(Date.now() - 3 * 3600_000).toISOString();
  const { count, error } = await db
    .from("analytics_events")
    .select("id", { count: "exact", head: true })
    .eq("event_name", "login")
    .gte("occurred_at", sinceIso);
  if (error) {
    tgLog("no_logins_query_failed", { error: error.message }, "warn");
    return false;
  }
  if ((count || 0) > 0) return false;

  const dedupeKey = `no_logins:${parts.ymd}:${Math.floor(parts.hour / 3)}`;
  const { data } = await db.from("telegram_report_snapshots").select("id").eq("slot_key", dedupeKey).maybeSingle();
  if (data) return false;

  const html = [
    `🕳 <b>NO LOGINS (3h+)</b>`,
    `Zero portal login events in the last 3 hours`,
    `Check auth / student portal health`,
    formatIstShort(new Date()),
  ].join("\n");
  const ok = await postAlert("no_logins_3h", html);
  if (ok) {
    await db.from("telegram_report_snapshots").upsert(
      { slot_key: dedupeKey, kind: "alert_dedupe", metrics: { since: sinceIso } },
      { onConflict: "slot_key" },
    );
  }
  return ok;
}

/** 24h before webinar: final registration count. */
export async function alertWebinarReminders24h(): Promise<number> {
  const settings = await getReportSettings();
  if (!isAlertEnabled(settings, "webinar_reminder_24h")) return 0;
  const [webinars, regs] = await Promise.all([getWebinars(), getAllWebinarRegistrations()]);
  const now = Date.now();
  let sent = 0;
  const db = getSupabaseAdmin();

  for (const w of webinars) {
    const t = new Date(w.datetime).getTime();
    if (!Number.isFinite(t)) continue;
    const hours = (t - now) / 3600_000;
    if (hours < 20 || hours > 28) continue;
    const dedupeKey = `webinar_24h:${w.id}`;
    if (db) {
      const { data } = await db.from("telegram_report_snapshots").select("id").eq("slot_key", dedupeKey).maybeSingle();
      if (data) continue;
    }
    const count = regs.filter((r) => r.webinar_id === w.id).length;
    const html = [
      `📣 <b>WEBINAR IN 24h</b>`,
      `${escapeHtml(w.title)}`,
      `Registrations: ${count}`,
      formatIstShort(w.datetime),
    ].join("\n");
    const ok = await postAlert("webinar_reminder_24h", html);
    if (ok && db) {
      await db.from("telegram_report_snapshots").upsert(
        { slot_key: dedupeKey, kind: "alert_dedupe", metrics: { count } },
        { onConflict: "slot_key" },
      );
    }
    if (ok) sent++;
  }
  return sent;
}

/** Fire-and-forget wrappers used from analytics/server + cron. */
export function fireReportPaymentPaid(p: Payment): void {
  void alertPaymentPaid(p).catch(() => {});
}

export function fireReportGatewayFailure(p: Payment): void {
  void alertGatewayFailure(p).catch(() => {});
}

export function fireReportWebinarReg(webinarId: string, webinarTitle?: string | null): void {
  void (async () => {
    const regs = await getAllWebinarRegistrations();
    const count = regs.filter((r) => r.webinar_id === webinarId).length;
    let title = webinarTitle || "Webinar";
    if (!webinarTitle) {
      const webs = await getWebinars();
      title = webs.find((w) => w.id === webinarId)?.title || title;
    }
    await alertWebinarMilestone(count, title, webinarId);
  })().catch(() => {});
}
