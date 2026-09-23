/**
 * Month-end Telegram business report. Same channel and bot as the daily digest.
 * One snapshot per calendar month (`monthly:YYYY-MM`) so cron retries do not
 * double-send. Failures are logged and never thrown into the digest.
 */
import { SITE_URL } from "../../config";
import { getAllCourseEnrollments, getPayments } from "../../dataProvider";
import { computeAdmissions, computeCollections } from "../../analytics/businessMetrics";
import { loadPeopleMetrics, loadReportExclusions } from "../../analytics/loadBusinessMetrics";
import { buildKeyboard, sendMessage } from "../botApi";
import { tgLog } from "../log";
import { monthlyBusinessHtml, packTelegramMessages } from "./businessFormat";
import { loadSmsDelivery } from "../../analytics/loadSmsDelivery";
import { assertReportsChannel } from "./channelGuard";
import { resolveMonthlyReportSlot } from "./monthlySchedule";
import { getSnapshotBySlot, saveSnapshot } from "./snapshots";
import {
  getReportSettings,
  inQuietHours,
  resolveReportsChannelId,
} from "./settings";

async function sendHtml(
  chatId: string,
  text: string,
): Promise<{ ok: boolean; error?: string; messageId?: number }> {
  const base = SITE_URL.replace(/\/$/, "") || "https://www.namanias.com";
  const markup = buildKeyboard([
    { label: "Dashboard", url: `${base}/admin` },
    { label: "Outstanding fees", url: `${base}/admin/at-risk` },
    { label: "Admissions", url: `${base}/admin/course-payments` },
  ]);
  let lastErr = "send_failed";
  for (let i = 0; i < 3; i++) {
    const res = await sendMessage({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      disable_notification: false,
      reply_markup: markup,
    });
    if (res.ok) return { ok: true, messageId: res.result?.message_id };
    lastErr = res.description || `error_${res.error_code || "unknown"}`;
    tgLog("monthly_report_send_retry", { attempt: i + 1, error: lastErr }, "warn");
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  return { ok: false, error: lastErr };
}

export async function maybeRunMonthlyBusinessReport(opts?: {
  force?: boolean;
  now?: Date;
}): Promise<{ ok: boolean; ran: boolean; reason?: string; slotKey?: string; messageId?: number }> {
  const settings = await getReportSettings();
  if (!settings.digest_enabled && !opts?.force) {
    return { ok: true, ran: false, reason: "digest_disabled" };
  }

  const now = opts?.now || new Date();
  const due = resolveMonthlyReportSlot(now, (hour) => !opts?.force && inQuietHours(settings, hour));
  if (!due) return { ok: true, ran: false, reason: "not_due" };

  if (!opts?.force) {
    const existing = await getSnapshotBySlot(due.slotKey);
    if (existing) return { ok: true, ran: false, reason: "already_sent", slotKey: due.slotKey };
  }

  const resolved = resolveReportsChannelId(settings);
  const guarded = await assertReportsChannel(resolved);
  if (!guarded.ok || !guarded.id) {
    return { ok: false, ran: false, reason: guarded.error || "channel_not_configured", slotKey: due.slotKey };
  }

  try {
    const [payments, enrollments, exclusions] = await Promise.all([
      getPayments(),
      getAllCourseEnrollments(),
      loadReportExclusions(),
    ]);
    const money = computeCollections(payments, due.window, exclusions.staffPhones);
    const admissions = computeAdmissions(enrollments, due.window, exclusions.staffPhones);
    const [people, sms] = await Promise.all([
      loadPeopleMetrics(due.window, exclusions),
      loadSmsDelivery(due.window, exclusions.staffPhones),
    ]);
    const html = monthlyBusinessHtml({
      label: due.label,
      people,
      money,
      admissions,
      sms,
    });
    const parts = packTelegramMessages(html.split("\n"));
    let sent: { ok: boolean; error?: string; messageId?: number } = { ok: false, error: "empty" };
    for (const part of parts) {
      sent = await sendHtml(guarded.id, part);
      if (!sent.ok) break;
    }
    if (!sent.ok) {
      tgLog("monthly_report_send_failed", { slot: due.slotKey, error: sent.error || "send_failed" }, "error");
      return { ok: false, ran: false, reason: sent.error || "send_failed", slotKey: due.slotKey };
    }
    await saveSnapshot({
      slotKey: opts?.force ? `${due.slotKey}:manual:${Date.now()}` : due.slotKey,
      kind: "monthly",
      metrics: {
        net: money.netCollection,
        gross: money.grossCollection,
        refunds: money.refundAmount,
        payments: money.successfulPayments,
        paying_students: money.payingStudents,
        admissions: admissions.admissions,
        message_id: sent.messageId ?? null,
      },
      messageHtml: html,
    });
    tgLog("monthly_report_sent", { slot: due.slotKey, messageId: sent.messageId ?? null });
    return { ok: true, ran: true, slotKey: due.slotKey, messageId: sent.messageId };
  } catch (e) {
    const msg = (e as Error).message || "monthly_build_failed";
    tgLog("monthly_report_build_failed", { slot: due.slotKey, error: msg }, "error");
    return { ok: false, ran: false, reason: msg, slotKey: due.slotKey };
  }
}
