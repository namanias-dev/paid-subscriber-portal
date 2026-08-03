/**
 * Deferred promo SMS queue (quiet-hours). Persist → claim → send once.
 * Drain is hooked from the existing sms-dispatch cron (no second scheduler).
 */
import { getSupabaseAdmin } from "../supabase";
import { isOptedOut } from "./store";
import { sendSms, type RelatedEntity, type SendSmsInput } from "./service";
import { isPaidStatus } from "../paymentsAgg";
import { normalizeIndianMobile } from "../phone";

export type PromoQueueStatus = "pending" | "claimed" | "sent" | "cancelled" | "skipped" | "failed";

export type PromoQueueSource = "manual" | "quiet_hours" | "recovery";

export interface PromoQueueRow {
  id: string;
  template_id: string;
  mobile: string;
  normalized_mobile: string;
  variables: Record<string, string | number | null | undefined>;
  related_entity: RelatedEntity | null;
  trigger_event: string | null;
  audience_type: string | null;
  dedupe_key: string | null;
  scheduled_for: string;
  status: PromoQueueStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  cancel_reason: string | null;
  skip_reason: string | null;
  sent_by_type: "ADMIN" | "SYSTEM";
  sent_by_user_id: string | null;
  source_failed_log_id: string | null;
  sent_log_id: string | null;
  queue_source: PromoQueueSource | null;
  claimed_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnqueuePromoInput {
  templateId: string;
  mobile: string;
  normalizedMobile: string;
  variables?: Record<string, string | number | null | undefined>;
  relatedEntity?: RelatedEntity | null;
  triggerEvent?: string | null;
  audienceType?: string | null;
  dedupeKey?: string | null;
  scheduledFor: Date;
  sentBy: { userId?: string | null; type: "ADMIN" | "SYSTEM" };
  sourceFailedLogId?: string | null;
  queueSource?: PromoQueueSource | null;
}

function rowToQueue(r: Record<string, unknown>): PromoQueueRow {
  return {
    id: String(r.id),
    template_id: String(r.template_id),
    mobile: String(r.mobile),
    normalized_mobile: String(r.normalized_mobile),
    variables: (r.variables as Record<string, string | number | null | undefined>) || {},
    related_entity: (r.related_entity as RelatedEntity) || null,
    trigger_event: (r.trigger_event as string) ?? null,
    audience_type: (r.audience_type as string) ?? null,
    dedupe_key: (r.dedupe_key as string) ?? null,
    scheduled_for: String(r.scheduled_for),
    status: r.status as PromoQueueStatus,
    attempts: Number(r.attempts) || 0,
    max_attempts: Number(r.max_attempts) || 3,
    last_error: (r.last_error as string) ?? null,
    cancel_reason: (r.cancel_reason as string) ?? null,
    skip_reason: (r.skip_reason as string) ?? null,
    sent_by_type: (r.sent_by_type as "ADMIN" | "SYSTEM") || "SYSTEM",
    sent_by_user_id: (r.sent_by_user_id as string) ?? null,
    source_failed_log_id: (r.source_failed_log_id as string) ?? null,
    sent_log_id: (r.sent_log_id as string) ?? null,
    queue_source: (r.queue_source as PromoQueueSource) ?? null,
    claimed_at: (r.claimed_at as string) ?? null,
    finished_at: (r.finished_at as string) ?? null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

/** Insert deferred promo. Unique on dedupe_key — duplicate returns existing pending/claimed/sent. */
export async function enqueuePromo(input: EnqueuePromoInput): Promise<{ ok: boolean; id?: string; duplicate?: boolean; error?: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, error: "no_db" };
  const dedupe =
    input.dedupeKey ||
    `promo_defer:${input.templateId}:${input.normalizedMobile}:${input.scheduledFor.toISOString().slice(0, 13)}`;
  const payload = {
    template_id: input.templateId,
    mobile: input.mobile,
    normalized_mobile: input.normalizedMobile,
    variables: input.variables || {},
    related_entity: input.relatedEntity || null,
    trigger_event: input.triggerEvent ?? null,
    audience_type: input.audienceType ?? null,
    dedupe_key: dedupe,
    scheduled_for: input.scheduledFor.toISOString(),
    status: "pending",
    sent_by_type: input.sentBy.type,
    sent_by_user_id: input.sentBy.userId ?? null,
    source_failed_log_id: input.sourceFailedLogId ?? null,
    queue_source: input.queueSource ?? null,
  };
  const { data, error } = await db.from("sms_promo_queue").insert(payload).select("id").maybeSingle();
  if (error) {
    // Unique violation → already queued / sent for this dedupe.
    if (String(error.code) === "23505" || /duplicate|unique/i.test(error.message || "")) {
      const { data: existing } = await db.from("sms_promo_queue").select("id").eq("dedupe_key", dedupe).maybeSingle();
      return { ok: true, id: existing ? String(existing.id) : undefined, duplicate: true };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data ? String(data.id) : undefined };
}

export async function countPendingPromo(): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) return 0;
  const { count } = await db.from("sms_promo_queue").select("id", { count: "exact", head: true }).eq("status", "pending");
  return count || 0;
}

/** Cheap peek: any pending row with scheduled_for <= now (does not claim). */
export async function hasDuePromoQueueWork(): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { data } = await db
    .from("sms_promo_queue")
    .select("id")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .limit(1);
  return !!(data && data.length > 0);
}

export async function listPromoQueue(opts?: {
  status?: PromoQueueStatus | PromoQueueStatus[];
  limit?: number;
}): Promise<PromoQueueRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  let q = db.from("sms_promo_queue").select("*").order("scheduled_for", { ascending: true }).limit(opts?.limit ?? 200);
  if (opts?.status) {
    const s = Array.isArray(opts.status) ? opts.status : [opts.status];
    q = q.in("status", s);
  }
  const { data } = await q;
  return (data || []).map((r) => rowToQueue(r as Record<string, unknown>));
}

export async function cancelPromoQueue(id: string, reason = "cancelled_by_admin"): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { data } = await db
    .from("sms_promo_queue")
    .update({
      status: "cancelled",
      cancel_reason: reason,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  return !!data;
}

/** Reschedule a pending row. Never touches non-pending rows. */
export async function reschedulePromoQueue(id: string, scheduledFor: Date): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { data } = await db
    .from("sms_promo_queue")
    .update({
      scheduled_for: scheduledFor.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  return !!data;
}

async function finishQueue(
  id: string,
  patch: Partial<{ status: PromoQueueStatus; skip_reason: string; last_error: string; sent_log_id: string }>,
): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db
    .from("sms_promo_queue")
    .update({ ...patch, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);
}

async function requeueOrFail(row: PromoQueueRow, err: string): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  if (row.attempts >= row.max_attempts) {
    await finishQueue(row.id, { status: "failed", last_error: err });
    return;
  }
  // Back to pending for next sweep (small backoff).
  await db
    .from("sms_promo_queue")
    .update({
      status: "pending",
      last_error: err,
      claimed_at: null,
      scheduled_for: new Date(Date.now() + 5 * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "claimed");
}

/** Skip if lead row gone (when lead_id present). */
async function leadMissing(leadId: string | null | undefined): Promise<boolean> {
  if (!leadId) return false;
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { data } = await db.from("leads").select("id").eq("id", leadId).maybeSingle();
  return !data;
}

/** Already converted = any PAID payment on this mobile. */
async function alreadyConverted(digits10: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { data } = await db.from("payments").select("id, status").eq("phone", digits10).limit(40);
  return (data || []).some((p) => isPaidStatus(String(p.status) as Parameters<typeof isPaidStatus>[0]));
}

/** Already delivered/sent this template successfully (any time). */
async function alreadyReceivedTemplate(digits10: string, templateId: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { data } = await db
    .from("sms_logs")
    .select("id")
    .eq("normalized_mobile", digits10)
    .eq("template_id", templateId)
    .in("status", ["SENT", "DELIVERED"])
    .limit(1);
  return !!(data && data.length);
}

/**
 * Claim due rows and send with bypassPromoQuietHours.
 * Atomic claim via RPC; double sweep cannot double-send.
 * Pacing: sequential sends with ~350ms gap; claim limit caps burst size.
 */
export async function drainPromoQueue(opts?: { limit?: number; gapMs?: number }): Promise<{
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  cancelled: number;
}> {
  const db = getSupabaseAdmin();
  const out = { claimed: 0, sent: 0, skipped: 0, failed: 0, cancelled: 0 };
  if (!db) return out;
  const limit = Math.max(1, Math.min(opts?.limit ?? 20, 50));
  const gapMs = opts?.gapMs ?? 350;

  const { data: claimed, error } = await db.rpc("sms_promo_queue_claim", { p_limit: limit });
  if (error || !claimed) {
    if (error) console.error("[sms_promo_queue] claim failed", error.message);
    return out;
  }
  const rows = (claimed as Record<string, unknown>[]).map(rowToQueue);
  out.claimed = rows.length;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      if (await isOptedOut(row.normalized_mobile)) {
        await finishQueue(row.id, { status: "skipped", skip_reason: "opted_out" });
        out.skipped++;
        continue;
      }
      if (await leadMissing(row.related_entity?.lead_id)) {
        await finishQueue(row.id, { status: "skipped", skip_reason: "lead_deleted" });
        out.skipped++;
        continue;
      }
      if (await alreadyConverted(row.normalized_mobile)) {
        await finishQueue(row.id, { status: "skipped", skip_reason: "already_converted" });
        out.skipped++;
        continue;
      }
      if (await alreadyReceivedTemplate(row.normalized_mobile, row.template_id)) {
        await finishQueue(row.id, { status: "skipped", skip_reason: "already_received" });
        out.skipped++;
        continue;
      }

      const input: SendSmsInput = {
        mobile: row.mobile,
        templateId: row.template_id,
        variables: row.variables,
        relatedEntity: row.related_entity || undefined,
        sentBy: { type: row.sent_by_type, userId: row.sent_by_user_id },
        triggerEvent: row.trigger_event,
        audienceType: row.audience_type,
        dedupeKey: row.dedupe_key || `promo_drain:${row.id}`,
        bypassPromoQuietHours: true,
        allowRecentOverride: true,
      };
      const res = await sendSms(input);
      if (res.ok) {
        await finishQueue(row.id, { status: "sent", sent_log_id: res.logId });
        out.sent++;
      } else if (res.skipped === "duplicate" || res.skipped === "recent_duplicate") {
        await finishQueue(row.id, { status: "skipped", skip_reason: res.skipped });
        out.skipped++;
      } else if (res.skipped === "opted_out") {
        await finishQueue(row.id, { status: "skipped", skip_reason: "opted_out" });
        out.skipped++;
      } else {
        await requeueOrFail(row, res.error || res.skipped || "send_failed");
        out.failed++;
      }
    } catch (e) {
      await requeueOrFail(row, (e as Error).message || "exception");
      out.failed++;
    }
    if (i < rows.length - 1 && gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
  }
  return out;
}

/** Build a recovery dedupe key for a failed log requeue. */
export function recoveryDedupeKey(templateId: string, digits10: string, sourceLogId: string): string {
  return `promo_recover:${templateId}:${digits10}:${sourceLogId}`;
}

export function normalizeForQueue(mobile: string): string | null {
  const n = normalizeIndianMobile(mobile);
  return n.ok && n.digits10 ? n.digits10 : null;
}
