/**
 * Mission Control read-models. Counts come straight from sms_logs (so the
 * dashboard reconciles to Logs exactly). The conversion view JOINS sms_logs to
 * payments/registrations by phone and is clearly labelled correlation, not
 * attribution.
 */
import { listLogs, getSettings } from "./store";
import { smsEnvEnabled } from "./config";
import { getPayments } from "../dataProvider";
import { isPaidStatus, dedupePaidRows } from "../paymentsAgg";
import { normalizeIndianMobile } from "../phone";
import type { SmsLog } from "./types";

function istMidnightISO(): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(`${ymd}T00:00:00+05:30`).toISOString();
}
function norm(p: string | null | undefined): string | null {
  const n = normalizeIndianMobile(p);
  return n.ok && n.digits10 ? n.digits10 : null;
}
function dayKeyIST(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
const isSent = (s: string) => s === "SENT" || s === "DELIVERED";

export interface SmsOverview {
  killSwitch: { enabledByEnv: boolean; enabledBySettings: boolean; effectiveOn: boolean };
  today: { sent: number; delivered: number; failed: number; queued: number; total: number };
  dailyCap: { used: number; cap: number };
  byTemplate: { template: string; name: string; count: number }[];
  byTrigger: { auto: number; manual: number };
  trend24h: { hour: string; sent: number; failed: number }[];
  recentFailures: SmsLog[];
}

export async function getOverview(): Promise<SmsOverview> {
  const settings = await getSettings();
  const since = istMidnightISO();
  const today = await listLogs({ from: since, limit: 5000 });
  const sent = today.filter((l) => l.status === "SENT").length;
  const delivered = today.filter((l) => l.status === "DELIVERED").length;
  const failed = today.filter((l) => l.status === "FAILED").length;
  const queued = today.filter((l) => l.status === "QUEUED").length;

  const tMap = new Map<string, { name: string; count: number }>();
  for (const l of today) {
    const k = l.template_id || "—";
    const e = tMap.get(k) || { name: l.template_name || k, count: 0 };
    e.count++; tMap.set(k, e);
  }
  const byTemplate = [...tMap.entries()].map(([template, v]) => ({ template, name: v.name, count: v.count })).sort((a, b) => b.count - a.count);

  const auto = today.filter((l) => l.sent_by_type === "SYSTEM").length;
  const manual = today.filter((l) => l.sent_by_type === "ADMIN").length;

  // last 24h hourly trend
  const last24 = await listLogs({ from: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), limit: 5000 });
  const hours: { hour: string; sent: number; failed: number }[] = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(Date.now() - i * 3600 * 1000);
    const label = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(d) + ":00";
    hours.push({ hour: label, sent: 0, failed: 0 });
  }
  for (const l of last24) {
    const hLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(new Date(l.created_at)) + ":00";
    const bucket = hours.find((h) => h.hour === hLabel);
    if (bucket) { if (isSent(l.status)) bucket.sent++; else if (l.status === "FAILED") bucket.failed++; }
  }

  return {
    killSwitch: { enabledByEnv: smsEnvEnabled(), enabledBySettings: settings.enabled, effectiveOn: smsEnvEnabled() && settings.enabled },
    today: { sent, delivered, failed, queued, total: today.length },
    dailyCap: { used: sent + delivered, cap: settings.dailyCap },
    byTemplate,
    byTrigger: { auto, manual },
    trend24h: hours,
    recentFailures: today.filter((l) => l.status === "FAILED").slice(0, 10),
  };
}

export interface SmsAnalytics {
  days: number;
  sendsOverTime: { day: string; sent: number; failed: number }[];
  deliveryByTemplate: { template: string; name: string; total: number; sent: number; rate: number }[];
  correlation: { inviteSent: number; inviteThenRegistered: number; t19Sent: number; t19ThenEnrolled: number };
  cost: { segments: number; ratePerSegment: number; estimate: number };
}

const INVITE_TEMPLATES = new Set(["sameday_10am_invite", "general_webinar_invite"]);

export async function getSmsAnalytics(days = 30, ratePerSegment = 0.2): Promise<SmsAnalytics> {
  const from = new Date(Date.now() - days * 86400000).toISOString();
  const logs = await listLogs({ from, limit: 5000 });

  const dayMap = new Map<string, { sent: number; failed: number }>();
  let segments = 0;
  const tMap = new Map<string, { name: string; total: number; sent: number }>();
  for (const l of logs) {
    const day = dayKeyIST(l.created_at);
    const e = dayMap.get(day) || { sent: 0, failed: 0 };
    if (isSent(l.status)) e.sent++; else if (l.status === "FAILED") e.failed++;
    dayMap.set(day, e);
    if (isSent(l.status)) segments += l.segments || 1;
    const k = l.template_id || "—";
    const t = tMap.get(k) || { name: l.template_name || k, total: 0, sent: 0 };
    t.total++; if (isSent(l.status)) t.sent++; tMap.set(k, t);
  }
  const sendsOverTime = [...dayMap.entries()].map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day));
  const deliveryByTemplate = [...tMap.entries()].map(([template, v]) => ({ template, name: v.name, total: v.total, sent: v.sent, rate: v.total ? Math.round((v.sent / v.total) * 100) : 0 })).sort((a, b) => b.total - a.total);

  // correlation (NOT attribution): phone-join SMS -> later conversion
  const payments = await getPayments();
  const paidCourse = new Map<string, number>(); // phone -> earliest paid course time
  for (const p of dedupePaidRows(payments.filter((x) => isPaidStatus(x.status) && x.item_type === "course"))) {
    const d = norm(p.phone); if (d) paidCourse.set(d, Math.min(paidCourse.get(d) ?? Infinity, new Date(p.created_at).getTime()));
  }
  const anyPaid = new Map<string, number>();
  for (const p of payments.filter((x) => isPaidStatus(x.status))) { const d = norm(p.phone); if (d) anyPaid.set(d, Math.min(anyPaid.get(d) ?? Infinity, new Date(p.created_at).getTime())); }

  let inviteSent = 0, inviteThenRegistered = 0, t19Sent = 0, t19ThenEnrolled = 0;
  for (const l of logs) {
    if (!isSent(l.status)) continue;
    const sentMs = new Date(l.created_at).getTime();
    const d = l.normalized_mobile;
    if (INVITE_TEMPLATES.has(l.template_id || "")) {
      inviteSent++;
      const paidMs = anyPaid.get(d);
      if (paidMs && paidMs >= sentMs) inviteThenRegistered++;
    }
    if (l.template_id === "post_webinar_thankyou") {
      t19Sent++;
      const cMs = paidCourse.get(d);
      if (cMs && cMs >= sentMs) t19ThenEnrolled++;
    }
  }

  return {
    days,
    sendsOverTime,
    deliveryByTemplate,
    correlation: { inviteSent, inviteThenRegistered, t19Sent, t19ThenEnrolled },
    cost: { segments, ratePerSegment, estimate: Math.round(segments * ratePerSegment * 100) / 100 },
  };
}
