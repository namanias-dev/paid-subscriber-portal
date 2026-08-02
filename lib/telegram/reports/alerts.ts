/**
 * Real-time Telegram business report alerts.
 * Fire-and-forget from payment/registration/cron hooks.
 */
import { SITE_URL } from "../../config";
import { getLeads, getWebinars, getAllWebinarRegistrations, getAllCourseEnrollments } from "../../dataProvider";
import { isPaidStatus } from "../../paymentsAgg";
import { deriveCollections, isActiveEnrollment } from "../../installments";
import { istTodayYMD, istYMD } from "../../dates";
import type { Payment } from "../../types";
import { buildKeyboard, sendMessage } from "../botApi";
import { tgLog } from "../log";
import { escapeHtml, formatIstShort, inr } from "./format";
import {
  getReportSettings,
  isAlertEnabled,
  markAlertSent,
  resolveReportsChannelId,
  type ReportAlertKey,
} from "./settings";
import { getSupabaseAdmin } from "../../supabase";

async function postAlert(key: ReportAlertKey, html: string): Promise<void> {
  try {
    const settings = await getReportSettings();
    if (!isAlertEnabled(settings, key)) return;
    const resolved = resolveReportsChannelId(settings);
    const { assertReportsChannel } = await import("./channelGuard");
    const guarded = await assertReportsChannel(resolved);
    if (!guarded.ok || !guarded.id) return;
    const channel = guarded.id;

    const base = SITE_URL.replace(/\/$/, "") || "https://www.namanias.com";
    let lastErr = "";
    for (let i = 0; i < 3; i++) {
      const res = await sendMessage({
        chat_id: channel,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        disable_notification: false,
        reply_markup: buildKeyboard([
          { label: "Open Dashboard", url: `${base}/admin` },
          { label: "View Admissions", url: `${base}/admin/course-payments` },
        ]),
      });
      if (res.ok) {
        await markAlertSent();
        return;
      }
      lastErr = res.description || "send_failed";
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
    tgLog("report_alert_failed", { key, error: lastErr }, "error");
  } catch (e) {
    tgLog("report_alert_error", { key, error: (e as Error).message }, "error");
  }
}

function modeTimingLabel(p: Payment): string {
  const kind = String(p.payment_kind || "");
  // Prefer batch_label crumbs on related enrollment when available — kept short.
  return kind === "seat" ? "Seat" : kind === "full" ? "Full" : kind === "installment" ? `Inst ${p.installment_no || ""}`.trim() : "Payment";
}

/** Seat booked / full payment alerts from verified PAID chokepoint. */
export async function alertPaymentPaid(p: Payment): Promise<void> {
  if (p.item_type !== "course") return;
  const name = escapeHtml(p.student_name || "Student");
  const course = escapeHtml(p.item || p.item_slug || "Course");
  const when = formatIstShort(p.created_at || new Date().toISOString());
  const amount = inr(p.amount);

  if (p.payment_kind === "seat") {
    let total = "—";
    try {
      const enrs = await getAllCourseEnrollments();
      const n = enrs.filter(
        (e) =>
          isActiveEnrollment(e) &&
          (e.course_slug === p.item_slug || e.course_title === p.item || e.course_id === p.item_slug),
      ).length;
      total = String(n);
    } catch {
      /* ignore */
    }
    const html = [
      `🎉 <b>NEW ADMISSION</b>`,
      `${name} · ${course}`,
      `${escapeHtml(modeTimingLabel(p))} · ${amount} paid`,
      when,
      `Course total: ${total} admissions`,
    ].join("\n");
    await postAlert("seat_booked", html);
    return;
  }

  if (p.payment_kind === "full" || p.payment_kind === "one_time" || p.payment_kind == null) {
    let todayTotal = 0;
    try {
      const { getPayments } = await import("../../dataProvider");
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
      `${amount}`,
      when,
      `Collections today: ${inr(todayTotal)}`,
    ].join("\n");
    await postAlert("full_payment", html);
  }
}

export async function alertGatewayFailure(p: Payment): Promise<void> {
  const name = escapeHtml(p.student_name || "Student");
  const item = escapeHtml(p.item || p.item_slug || "Item");
  const html = [
    `🚨 <b>PAYMENT GATEWAY FAILURE</b>`,
    `${name} · ${item}`,
    `${inr(p.amount)} · ${escapeHtml(String(p.status || "FAILED"))}`,
    formatIstShort(p.created_at || new Date().toISOString()),
    `Revenue at risk — check gateway / bank callback`,
  ].join("\n");
  await postAlert("gateway_failure", html);
}

export async function alertWebinarMilestone(regCount: number, webinarTitle: string): Promise<void> {
  if (regCount <= 0 || regCount % 50 !== 0) return;
  const html = [
    `🎯 <b>WEBINAR MILESTONE</b>`,
    `${escapeHtml(webinarTitle)}`,
    `${regCount} registrations`,
    formatIstShort(new Date()),
  ].join("\n");
  await postAlert("webinar_milestone", html);
}

/** Scan overdue installments (from collections helper — same as Overview). */
export async function alertOverdueInstallments(): Promise<{ sent: number }> {
  const settings = await getReportSettings();
  if (!isAlertEnabled(settings, "installment_overdue")) return { sent: 0 };
  const channel = resolveReportsChannelId(settings);
  if (!channel) return { sent: 0 };

  const db = getSupabaseAdmin();
  const enrs = await getAllCourseEnrollments();
  const now = Date.now();
  let sent = 0;

  for (const e of enrs) {
    if (!isActiveEnrollment(e)) continue;
    const col = deriveCollections(e, now);
    if (col.daysOverdue < 1 || col.overdueAmount <= 0) continue;
    const dedupeKey = `overdue_alert:${e.id}:${col.daysOverdue}`;
    if (db) {
      try {
        const { data } = await db
          .from("telegram_report_snapshots")
          .select("id")
          .eq("slot_key", dedupeKey)
          .maybeSingle();
        if (data) continue;
      } catch {
        /* continue */
      }
    }

    const html = [
      `⏰ <b>INSTALLMENT OVERDUE</b>`,
      `${escapeHtml(e.student_name || "Student")} · ${escapeHtml(e.course_title)}`,
      `${inr(col.overdueAmount)} · ${col.daysOverdue}d overdue`,
      formatIstShort(new Date()),
    ].join("\n");
    await postAlert("installment_overdue", html);
    if (db) {
      await db.from("telegram_report_snapshots").upsert(
        { slot_key: dedupeKey, kind: "alert_dedupe", metrics: { days: col.daysOverdue } },
        { onConflict: "slot_key" },
      );
    }
    sent++;
    if (sent >= 5) break; // rate-limit burst
  }
  return { sent };
}

/** No leads for 6h during business hours (10–20 IST). */
export async function alertNoLeadsIfStale(): Promise<boolean> {
  const settings = await getReportSettings();
  if (!isAlertEnabled(settings, "no_leads_6h")) return false;
  const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false });
  const hour = Number(hourFmt.format(new Date()));
  if (hour < 10 || hour >= 20) return false;

  const leads = await getLeads({ includeLegacy: false });
  const newest = leads
    .map((l) => new Date(l.created_at).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a)[0];
  if (!newest) return false;
  const ageH = (Date.now() - newest) / 3600_000;
  if (ageH < 6) return false;

  const dedupeKey = `no_leads:${istTodayYMD()}:${Math.floor(hour / 6)}`;
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
  await postAlert("no_leads_6h", html);
  if (db) {
    await db.from("telegram_report_snapshots").upsert(
      { slot_key: dedupeKey, kind: "alert_dedupe", metrics: { age_h: ageH } },
      { onConflict: "slot_key" },
    );
  }
  return true;
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
    await postAlert("webinar_reminder_24h", html);
    if (db) {
      await db.from("telegram_report_snapshots").upsert(
        { slot_key: dedupeKey, kind: "alert_dedupe", metrics: { count } },
        { onConflict: "slot_key" },
      );
    }
    sent++;
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
    await alertWebinarMilestone(count, title);
  })().catch(() => {});
}
