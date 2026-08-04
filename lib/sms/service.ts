/**
 * Central SMS service. The ONLY path that talks to the gateway. Order:
 *  1 kill-switch + caps  2 load+gate template  3 render+revalidate (GSM/Rs/155)
 *  4 normalize mobile  5 INSERT log with UNIQUE dedupe_key FIRST (insert-and-
 *  catch-conflict so concurrent serverless triggers can't double-send)
 *  6 call gateway  7 update status  8 never log/return credentials.
 * Fire-and-forget friendly; never throws into a caller.
 */
import { normalizeIndianMobile } from "../phone";
import { getTemplate, getSettings, insertQueuedLog, updateLog, countSentSince, recentSameTemplate, recentTemplateHits, countsByMobileSince, listLogs, isOptedOut, optedOutSet } from "./store";
import { sendViaGateway, sendBulkViaGateway, fetchDeliveryStatuses, checkBalance, type DeliveryLine } from "./gateway";
import { gatewayConfigured, smsEnvEnabled, loginUrlForTemplate, bulkChunkSize, SMS_DEFAULT_SENDER_ID, SMS_DEFAULT_ROUTE } from "./config";
import { getResolvedDefaults } from "./variables";
import { prepareAndRenderSms } from "./renderPipeline";
import type { SmsLog, SmsLogStatus, SmsTemplate } from "./types";
import { isPromoTemplate, nextPromoDispatchAt } from "./promoQuietHours";
import { enqueuePromo } from "./promoQueue";

const SAME_TRIGGER_WINDOW_MIN = 30;
/** Parallel gateway calls in the per-recipient fan-out (keeps 170+ under the 60s function limit). */
const SEND_CONCURRENCY = 10;
/** Parallel DLR pulls when settling delivery (one msg-id per number in a personalized send). */
const DLR_CONCURRENCY = 10;

/** Run `fn` over `items` with bounded concurrency, preserving result order. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface RelatedEntity {
  user_id?: string | null; lead_id?: string | null; registration_id?: string | null;
  payment_id?: string | null; course_id?: string | null; webinar_id?: string | null;
  student_name?: string | null;
}

/**
 * Which installment a reminder is about, persisted on the log so a later payment
 * can be correlated with it. Composite because installments are JSONB elements
 * in course_enrollments.schedule with no stable id of their own; the fingerprint
 * is what keeps the attribution correct across a plan change. Built by
 * ./installmentAttribution.installmentFingerprint.
 */
export interface InstallmentKey {
  courseEnrollmentId: string;
  installmentNo: number;
  fingerprint: string;
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
  /**
   * Drain path only: skip promo quiet-hours gate (message already deferred).
   * Never set from automations / manual / bulk.
   */
  bypassPromoQuietHours?: boolean;
  /** Manual override of the 30-min same-trigger anti-spam guard. */
  allowRecentOverride?: boolean;
  /** Deferred send: gateway "time" format "YYYY-MM-DD HH:MMam/pm" (IST). */
  scheduleTime?: string | null;
  /** Installment this send is about, recorded for reminder→payment correlation. */
  installmentKey?: InstallmentKey | null;
  /** Groups all logs from one bulk job (live status + retry-failed-only). */
  campaignId?: string | null;
}

export interface SendSmsResult {
  ok: boolean;
  skipped?: string;
  error?: string;
  logId?: string;
  status?: SmsLogStatus;
  /** Present when promo was deferred to quiet-hours queue (not a failure). */
  queueId?: string;
  scheduledFor?: string;
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

/**
 * Convert a datetime-local / ISO string (a bare "YYYY-MM-DDTHH:MM" is read as
 * IST wall-clock) into the gateway "time" format "YYYY-MM-DD HH:MMam/pm" (IST).
 * Returns null when unparseable or in the past (fail-closed → immediate send).
 */
export function toGatewayScheduleTime(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s += ":00+05:30"; // treat bare local as IST
  const d = new Date(s);
  if (isNaN(d.getTime()) || d.getTime() < Date.now() - 60000) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: true }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const ap = g("dayPeriod").toLowerCase().includes("p") ? "pm" : "am";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}${ap}`;
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

/**
 * Keys that must ALWAYS come from the recipient, never from a saved override —
 * because they are per-PERSON, not campaign-level. Freezing them to one stored
 * value would misinform students. Two groups:
 *   • identity : name, first_name, login_code (wrong-code safety — Issue 2).
 *   • per-recipient FACTS : amount, payment_status (a saved override would tell
 *     everyone the SAME amount / status — factually wrong per student).
 * Campaign-level vars (item_short, item_name, webinar_time, webinar_date) are
 * the same for the whole send, so an explicit admin override wins for those.
 */
export const RECIPIENT_ONLY_VARS = new Set(["login_code", "name", "first_name", "amount", "payment_status"]);

/**
 * In-memory merge of the editable variable store (global + per-template
 * overrides) with the caller's per-recipient vars, then derived defaults.
 * Precedence, high→low:
 *   1 recipient identity (login_code / name / first_name — always the recipient)
 *   2 explicit admin override (any key present in the store defaults)
 *   3 caller / audience value for keys that have NO override
 *   4 config/env default (via withDerivedVars).
 * WYSIWYG guarantee: when an override exists it is the value actually sent — an
 * audience-derived item_short can no longer silently clobber it. Split out (no
 * DB) so a batch resolves store defaults ONCE and merges each recipient locally.
 */
export function mergeSendVars(templateId: string, defaults: Record<string, string>, vars: Record<string, string | number | null | undefined> = {}): Record<string, string | number | null | undefined> {
  const merged: Record<string, string | number | null | undefined> = { ...defaults };
  for (const [k, val] of Object.entries(vars)) {
    if (val === undefined || val === null || String(val).trim() === "") continue;
    // Identity always follows the recipient; otherwise the caller/audience value
    // only FILLS a key that has no explicit override, so overrides are never lost.
    if (RECIPIENT_ONLY_VARS.has(k) || !(k in defaults)) merged[k] = val;
  }
  return withDerivedVars(templateId, merged);
}

async function resolveSendVars(templateId: string, vars: Record<string, string | number | null | undefined> = {}): Promise<Record<string, string | number | null | undefined>> {
  return mergeSendVars(templateId, await getResolvedDefaults(templateId), vars);
}

export type TemplateGateCode = "TEMPLATE_MISSING" | "TEMPLATE_NOT_APPROVED" | "TEMPLATE_NO_DLT_ID";

export type TemplateGateResult =
  | { ok: true; template: SmsTemplate }
  | { ok: false; code: TemplateGateCode; detail: string };

/** Loud template gate — used by sendSms / sendBatch (not silent skip). */
export function gateSendTemplate(t: SmsTemplate | null, templateId: string): TemplateGateResult {
  if (!t) {
    return { ok: false, code: "TEMPLATE_MISSING", detail: `Template "${templateId}" is not configured.` };
  }
  if (!(t.status === "active" || t.status === "approved")) {
    return {
      ok: false,
      code: "TEMPLATE_NOT_APPROVED",
      detail: `Template "${templateId}" status is "${t.status}" — must be active or approved before sending.`,
    };
  }
  if (!t.gateway_template_id) {
    return {
      ok: false,
      code: "TEMPLATE_NO_DLT_ID",
      detail: `Template "${templateId}" has no gateway_template_id (DLT id).`,
    };
  }
  return { ok: true, template: t };
}

function logTemplateGateFailure(gate: Extract<TemplateGateResult, { ok: false }>, path: string): void {
  console.error(`[SMS] ${gate.code} path=${path} — ${gate.detail}`);
}

/**
 * Render + validate without sending (preview / dispatch dry-run). Runs the SAME
 * hard send guard the send path runs, so a preview can never look sendable when
 * the send would be blocked.
 */
export async function previewSms(templateId: string, vars: Record<string, string | number | null | undefined>): Promise<{ ok: boolean; text: string; missing: string[]; errors: string[]; warnings: string[]; length: number; segments: number; blocked: string | null; gsm: boolean; vars: Record<string, string | number | null | undefined> } | null> {
  const t = await getTemplate(templateId);
  if (!t) return null;
  const filled0 = await resolveSendVars(templateId, vars);
  const rendered = prepareAndRenderSms(t.body_template, templateId, filled0);
  return {
    ok: rendered.ok,
    text: rendered.text,
    missing: rendered.missing,
    errors: rendered.errors,
    warnings: rendered.warnings,
    length: rendered.length,
    segments: rendered.segments,
    blocked: rendered.blocked,
    gsm: rendered.gsm,
    vars: rendered.vars,
  };
}

export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  // 1. kill switch
  const settings = await getSettings();
  if (!smsEnvEnabled() || !settings.enabled) return { ok: false, skipped: "disabled" };

  // 2. template gate
  const tRaw = await getTemplate(input.templateId);
  const gate = gateSendTemplate(tRaw, input.templateId);
  if (!gate.ok) {
    logTemplateGateFailure(gate, "sendSms");
    return { ok: false, skipped: gate.code, error: gate.detail };
  }
  const t = gate.template;
  // No promo route: promotional templates may never go to the "all" audience.
  if (t.message_type === "promotional" && input.audienceType === "all") return { ok: false, skipped: "promotional_all_blocked" };

  // 3. mobile
  const n = normalizeIndianMobile(input.mobile);
  if (!n.ok || !n.digits10) return { ok: false, skipped: "invalid_mobile", error: n.error };
  const normalized = n.digits10;

  // 3b. opt-out / DND suppression — compliance, enforced on EVERY send path.
  if (await isOptedOut(normalized)) return { ok: false, skipped: "opted_out" };

  // 3c. PROMO QUIET HOURS (dispatch-layer, all paths). Transactional untouched.
  // Outside 10:00–21:00 IST (configurable) → enqueue for promoDispatchTime, never drop.
  if (!input.bypassPromoQuietHours && isPromoTemplate(t)) {
    const when = nextPromoDispatchAt(settings, new Date(), {
      jitterSeed: `${t.id}:${normalized}:${input.dedupeKey || ""}`,
    });
    if (when) {
        const enq = await enqueuePromo({
        templateId: t.id,
        mobile: input.mobile,
        normalizedMobile: normalized,
        variables: input.variables || {},
        relatedEntity: input.relatedEntity || null,
        triggerEvent: input.triggerEvent ?? null,
        audienceType: input.audienceType ?? null,
        dedupeKey: input.dedupeKey
          ? `promo_defer:${input.dedupeKey}`
          : `promo_defer:${t.id}:${normalized}:${when.toISOString().slice(0, 13)}`,
        scheduledFor: when,
        sentBy: input.sentBy,
        queueSource: "quiet_hours",
      });
      if (!enq.ok) return { ok: false, skipped: "defer_failed", error: enq.error };
      return {
        ok: true,
        skipped: "deferred_quiet_hours",
        queueId: enq.id,
        scheduledFor: when.toISOString(),
      };
    }
  }

  // 4. render + validate via the SINGLE shared pipeline (preview uses the same).
  const filled0 = await resolveSendVars(input.templateId, input.variables || {});
  const rendered = prepareAndRenderSms(t.body_template, input.templateId, filled0);
  if (rendered.missing.length) return { ok: false, skipped: "missing_vars", error: rendered.missing.join(", ") };
  if (rendered.dltViolations.length) {
    return { ok: false, skipped: "dlt_var_too_long", error: rendered.errors.join("; ") };
  }
  if (rendered.blocked) {
    return { ok: false, skipped: `blocked_${rendered.blocked}`, error: rendered.errors.join("; ") || undefined };
  }
  if (!rendered.ok) return { ok: false, skipped: "invalid_body", error: rendered.errors.join("; ") };
  const text = rendered.text;
  const v = { analysis: { length: rendered.length, segments: rendered.segments } };

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
    campaign_id: input.campaignId ?? null,
    course_enrollment_id: input.installmentKey?.courseEnrollmentId ?? null,
    installment_no: input.installmentKey?.installmentNo ?? null,
    installment_fingerprint: input.installmentKey?.fingerprint ?? null,
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
    templateId: t.gateway_template_id!,
    senderId: t.sender_id || SMS_DEFAULT_SENDER_ID,
    route: t.route || SMS_DEFAULT_ROUTE,
    scheduleTime: input.scheduleTime || undefined,
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

// ---------------------------------------------------------------------------
// BATCH ORCHESTRATOR — auto-selects the correct gateway endpoint per send.
//   • 0/1 eligible                 → single http-api.php (via sendSms)
//   • >1 eligible, IDENTICAL body  → PUSH-BULK http-api.php (chunked, shared id)
//   • >1 eligible, DIFFERING body  → per-recipient single sends (via sendSms)
//     (Customized-SMS endpoint is unavailable on this host — 404 — so personalized
//      content NEVER goes through bulk; it fans out one-per-number instead.)
// ALL safeguards (kill-switch, template gate, caps, per-mobile cap, 30-min guard,
// window) are enforced BEFORE any batching. A pre-batch balance check refuses the
// send when known credits < eligible recipients.
// ---------------------------------------------------------------------------
export interface BatchRecipientInput {
  mobile: string;
  variables?: Record<string, string | number | null | undefined>;
  relatedEntity?: RelatedEntity;
  /** Per-recipient installment attribution — bulk reminders each target their own line. */
  installmentKey?: InstallmentKey | null;
}
export interface BatchResult {
  requested: number;
  sent: number;
  failed: number;
  skipped: Record<string, number>;
  /** Count enqueued to sms_promo_queue (manual schedule or quiet-hours). */
  scheduled: number;
  mode: "single" | "bulk" | "per-recipient" | "none" | "scheduled";
  batches: number;
  balance: number | null;
  /** True when a hard DLT/GSM/skeleton violation aborted the WHOLE batch before any send. */
  aborted?: boolean;
  abortReason?: string | null;
  /** Per-recipient hard violations that caused the abort (never silent). */
  violations?: { mobile: string; reason: string; detail: string; item_short?: string; item_short_len?: number }[];
  /** ISO UTC of the operator-chosen schedule (manual path). */
  scheduledFor?: string | null;
  scheduledForIst?: string | null;
  queueIds?: string[];
}

interface ScreenedRecipient {
  mobile: string;
  normalized: string;
  text: string;
  chars: number;
  segments: number;
  variables: Record<string, string | number | null | undefined>;
  relatedEntity?: RelatedEntity;
  installmentKey?: InstallmentKey | null;
}

export async function sendBatch(input: {
  recipients: BatchRecipientInput[];
  templateId: string;
  sentBy: { userId?: string | null; type: "ADMIN" | "SYSTEM" };
  audienceType?: string | null;
  allowRecentOverride?: boolean;
  enforceWindow?: boolean;
  /** Drain path only — skip promo quiet-hours gate. */
  bypassPromoQuietHours?: boolean;
  /**
   * Manual Mission Control schedule: enqueue to sms_promo_queue at this instant
   * (UTC Date already resolved from IST). When set, never hits the gateway now.
   */
  scheduleFor?: Date | null;
  scheduleTime?: string | null;
  /** Stamps every log in this send so the UI can track per-recipient status + resend-to-failed. */
  campaignId?: string | null;
  /** Recorded on every log in the job (e.g. "manual_installment_reminder"). */
  triggerEvent?: string | null;
}): Promise<BatchResult> {
  const out: BatchResult = {
    requested: input.recipients.length,
    sent: 0,
    failed: 0,
    skipped: {},
    scheduled: 0,
    mode: "none",
    batches: 0,
    balance: null,
    aborted: false,
    abortReason: null,
    violations: [],
    scheduledFor: null,
    scheduledForIst: null,
    queueIds: [],
  };
  const skip = (k: string, n = 1) => { out.skipped[k] = (out.skipped[k] || 0) + n; };

  // ---- global gates (reject whole batch) ----
  const settings = await getSettings();
  if (!smsEnvEnabled() || !settings.enabled) { skip("disabled", input.recipients.length); return out; }
  const tRaw = await getTemplate(input.templateId);
  const gate = gateSendTemplate(tRaw, input.templateId);
  if (!gate.ok) {
    logTemplateGateFailure(gate, "sendBatch");
    skip(gate.code, input.recipients.length);
    out.aborted = true;
    out.abortReason = gate.code;
    return out;
  }
  const t = gate.template;
  if (t.message_type === "promotional" && input.audienceType === "all") { skip("promotional_all_blocked", input.recipients.length); return out; }

  // ---- per-recipient screening (all safeguards BEFORE batching) ----
  // ALL shared lookups are hoisted to ONE query each (variable store defaults,
  // 30-min anti-spam hits, per-mobile daily counts) so screening 170 recipients
  // costs a handful of round-trips, not ~3×170. This is the bulk-timeout fix:
  // the old loop did 2+ sequential DB calls PER recipient (~110s for 170) and the
  // serverless function was killed before any gateway call ever fired.
  const since = istMidnightISO();
  let usedToday = settings.dailyCap > 0 ? await countSentSince(since) : 0;
  const nowMin = istMinutesOfDay();

  // Normalize + in-batch dedupe first so batched lookups only query real targets.
  const normList: { mobile: string; normalized: string; variables: Record<string, string | number | null | undefined>; relatedEntity?: RelatedEntity; installmentKey?: InstallmentKey | null }[] = [];
  const seen = new Set<string>();
  for (const r of input.recipients) {
    const n = normalizeIndianMobile(r.mobile);
    if (!n.ok || !n.digits10) { skip("invalid_mobile"); continue; }
    if (seen.has(n.digits10)) { skip("duplicate_in_batch"); continue; }
    seen.add(n.digits10);
    normList.push({ mobile: r.mobile, normalized: n.digits10, variables: r.variables || {}, relatedEntity: r.relatedEntity, installmentKey: r.installmentKey ?? null });
  }

  const numbers = normList.map((r) => r.normalized);
  const [varDefaults, recentHits, perMobileCounts, optedOut] = await Promise.all([
    getResolvedDefaults(input.templateId),
    input.allowRecentOverride ? Promise.resolve(new Set<string>()) : recentTemplateHits(numbers, input.templateId, SAME_TRIGGER_WINDOW_MIN),
    settings.perMobileDailyCap > 0 ? countsByMobileSince(since, numbers) : Promise.resolve(new Map<string, number>()),
    optedOutSet(numbers),
  ]);

  const eligible: ScreenedRecipient[] = [];
  const hardViolations: NonNullable<BatchResult["violations"]> = [];
  for (const r of normList) {
    // Opt-out / DND suppression — compliance, checked before anything else sends.
    if (optedOut.has(r.normalized)) { skip("opted_out"); continue; }
    // Per-recipient render via the SINGLE shared pipeline (same as preview/sendSms).
    const filled0 = mergeSendVars(input.templateId, varDefaults, r.variables);
    const rendered = prepareAndRenderSms(t.body_template, input.templateId, filled0);
    if (rendered.missing.length || rendered.blocked || rendered.dltViolations.length || !rendered.ok) {
      const reason = rendered.dltViolations.length
        ? "dlt_var_too_long"
        : rendered.missing.length
          ? "missing_vars"
          : rendered.blocked
            ? `blocked_${rendered.blocked}`
            : "invalid_body";
      const item = rendered.vars.item_short != null ? String(rendered.vars.item_short) : undefined;
      hardViolations.push({
        mobile: r.normalized,
        reason,
        detail: rendered.errors.join("; ") || rendered.missing.join(", ") || reason,
        item_short: item,
        item_short_len: item ? [...item].length : undefined,
      });
      console.error(
        `[SMS DLT] BATCH PREFLIGHT FAIL template=${input.templateId} mobile=${r.normalized} reason=${reason}` +
          (item ? ` item_short_len=${[...item].length} item_short="${item}"` : ""),
      );
      continue;
    }
    if (input.enforceWindow && (nowMin < hmToMin(settings.windowStart) || nowMin > hmToMin(settings.windowEnd))) { skip("outside_window"); continue; }
    if (settings.dailyCap > 0 && usedToday >= settings.dailyCap) { skip("daily_cap"); continue; }
    if (settings.perMobileDailyCap > 0 && (perMobileCounts.get(r.normalized) || 0) >= settings.perMobileDailyCap) { skip("per_mobile_cap"); continue; }
    if (recentHits.has(r.normalized)) { skip("recent_duplicate"); continue; }
    usedToday++;
    eligible.push({
      mobile: r.mobile,
      normalized: r.normalized,
      text: rendered.text,
      chars: rendered.length,
      segments: rendered.segments,
      variables: rendered.vars,
      relatedEntity: r.relatedEntity,
      installmentKey: r.installmentKey ?? null,
    });
  }

  // HARD RULE: any DLT / GSM / skeleton violation aborts the WHOLE batch.
  // Never send a partial batch that silently drops violators.
  if (hardViolations.length) {
    out.aborted = true;
    out.abortReason = "preflight_dlt_or_body_violation";
    out.violations = hardViolations;
    skip("batch_aborted_preflight", input.recipients.length);
    console.error(
      `[SMS DLT] BATCH ABORTED template=${input.templateId} violators=${hardViolations.length}/${input.recipients.length} — zero messages sent`,
    );
    return out;
  }
  if (eligible.length === 0) return out;

  // Manual schedule → sms_promo_queue (same claim/drain as quiet-hours). No gateway now.
  if (input.scheduleFor && input.scheduleFor.getTime() > Date.now() - 60_000) {
    const { formatIstScheduleLabel } = await import("./promoQuietHours");
    out.mode = "scheduled";
    out.scheduledFor = input.scheduleFor.toISOString();
    out.scheduledForIst = formatIstScheduleLabel(input.scheduleFor);
    for (let i = 0; i < eligible.length; i++) {
      const r = eligible[i];
      // Small stagger so large batches spread across cron claim windows without
      // jumping ahead of earlier-queued rows (ORDER BY scheduled_for ASC).
      const when = new Date(input.scheduleFor.getTime() + i * 2000);
      const enq = await enqueuePromo({
        templateId: t.id,
        mobile: r.mobile,
        normalizedMobile: r.normalized,
        variables: r.variables,
        relatedEntity: r.relatedEntity || null,
        triggerEvent: input.triggerEvent || "manual_schedule",
        audienceType: input.audienceType ?? null,
        dedupeKey: `manual_sched:${t.id}:${r.normalized}:${input.scheduleFor.toISOString()}:${input.campaignId || "nocampaign"}`,
        scheduledFor: when,
        sentBy: input.sentBy,
        queueSource: "manual",
      });
      if (enq.ok) {
        out.scheduled++;
        if (enq.id) out.queueIds!.push(enq.id);
        if (enq.duplicate) skip("schedule_duplicate");
      } else {
        skip("schedule_enqueue_failed");
      }
    }
    return out;
  }

  // Promo quiet-hours: defer entire eligible set (do not send / do not fail).
  if (!input.bypassPromoQuietHours && isPromoTemplate(t)) {
    const whenBase = nextPromoDispatchAt(settings, new Date(), { jitterMinutes: 0 });
    if (whenBase) {
      for (const r of eligible) {
        const when = nextPromoDispatchAt(settings, new Date(), {
          jitterSeed: `${t.id}:${r.normalized}:${input.campaignId || input.triggerEvent || "batch"}`,
        }) || whenBase;
        const enq = await enqueuePromo({
          templateId: t.id,
          mobile: r.mobile,
          normalizedMobile: r.normalized,
          variables: r.variables,
          relatedEntity: r.relatedEntity || null,
          triggerEvent: input.triggerEvent ?? null,
          audienceType: input.audienceType ?? null,
          dedupeKey: `promo_defer_batch:${t.id}:${r.normalized}:${when.toISOString().slice(0, 10)}:${input.campaignId || "nocampaign"}`,
          scheduledFor: when,
          sentBy: input.sentBy,
          queueSource: "quiet_hours",
        });
        if (enq.ok) { skip("deferred_quiet_hours"); out.scheduled++; }
        else skip("defer_failed");
      }
      return out;
    }
  }

  // ---- pre-batch balance guard (refuse if known credits < recipients) ----
  if (gatewayConfigured()) {
    const bal = await checkBalance(t.route || SMS_DEFAULT_ROUTE);
    if (bal.ok && bal.balance != null) {
      out.balance = bal.balance;
      if (bal.balance < eligible.length) { skip("insufficient_credits", eligible.length); return out; }
    }
  }

  // Build the QUEUED log row for a screened recipient (shared by both branches).
  const queuedLogFor = (e: ScreenedRecipient) => ({
    mobile: e.mobile, normalized_mobile: e.normalized,
    student_name: e.relatedEntity?.student_name ?? null,
    user_id: e.relatedEntity?.user_id ?? null, lead_id: e.relatedEntity?.lead_id ?? null,
    registration_id: e.relatedEntity?.registration_id ?? null, payment_id: e.relatedEntity?.payment_id ?? null,
    course_id: e.relatedEntity?.course_id ?? null, webinar_id: e.relatedEntity?.webinar_id ?? null,
    template_id: t.id, template_name: t.name, gateway_template_id: t.gateway_template_id,
    sender_id: t.sender_id || SMS_DEFAULT_SENDER_ID, route: t.route || SMS_DEFAULT_ROUTE,
    message_body: e.text, character_count: e.chars, segments: e.segments,
    sent_by_user_id: input.sentBy.userId ?? null, sent_by_type: input.sentBy.type,
    trigger_event: input.triggerEvent ?? null, audience_type: input.audienceType ?? null, dedupe_key: null,
    campaign_id: input.campaignId ?? null,
    course_enrollment_id: e.installmentKey?.courseEnrollmentId ?? null,
    installment_no: e.installmentKey?.installmentNo ?? null,
    installment_fingerprint: e.installmentKey?.fingerprint ?? null,
    status: "QUEUED" as const,
  });

  // ---- route: identical body → BULK; else per-recipient fan-out ----
  const allIdentical = eligible.length > 1 && eligible.every((e) => e.text === eligible[0].text);

  if (!allIdentical) {
    // single (1) OR personalized fan-out (customized endpoint unavailable → one
    // http-api.php call per number). Runs with bounded concurrency so 170+
    // recipients complete well within the function limit instead of ~1 call at a
    // time. Screening already enforced every safeguard, so each worker only does
    // INSERT(QUEUED) → send → update for its own recipient (no re-screen / re-read).
    out.mode = eligible.length > 1 ? "per-recipient" : "single";
    out.batches = eligible.length;
    if (!gatewayConfigured()) {
      // Keep the attempt visible: queue + mark FAILED, still bounded-parallel.
      await mapPool(eligible, SEND_CONCURRENCY, async (e) => {
        const inserted = await insertQueuedLog(queuedLogFor(e));
        if (!inserted) { skip("duplicate"); return; }
        await updateLog(inserted.id, { status: "FAILED", error_message: "gateway_not_configured" });
        out.failed++;
      });
      return out;
    }
    await mapPool(eligible, SEND_CONCURRENCY, async (e) => {
      const inserted = await insertQueuedLog(queuedLogFor(e));
      if (!inserted) { skip("duplicate"); return; }
      const res = await sendViaGateway({
        digits10: e.normalized, message: e.text, templateId: t.gateway_template_id!,
        senderId: t.sender_id || SMS_DEFAULT_SENDER_ID, route: t.route || SMS_DEFAULT_ROUTE,
        scheduleTime: input.scheduleTime || undefined,
      });
      await updateLog(inserted.id, {
        status: res.status, gateway_response: res.response as unknown, gateway_message_id: res.messageId,
        error_message: res.ok ? null : (res.response.error || "send_failed"), sent_at: new Date().toISOString(),
      });
      if (res.ok) out.sent++; else out.failed++;
    });
    return out;
  }

  // ---- PUSH-BULK (identical), chunked; shared msg-id per chunk ----
  out.mode = "bulk";
  const message = eligible[0].text;
  const chunkSize = bulkChunkSize();
  for (let i = 0; i < eligible.length; i += chunkSize) {
    const chunk = eligible.slice(i, i + chunkSize);
    // insert QUEUED logs FIRST (double-send guard) before the gateway call —
    // bounded-parallel so a 100-row chunk is ~1s of inserts, not ~30s.
    const inserts = await mapPool(chunk, SEND_CONCURRENCY, (e) => insertQueuedLog(queuedLogFor(e)));
    const rows: { e: ScreenedRecipient; logId: string }[] = [];
    inserts.forEach((inserted, idx) => { if (inserted) rows.push({ e: chunk[idx], logId: inserted.id }); else skip("duplicate"); });
    if (rows.length === 0) continue;
    out.batches++;

    if (!gatewayConfigured()) {
      await mapPool(rows, SEND_CONCURRENCY, async (r) => { await updateLog(r.logId, { status: "FAILED", error_message: "gateway_not_configured" }); out.failed++; });
      continue;
    }

    const bulk = await sendBulkViaGateway({
      digits10List: rows.map((r) => r.e.normalized),
      message,
      templateId: t.gateway_template_id!,
      senderId: t.sender_id || SMS_DEFAULT_SENDER_ID,
      route: t.route || SMS_DEFAULT_ROUTE,
      scheduleTime: input.scheduleTime || undefined,
    });
    // One HTTP response for the chunk: shared msg-id stored on every row so
    // per-number DLR (fetchDeliveryStatuses) can settle each recipient later.
    await mapPool(rows, SEND_CONCURRENCY, async (r) => {
      await updateLog(r.logId, {
        status: bulk.status,
        gateway_response: bulk.response as unknown,
        gateway_message_id: bulk.messageId,
        error_message: bulk.ok ? null : (bulk.response.error || "send_failed"),
        sent_at: new Date().toISOString(),
      });
      if (bulk.ok) out.sent++; else out.failed++;
    });
  }
  return out;
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

  // Group logs by gateway_message_id: a BULK send shares ONE id across many
  // recipients, and its DLR returns one line PER number — so we fetch once per
  // id and settle each recipient by matching its own number line.
  const byMsg = new Map<string, SmsLog[]>();
  for (const l of logs) {
    if (!l.gateway_message_id) continue;
    const arr = byMsg.get(l.gateway_message_id);
    if (arr) arr.push(l); else byMsg.set(l.gateway_message_id, [l]);
  }

  // Fetch each message id's DLR with bounded concurrency: a large per-recipient
  // fan-out produces ONE gateway_message_id per number, so a 190-recipient
  // campaign would otherwise fetch 190 DLRs sequentially and blow the 60s
  // function limit (the live-status endpoint calls this on every poll). Parallel
  // (bounded) keeps it well inside the limit; DLR fetches are independent.
  await mapPool([...byMsg.entries()], DLR_CONCURRENCY, async ([msgId, group]) => {
    const dlr = await fetchDeliveryStatuses(msgId);
    out.checked.push({
      messageId: msgId,
      statusText: dlr.lines.map((x) => `${x.number}:${x.statusText}`).join("; ") || null,
      mapped: dlr.lines[0]?.mapped ?? "UNKNOWN",
    });
    // Lookup error (invalid/not-found id) — leave the logs untouched, don't guess.
    if (!dlr.ok) { out.scanned += group.length; out.unknown += group.length; return; }
    const lineByNum = new Map<string, DeliveryLine>();
    for (const ln of dlr.lines) lineByNum.set(ln.number.slice(-10), ln);
    await mapPool(group, DLR_CONCURRENCY, async (l) => {
      out.scanned++;
      const ln = lineByNum.get(l.normalized_mobile.slice(-10)) || (dlr.lines.length === 1 ? dlr.lines[0] : undefined);
      if (!ln) { out.unknown++; return; } // this recipient not (yet) in the DLR
      const prior = (l.gateway_response && typeof l.gateway_response === "object") ? (l.gateway_response as Record<string, unknown>) : {};
      const patch: Partial<SmsLog> = {
        gateway_response: { ...prior, dlr: { statusText: ln.statusText, mapped: ln.mapped, number: ln.number, at: new Date().toISOString(), source: "pull" } },
      };
      // Truth comes from the DLR status, never from the send's "Submitted Successfully".
      if (ln.mapped === "DELIVERED") { patch.status = "DELIVERED"; out.delivered++; }
      else if (ln.mapped === "SENT") { out.pending++; } // still in-flight ("Submitted") — keep SENT
      else { patch.status = "FAILED"; patch.error_message = l.error_message || `dlr:${ln.statusText}`; out.failed++; } // "Other"/undeliv/etc
      await updateLog(l.id, patch);
    });
  });
  return out;
}

/**
 * Resend a campaign's FAILED messages (from live status OR campaign history).
 * Re-RENDERS each failed recipient through {@link prepareAndRenderSms} (current
 * short-title pipeline) — does NOT replay the stored body, which may still
 * contain a DLT-failing 51-char title. Honours kill-switch, opt-out/DND and the
 * daily cap; intentionally bypasses the 30-min guard (that's the point of a
 * resend). Deduped by number; delivered/sent are never re-touched.
 */
export async function resendCampaignFailed(campaignId: string): Promise<{ resent: number; failed: number; skipped: Record<string, number> }> {
  const out = { resent: 0, failed: 0, skipped: {} as Record<string, number> };
  const bump = (k: string) => { out.skipped[k] = (out.skipped[k] || 0) + 1; };
  const settings = await getSettings();
  if (!smsEnvEnabled() || !settings.enabled) { out.skipped.disabled = 1; return out; }
  if (!gatewayConfigured()) { out.skipped.gateway_not_configured = 1; return out; }

  const { listLogsByCampaign } = await import("./store");
  const { resolveResendMessage } = await import("./resendBody");
  const logs = await listLogsByCampaign(campaignId);
  // one row per failed number (latest wins) — never resend to already delivered/sent
  const delivered = new Set(logs.filter((l) => l.status === "DELIVERED" || l.status === "SENT").map((l) => l.normalized_mobile));
  const failedByNum = new Map<string, SmsLog>();
  for (const l of logs) {
    if (l.status !== "FAILED" || delivered.has(l.normalized_mobile)) continue;
    const prev = failedByNum.get(l.normalized_mobile);
    if (!prev || l.created_at > prev.created_at) failedByNum.set(l.normalized_mobile, l);
  }
  const targets = [...failedByNum.values()];
  if (!targets.length) return out;

  const numbers = targets.map((l) => l.normalized_mobile);
  const [optedOut, usedBase] = await Promise.all([
    optedOutSet(numbers),
    settings.dailyCap > 0 ? countSentSince(istMidnightISO()) : Promise.resolve(0),
  ]);
  let used = usedBase;

  await mapPool(targets, SEND_CONCURRENCY, async (l) => {
    if (optedOut.has(l.normalized_mobile)) { bump("opted_out"); return; }
    if (settings.dailyCap > 0 && used >= settings.dailyCap) { bump("daily_cap"); return; }
    const body = await resolveResendMessage(l);
    if (!body.ok) { bump(body.skip); return; }
    used++;
    const inserted = await insertQueuedLog({
      mobile: l.mobile, normalized_mobile: l.normalized_mobile, student_name: l.student_name,
      user_id: l.user_id, lead_id: l.lead_id, registration_id: l.registration_id, payment_id: l.payment_id,
      course_id: l.course_id, webinar_id: l.webinar_id, template_id: l.template_id || "", template_name: l.template_name || "",
      gateway_template_id: l.gateway_template_id, sender_id: l.sender_id || SMS_DEFAULT_SENDER_ID, route: l.route || SMS_DEFAULT_ROUTE,
      message_body: body.text, character_count: body.length, segments: body.segments,
      sent_by_type: "ADMIN", audience_type: l.audience_type, campaign_id: campaignId, status: "QUEUED",
    });
    if (!inserted) { bump("duplicate"); return; }
    const res = await sendViaGateway({
      digits10: l.normalized_mobile, message: body.text, templateId: l.gateway_template_id || "",
      senderId: l.sender_id || SMS_DEFAULT_SENDER_ID, route: l.route || SMS_DEFAULT_ROUTE,
    });
    await updateLog(inserted.id, {
      status: res.status, gateway_response: res.response as unknown, gateway_message_id: res.messageId,
      error_message: res.ok ? null : (res.response.error || "send_failed"), sent_at: new Date().toISOString(),
    });
    if (res.ok) out.resent++; else out.failed++;
  });
  return out;
}

/**
 * Retry a previously-failed log by RE-RENDERING through the current pipeline
 * (not replaying the stored body — that still embeds the 51-char title for the
 * July 29 abandoned_nudge failures).
 */
export async function retryLog(logId: string): Promise<SendSmsResult> {
  const { getLog } = await import("./store");
  const { resolveResendMessage } = await import("./resendBody");
  const log = await getLog(logId);
  if (!log) return { ok: false, skipped: "log_missing" };
  if (!gatewayConfigured()) return { ok: false, skipped: "gateway_not_configured" };
  const body = await resolveResendMessage(log);
  if (!body.ok) return { ok: false, skipped: body.skip, error: body.detail };
  const res = await sendViaGateway({
    digits10: log.normalized_mobile,
    message: body.text,
    templateId: log.gateway_template_id || "",
    senderId: log.sender_id || SMS_DEFAULT_SENDER_ID,
    route: log.route || SMS_DEFAULT_ROUTE,
  });
  await updateLog(logId, {
    status: res.status,
    gateway_response: res.response as unknown,
    gateway_message_id: res.messageId,
    error_message: res.ok ? null : (res.response.error || "send_failed"),
    // Persist the re-rendered body so the log detail matches what was transmitted.
    message_body: body.text,
    character_count: body.length,
    segments: body.segments,
    sent_at: new Date().toISOString(),
  });
  return { ok: res.ok, logId, status: res.status, error: res.ok ? undefined : "send_failed" };
}
