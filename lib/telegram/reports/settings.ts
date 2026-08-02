/**
 * Telegram business reports — settings, channel resolution, alert toggles.
 */
import { getSupabaseAdmin } from "../../supabase";

export type DigestFrequency = "2h" | "3h" | "6h" | "daily";

export type ReportAlertKey =
  | "seat_booked"
  | "full_payment"
  | "installment_overdue"
  | "webinar_milestone"
  | "webinar_reminder_24h"
  | "no_leads_6h"
  | "no_logins_3h"
  | "gateway_failure";

export const DEFAULT_ALERTS: Record<ReportAlertKey, boolean> = {
  seat_booked: true,
  full_payment: true,
  installment_overdue: true,
  webinar_milestone: true,
  webinar_reminder_24h: true,
  no_leads_6h: true,
  no_logins_3h: true,
  gateway_failure: true,
};

export interface ReportSettings {
  id: string;
  channel_id: string | null;
  digest_enabled: boolean;
  digest_frequency: DigestFrequency;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  alerts: Record<ReportAlertKey, boolean>;
  last_digest_at: string | null;
  last_digest_error: string | null;
  last_alert_at: string | null;
  updated_at: string;
}

function db() {
  return getSupabaseAdmin();
}

function asAlerts(raw: unknown): Record<ReportAlertKey, boolean> {
  const out = { ...DEFAULT_ALERTS };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const key of Object.keys(DEFAULT_ALERTS) as ReportAlertKey[]) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === "boolean") out[key] = v;
  }
  return out;
}

function mapRow(row: Record<string, unknown>): ReportSettings {
  const freq = String(row.digest_frequency || "2h");
  return {
    id: String(row.id || "default"),
    channel_id: row.channel_id != null ? String(row.channel_id) : null,
    digest_enabled: row.digest_enabled !== false,
    digest_frequency:
      freq === "2h" || freq === "3h" || freq === "6h" || freq === "daily" ? freq : "2h",
    quiet_hours_start:
      row.quiet_hours_start != null && Number.isFinite(Number(row.quiet_hours_start))
        ? Number(row.quiet_hours_start)
        : null,
    quiet_hours_end:
      row.quiet_hours_end != null && Number.isFinite(Number(row.quiet_hours_end))
        ? Number(row.quiet_hours_end)
        : null,
    alerts: asAlerts(row.alerts),
    last_digest_at: row.last_digest_at != null ? String(row.last_digest_at) : null,
    last_digest_error: row.last_digest_error != null ? String(row.last_digest_error) : null,
    last_alert_at: row.last_alert_at != null ? String(row.last_alert_at) : null,
    updated_at: String(row.updated_at || new Date().toISOString()),
  };
}

const FALLBACK: ReportSettings = {
  id: "default",
  channel_id: null,
  digest_enabled: true,
  digest_frequency: "2h",
  quiet_hours_start: null,
  quiet_hours_end: null,
  alerts: { ...DEFAULT_ALERTS },
  last_digest_at: null,
  last_digest_error: null,
  last_alert_at: null,
  updated_at: new Date().toISOString(),
};

export async function getReportSettings(): Promise<ReportSettings> {
  const supabase = db();
  if (!supabase) return { ...FALLBACK, alerts: { ...DEFAULT_ALERTS } };
  const { data } = await supabase.from("telegram_report_settings").select("*").eq("id", "default").maybeSingle();
  if (!data) {
    await supabase.from("telegram_report_settings").upsert({ id: "default" }, { onConflict: "id" });
    return { ...FALLBACK, alerts: { ...DEFAULT_ALERTS } };
  }
  return mapRow(data as Record<string, unknown>);
}

export async function updateReportSettings(
  patch: Partial<{
    channel_id: string | null;
    digest_enabled: boolean;
    digest_frequency: DigestFrequency;
    quiet_hours_start: number | null;
    quiet_hours_end: number | null;
    alerts: Partial<Record<ReportAlertKey, boolean>>;
  }>,
): Promise<ReportSettings> {
  const supabase = db();
  if (!supabase) return getReportSettings();
  const current = await getReportSettings();
  const nextAlerts = { ...current.alerts, ...(patch.alerts || {}) };
  const row = {
    id: "default",
    channel_id: patch.channel_id !== undefined ? patch.channel_id : current.channel_id,
    digest_enabled: patch.digest_enabled !== undefined ? patch.digest_enabled : current.digest_enabled,
    digest_frequency: patch.digest_frequency || current.digest_frequency,
    quiet_hours_start:
      patch.quiet_hours_start !== undefined ? patch.quiet_hours_start : current.quiet_hours_start,
    quiet_hours_end: patch.quiet_hours_end !== undefined ? patch.quiet_hours_end : current.quiet_hours_end,
    alerts: nextAlerts,
    updated_at: new Date().toISOString(),
  };
  await supabase.from("telegram_report_settings").upsert(row, { onConflict: "id" });
  return getReportSettings();
}

export async function markDigestResult(ok: boolean, error?: string | null): Promise<void> {
  const supabase = db();
  if (!supabase) return;
  if (ok) {
    await supabase
      .from("telegram_report_settings")
      .update({
        last_digest_at: new Date().toISOString(),
        last_digest_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", "default");
  } else {
    await supabase
      .from("telegram_report_settings")
      .update({
        last_digest_error: error || "send_failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", "default");
  }
}

export async function markAlertSent(): Promise<void> {
  const supabase = db();
  if (!supabase) return;
  await supabase
    .from("telegram_report_settings")
    .update({ last_alert_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", "default");
}

/** Normalize Telegram channel/supergroup IDs to the form Bot API expects. */
export function normalizeChannelId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  if (!s) return null;
  if (s.startsWith("-100")) return s;
  // Already a negative chat id — keep as-is (do not double-prefix).
  if (/^-\d+$/.test(s)) return s;
  // Bare digits: only auto-prefix -100 for long ids (channel internals are typically ≥10+ after -100).
  // Short ids (≤10) are often mistaken private user chat_ids — leave raw so getChat can diagnose.
  if (/^\d+$/.test(s)) {
    if (s.length >= 11) return `-100${s}`;
    return s;
  }
  return s;
}

/** Resolve channel: settings override, else TELEGRAM_REPORTS_CHANNEL_ID. */
export function resolveReportsChannelId(settings?: ReportSettings | null): string | null {
  const fromSettings = settings?.channel_id?.trim() || "";
  if (fromSettings) return normalizeChannelId(fromSettings);
  const fromEnv = (process.env.TELEGRAM_REPORTS_CHANNEL_ID || "").trim();
  return normalizeChannelId(fromEnv);
}

/** Mask for logs — never print the full channel id in client responses. */
export function maskChannelId(id: string | null): string | null {
  if (!id) return null;
  if (id.length <= 6) return "***";
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function isAlertEnabled(settings: ReportSettings, key: ReportAlertKey): boolean {
  return settings.alerts[key] !== false;
}

/** Quiet hours in IST (inclusive start, exclusive end). Supports overnight wraps. */
export function inQuietHours(settings: ReportSettings, istHour: number): boolean {
  const start = settings.quiet_hours_start;
  const end = settings.quiet_hours_end;
  if (start == null || end == null) return false;
  if (start === end) return false;
  if (start < end) return istHour >= start && istHour < end;
  return istHour >= start || istHour < end;
}

export function digestHoursForFrequency(freq: DigestFrequency): number[] {
  if (freq === "daily") return [6];
  if (freq === "6h") return [0, 6, 12, 18];
  if (freq === "3h") return [0, 6, 9, 12, 15, 18, 21]; // skip 3am
  // 2h: every even hour IST
  return [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];
}
