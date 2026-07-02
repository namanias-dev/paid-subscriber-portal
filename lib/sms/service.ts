/**
 * Central SMS service. The ONLY path that talks to the gateway. Order:
 *  1 kill-switch + caps  2 load+gate template  3 render+revalidate (GSM/Rs/155)
 *  4 normalize mobile  5 INSERT log with UNIQUE dedupe_key FIRST (insert-and-
 *  catch-conflict so concurrent serverless triggers can't double-send)
 *  6 call gateway  7 update status  8 never log/return credentials.
 * Fire-and-forget friendly; never throws into a caller.
 */
import { normalizeIndianMobile } from "../phone";
import { renderTemplate, validateBody } from "./templates";
import { getTemplate, getSettings, insertQueuedLog, updateLog, countSentSince, recentSameTemplate, listLogs } from "./store";
import { sendViaGateway, fetchDeliveryStatus } from "./gateway";
import { gatewayConfigured, smsEnvEnabled, loginUrlForTemplate, SMS_DEFAULT_SENDER_ID, SMS_DEFAULT_ROUTE } from "./config";
import type { SmsLog, SmsLogStatus } from "./types";

const SAME_TRIGGER_WINDOW_MIN = 30;

export interface RelatedEntity {
  user_id?: string | null; lead_id?: string | null; registration_id?: string | null;
  payment_id?: string | null; course_id?: string | null; webinar_id?: string | null;
  student_name?: string | null;
}

export interface SendSmsInput {
  mobile: string;
  templateId: string;
  variables?: Record<string, string | number | null | undefined>;
  relatedEntity?: RelatedEntity;
  sentBy: { userId?: string | null; type: "ADMIN" | "SYSTEM" };
  triggerEvent?: string | null;
  audienceType?: string | null;
  dedupeKey?: string | null;
  /** Cron auto-sends enforce the allowed IST window; manual sends do not. */
  enforceWindow?: boolean;
  /** Manual override of the 30-min same-trigger anti-spam guard. */
  allowRecentOverride?: boolean;
}

export interface SendSmsResult {
  ok: boolean;
  skipped?: string;
  error?: string;
  logId?: string;
  status?: SmsLogStatus;
}

function istMidnightISO(): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(`${ymd}T00:00:00+05:30`).toISOString();
}

/** Current IST minutes-of-day. */
export function istMinutesOfDay(d = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return h * 60 + m;
}

function hmToMin(hm: string): number {
  const [h, m] = (hm || "0:0").split(":").map((x) => Number(x) || 0);
  return h * 60 + m;
}

/** Fill in safe defaults (first_name from name; login_url from template). */
export function withDerivedVars(templateId: string, vars: Record<string, string | number | null | undefined> = {}): Record<string, string | number | null | undefined> {
  const out = { ...vars };
  if ((out.first_name === undefined || out.first_name === null || out.first_name === "") && out.name) {
    out.first_name = String(out.name).trim().split(/\s+/)[0];
  }
  if (out.login_url === undefined || out.login_url === null || out.login_url === "") {
    out.login_url = loginUrlForTemplate(templateId);
  }
  return out;
}

/** Render + validate without sending (preview / dispatch dry-run). */
export async function previewSms(templateId: string, vars: Record<string, string | number | null | undefined>): Promise<{ ok: boolean; text: string; missing: string[]; errors: string[]; warnings: string[]; length: number; segments: number } | null> {
  const t = await getTemplate(templateId);
  if (!t) return null;
  const filled = withDerivedVars(templateId, vars);
  const { text, missing } = renderTemplate(t.body_template, filled);
  const v = validateBody(text);
  return { ok: v.ok && missing.length === 0, text, missing, errors: v.errors, warnings: v.warnings, length: v.analysis.length, segments: v.analysis.segments };
}

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  // 1. kill switch
  const settings = await getSettings();
  if (!smsEnvEnabled() || !settings.enabled) return { ok: false, skipped: "disabled" };

  // 2. template gate
  const t = await getTemplate(input.templateId);
  if (!t) return { ok: false, skipped: "template_missing" };
  if (!(t.status === "active" || t.status === "approved")) return { ok: false, skipped: "not_approved" };
  if (!t.gateway_template_id) return { ok: false, skipped: "no_dlt_id" };
  // No promo route: promotional templates may never go to the "all" audience.
  if (t.message_type === "promotional" && input.audienceType === "all") return { ok: false, skipped: "promotional_all_blocked" };

  // 3. mobile
  const n = normalizeIndianMobile(input.mobile);
  if (!n.ok || !n.digits10) return { ok: false, skipped: "invalid_mobile", error: n.error };
  const normalized = n.digits10;

  // 4. render + validate
  const filled = withDerivedVars(input.templateId, input.variables || {});
  const { text, missing } = renderTemplate(t.body_template, filled);
  if (missing.length) return { ok: false, skipped: "missing_vars", error: missing.join(", ") };
  const v = validateBody(text);
  if (!v.ok) return { ok: false, skipped: "invalid_body", error: v.errors.join("; ") };

  // 5. window (cron autos only)
  if (input.enforceWindow) {
    const now = istMinutesOfDay();
    if (now < hmToMin(settings.windowStart) || now > hmToMin(settings.windowEnd)) return { ok: false, skipped: "outside_window" };
  }

  // 6. caps + anti-spam (HARD — bulk runs sequentially so each prior send in the
  // batch is already counted/logged before the next cap check below).
  const since = istMidnightISO();
  if (settings.dailyCap > 0 && (await countSentSince(since)) >= settings.dailyCap) return { ok: false, skipped: "daily_cap" };
  if (settings.perMobileDailyCap > 0 && (await countSentSince(since, normalized)) >= settings.perMobileDailyCap) return { ok: false, skipped: "per_mobile_cap" };
  // 30-min same-template guard applies to BOTH auto and manual sends. Manual
  // callers may pass allowRecentOverride to deliberately re-send.
  if (!input.allowRecentOverride && (await recentSameTemplate(normalized, input.templateId, SAME_TRIGGER_WINDOW_MIN))) {
    return { ok: false, skipped: "recent_duplicate" };
  }

  // 7. INSERT log first (UNIQUE dedupe_key) — this is the double-send guard
  const inserted = await insertQueuedLog({
    mobile: input.mobile,
    normalized_mobile: normalized,
    student_name: input.relatedEntity?.student_name ?? null,
    user_id: input.relatedEntity?.user_id ?? null,
    lead_id: input.relatedEntity?.lead_id ?? null,
    registration_id: input.relatedEntity?.registration_id ?? null,
    payment_id: input.relatedEntity?.payment_id ?? null,
    course_id: input.relatedEntity?.course_id ?? null,
    webinar_id: input.relatedEntity?.webinar_id ?? null,
    template_id: t.id,
    template_name: t.name,
    gateway_template_id: t.gateway_template_id,
    sender_id: t.sender_id || SMS_DEFAULT_SENDER_ID,
    route: t.route || SMS_DEFAULT_ROUTE,
    message_body: text,
    character_count: v.analysis.length,
    segments: v.analysis.segments,
    sent_by_user_id: input.sentBy.userId ?? null,
    sent_by_type: input.sentBy.type,
    trigger_event: input.triggerEvent ?? null,
    audience_type: input.audienceType ?? null,
    dedupe_key: input.dedupeKey ?? null,
    status: "QUEUED",
  });
  if (!inserted) return { ok: false, skipped: "duplicate" };

  // 8. gateway not configured -> mark FAILED but keep the queued attempt visible
  if (!gatewayConfigured()) {
    await updateLog(inserted.id, { status: "FAILED", error_message: "gateway_not_configured" });
    return { ok: false, skipped: "gateway_not_configured", logId: inserted.id, status: "FAILED" };
  }

  // 9. send
  const res = await sendViaGateway({
    digits10: normalized,
    message: text,
    templateId: t.gateway_template_id,
    senderId: t.sender_id || SMS_DEFAULT_SENDER_ID,
    route: t.route || SMS_DEFAULT_ROUTE,
  });
  await updateLog(inserted.id, {
    status: res.status,
    gateway_response: res.response as unknown,
    gateway_message_id: res.messageId,
    error_message: res.ok ? null : (res.response.error || "send_failed"),
    sent_at: new Date().toISOString(),
  });
  return { ok: res.ok, logId: inserted.id, status: res.status, error: res.ok ? undefined : (res.response.error || "send_failed") };
}

export interface PollDlrResult {
  scanned: number;
  delivered: number;
  failed: number;
  pending: number;
  unknown: number;
  checked: { messageId: string; statusText: string | null; mapped: SmsLogStatus }[];
}

/**
 * PULL delivery reports for open (SENT) logs via http-dlr.php and promote each
 * log to DELIVERED/FAILED using JustGoSMS's REAL status. Terminal statuses set
 * the log status; "Submitted"/"Other" are recorded raw but leave the log SENT so
 * we never overclaim. Reuses updateLog — no parallel write path. Idempotent.
 */
export async function pollDeliveryStatuses(opts: { sinceDays?: number; limit?: number; messageIds?: string[] } = {}): Promise<PollDlrResult> {
  const out: PollDlrResult = { scanned: 0, delivered: 0, failed: 0, pending: 0, unknown: 0, checked: [] };
  if (!gatewayConfigured()) return out;

  let logs: SmsLog[];
  if (opts.messageIds?.length) {
    const { findLogsByMessageIds } = await import("./store");
    logs = await findLogsByMessageIds(opts.messageIds);
  } else {
    const since = new Date(Date.now() - (opts.sinceDays ?? 3) * 86400000).toISOString();
    logs = (await listLogs({ from: since, status: "SENT", limit: opts.limit ?? 500 })).filter((l) => l.gateway_message_id);
  }

  for (const l of logs) {
    if (!l.gateway_message_id) continue;
    out.scanned++;
    const dlr = await fetchDeliveryStatus(l.gateway_message_id);
    out.checked.push({ messageId: l.gateway_message_id, statusText: dlr.statusText, mapped: dlr.mapped });
    // Lookup error (invalid/not-found id) — leave the log untouched, don't guess.
    if (!dlr.ok) { out.unknown++; continue; }
    const prior = (l.gateway_response && typeof l.gateway_response === "object") ? (l.gateway_response as Record<string, unknown>) : {};
    const patch: Partial<SmsLog> = {
      gateway_response: { ...prior, dlr: { statusText: dlr.statusText, mapped: dlr.mapped, number: dlr.number, at: new Date().toISOString(), source: "pull" } },
    };
    // Truth comes from the DLR status, never from the send's "Submitted Successfully".
    if (dlr.mapped === "DELIVERED") { patch.status = "DELIVERED"; out.delivered++; }
    else if (dlr.mapped === "SENT") { out.pending++; } // still in-flight ("Submitted") — keep SENT
    else { patch.status = "FAILED"; patch.error_message = l.error_message || `dlr:${dlr.statusText}`; out.failed++; } // "Other"/undeliv/etc = not delivered
    await updateLog(l.id, patch);
  }
  return out;
}

/** Retry a previously-failed log by re-sending its stored body (new attempt). */
export async function retryLog(logId: string): Promise<SendSmsResult> {
  const { getLog } = await import("./store");
  const log = await getLog(logId);
  if (!log) return { ok: false, skipped: "log_missing" };
  if (!gatewayConfigured()) return { ok: false, skipped: "gateway_not_configured" };
  const res = await sendViaGateway({
    digits10: log.normalized_mobile,
    message: log.message_body,
    templateId: log.gateway_template_id || "",
    senderId: log.sender_id || SMS_DEFAULT_SENDER_ID,
    route: log.route || SMS_DEFAULT_ROUTE,
  });
  await updateLog(logId, {
    status: res.status,
    gateway_response: res.response as unknown,
    gateway_message_id: res.messageId,
    error_message: res.ok ? null : (res.response.error || "send_failed"),
    sent_at: new Date().toISOString(),
  });
  return { ok: res.ok, logId, status: res.status, error: res.ok ? undefined : "send_failed" };
}
