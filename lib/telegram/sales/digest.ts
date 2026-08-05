/**
 * Sales digest — 10:00 / 15:00 / 20:00 IST. No aggregate revenue figures.
 */
import { getAllCourseEnrollments, getPayments } from "../../dataProvider";
import { isPaidStatus } from "../../paymentsAgg";
import { isActiveEnrollment } from "../../installments";
import { getSupabaseAdmin } from "../../supabase";
import { istTodayYMD, istYMD } from "../../dates";
import { buildKeyboard } from "../botApi";
import { sendToChannel, salesChannelConfigured } from "../channels";
import { tgLog } from "../log";
import { istNowParts } from "../reports/format";
import { SITE_URL } from "../../config";
import { escapeHtml, salesInr } from "./format";
import { salesDigestEnabled } from "./settings";
import { flushSalesQueuedAlerts } from "./send";
import { inSalesQuietHours } from "./dedupe";

const DIGEST_HOURS = [10, 15, 20] as const;

function daysFromNowIso(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export function salesDigestDueNow(d = new Date()): { due: boolean; slot: string | null } {
  if (inSalesQuietHours(d)) return { due: false, slot: null };
  const parts = istNowParts(d);
  // Cron is hourly at :35 — accept window minute 30–50 for the hour.
  if (parts.minute < 30 || parts.minute > 50) return { due: false, slot: null };
  if (!(DIGEST_HOURS as readonly number[]).includes(parts.hour)) return { due: false, slot: null };
  return { due: true, slot: `sales:digest:${parts.ymd}:${parts.hour}` };
}

async function alreadySentSlot(slot: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { data } = await db.from("telegram_report_snapshots").select("id").eq("slot_key", slot).maybeSingle();
  return !!data;
}

async function markSlot(slot: string): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db
    .from("telegram_report_snapshots")
    .upsert({ slot_key: slot, kind: "sales_digest", metrics: { ok: 1 } }, { onConflict: "slot_key" })
    .then(
      () => null,
      () => null,
    );
}

export async function buildSalesDigestHtml(): Promise<string> {
  const today = istTodayYMD();
  const now = Date.now();
  const horizon = daysFromNowIso(7);
  const todayStart = `${today}T00:00:00+05:30`;

  const [pays, enrs] = await Promise.all([getPayments(), getAllCourseEnrollments()]);
  const db = getSupabaseAdmin();

  // New admissions today (seat / full course PAID)
  const admissions = pays.filter(
    (p) =>
      !p.deleted_at &&
      isPaidStatus(p.status) &&
      p.item_type === "course" &&
      (p.payment_kind === "seat" || p.payment_kind === "full" || p.payment_kind == null) &&
      istYMD(p.created_at) === today,
  );
  const admissionLines = admissions.slice(0, 12).map(
    (p) => `· ${escapeHtml(p.student_name || "Student")} · ${escapeHtml(p.item || p.item_slug || "Course")}`,
  );

  // Instalments paid today
  const instPaid = pays.filter(
    (p) =>
      !p.deleted_at &&
      isPaidStatus(p.status) &&
      p.item_type === "course" &&
      p.payment_kind === "installment" &&
      istYMD(p.created_at) === today,
  );
  const instLines = instPaid.slice(0, 12).map(
    (p) =>
      `· ${escapeHtml(p.student_name || "Student")} · Inst ${p.installment_no ?? "?"} · ${escapeHtml(p.item || "Course")}`,
  );

  // Due in next 7 days
  const dueSoon: { name: string; course: string; no: number; amount: number; due: string }[] = [];
  for (const e of enrs) {
    if (!isActiveEnrollment(e)) continue;
    for (const s of e.schedule || []) {
      if (s.paid || !s.due || s.kind === "seat") continue;
      const dueYmd = String(s.due).slice(0, 10);
      if (dueYmd < today || dueYmd > horizon) continue;
      dueSoon.push({
        name: e.student_name || "Student",
        course: e.course_title || "Course",
        no: s.no,
        amount: Number(s.amount) || 0,
        due: dueYmd,
      });
    }
  }
  dueSoon.sort((a, b) => a.due.localeCompare(b.due));
  const dueLines = dueSoon
    .slice(0, 15)
    .map(
      (r) =>
        `· ${escapeHtml(r.name)} · Inst ${r.no} · ${salesInr(r.amount)} · due ${escapeHtml(r.due)}`,
    );

  // Proofs pending review
  let pendingProofs = 0;
  let oldestAgeH: number | null = null;
  if (db) {
    try {
      const { data } = await db
        .from("installment_payment_proofs")
        .select("id,created_at,status")
        .in("status", ["pending", "submitted", "reupload_requested"])
        .order("created_at", { ascending: true })
        .limit(200);
      const rows = data || [];
      pendingProofs = rows.length;
      if (rows[0]?.created_at) {
        oldestAgeH = Math.max(0, Math.round((now - new Date(rows[0].created_at).getTime()) / 3600_000));
      }
    } catch {
      /* optional */
    }
  }

  // Reminders sent today
  let reminders = 0;
  if (db) {
    try {
      const { count } = await db
        .from("student_access_events")
        .select("*", { count: "exact", head: true })
        .eq("event_type", "reminder_sent")
        .gte("created_at", todayStart);
      reminders = count || 0;
    } catch {
      try {
        const { count } = await db
          .from("sms_logs")
          .select("*", { count: "exact", head: true })
          .ilike("template_key", "%access%reminder%")
          .gte("created_at", todayStart);
        reminders = count || 0;
      } catch {
        reminders = 0;
      }
    }
  }

  const parts = istNowParts();
  const lines = [
    `📋 <b>Sales digest</b> · ${escapeHtml(parts.label)}`,
    ``,
    `<b>New admissions today</b>: ${admissions.length}`,
    ...(admissionLines.length ? admissionLines : ["· none"]),
    ``,
    `<b>Instalments paid today</b>: ${instPaid.length}`,
    ...(instLines.length ? instLines : ["· none"]),
    ``,
    `<b>Instalments due in next 7 days</b>: ${dueSoon.length}`,
    ...(dueLines.length ? dueLines : ["· none"]),
    ``,
    `<b>Proofs pending review</b>: ${pendingProofs}${
      oldestAgeH != null ? ` · oldest ${oldestAgeH}h` : ""
    }`,
    ``,
    `<b>Reminders sent today</b>: ${reminders}`,
  ];
  return lines.join("\n");
}

export async function runSalesDigestIfDue(opts?: { force?: boolean }): Promise<{
  ok: boolean;
  sent: boolean;
  slot: string | null;
  flushed: number;
}> {
  try {
    if (!salesChannelConfigured()) return { ok: true, sent: false, slot: null, flushed: 0 };
    if (!(await salesDigestEnabled())) return { ok: true, sent: false, slot: null, flushed: 0 };

    const due = opts?.force
      ? { due: true, slot: `sales:digest:force:${Date.now()}` }
      : salesDigestDueNow();
    if (!due.due || !due.slot) return { ok: true, sent: false, slot: null, flushed: 0 };
    if (!opts?.force && (await alreadySentSlot(due.slot))) {
      return { ok: true, sent: false, slot: due.slot, flushed: 0 };
    }

    // 10:00 slot flushes quiet/rate queue first
    const parts = istNowParts();
    let flushed = 0;
    if (opts?.force || parts.hour === 10) {
      flushed = await flushSalesQueuedAlerts();
    }

    const html = await buildSalesDigestHtml();
    const base = (SITE_URL || "https://www.namanias.com").replace(/\/$/, "");
    const res = await sendToChannel("sales", {
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      disable_notification: true,
      reply_markup: buildKeyboard([
        { label: "Admissions", url: `${base}/admin/course-payments` },
        { label: "Access at Risk", url: `${base}/admin/access-risk` },
      ]),
    });
    if (res.ok && !opts?.force) await markSlot(due.slot);
    return { ok: res.ok, sent: !!res.ok, slot: due.slot, flushed };
  } catch (e) {
    tgLog("sales_digest_failed", { error: (e as Error).message }, "error");
    return { ok: false, sent: false, slot: null, flushed: 0 };
  }
}
