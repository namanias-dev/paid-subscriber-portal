/**
 * Persistent Telegram send queue with token-bucket rate limiting.
 * Global 25/sec, per-chat 1/sec. 429 → pause_until (never drop). 403 → inactive.
 * Per-recipient HTML personalisation runs on drain (never store pre-rendered once).
 */
import { getSupabaseAdmin } from "../supabase";
import { buildKeyboard, sendMessage, sendPhoto, sendPoll } from "./botApi";
import { prepareOutboundHtml } from "./compose";
import { resolveRecipientVars } from "./recipientVars";
import { markInactive } from "./subscribers";
import type {
  EnqueueSendInput,
  FollowUpStep,
  TelegramButton,
  TelegramPollPayload,
  TelegramSendQueueRow,
} from "./types";

const GLOBAL_PER_SEC = 25;
const PER_CHAT_MS = 1000;
const MAX_DRAIN = 200;

function db() {
  return getSupabaseAdmin();
}

function nowIso() {
  return new Date().toISOString();
}

function asButtons(raw: unknown): TelegramButton[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => {
      if (!b || typeof b !== "object") return null;
      const o = b as Record<string, unknown>;
      const label = String(o.label || "").trim();
      if (!label) return null;
      const url = o.url != null ? String(o.url).trim() : "";
      const callback_data = o.callback_data != null ? String(o.callback_data).trim() : "";
      if (callback_data) return { label, callback_data };
      if (url) return { label, url };
      return null;
    })
    .filter(Boolean) as TelegramButton[];
}

function asPoll(raw: unknown): TelegramPollPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const question = String(o.question || "").trim();
  const options = Array.isArray(o.options)
    ? o.options.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 10)
    : [];
  if (!question || options.length < 2) return null;
  return {
    question,
    options,
    is_anonymous: o.is_anonymous !== false,
    allows_multiple_answers: !!o.allows_multiple_answers,
  };
}

function mapRow(row: Record<string, unknown>): TelegramSendQueueRow {
  return {
    id: String(row.id),
    chat_id: String(row.chat_id),
    subscriber_id: row.subscriber_id != null ? String(row.subscriber_id) : null,
    status: row.status as TelegramSendQueueRow["status"],
    skip_reason: row.skip_reason != null ? String(row.skip_reason) : null,
    body: String(row.body || ""),
    image_url: row.image_url != null ? String(row.image_url) : null,
    buttons: asButtons(row.buttons),
    automation_id: row.automation_id != null ? String(row.automation_id) : null,
    broadcast_id: row.broadcast_id != null ? String(row.broadcast_id) : null,
    follow_up_index: row.follow_up_index != null ? Number(row.follow_up_index) : null,
    attempt: Number(row.attempt || 0),
    max_attempts: Number(row.max_attempts || 3),
    scheduled_at: String(row.scheduled_at),
    pause_until: row.pause_until != null ? String(row.pause_until) : null,
    last_error: row.last_error != null ? String(row.last_error) : null,
    telegram_message_id: row.telegram_message_id != null ? String(row.telegram_message_id) : null,
    metadata: (row.metadata as Record<string, unknown>) || {},
    created_at: String(row.created_at),
    sent_at: row.sent_at != null ? String(row.sent_at) : null,
    parse_mode: row.parse_mode != null ? String(row.parse_mode) : "HTML",
    kind: row.kind != null ? String(row.kind) : "message",
    poll: asPoll(row.poll),
    rendered_body: row.rendered_body != null ? String(row.rendered_body) : null,
  };
}

function needsPersonalisation(body: string, metadata: Record<string, unknown>): boolean {
  if (metadata.template || metadata.fallbacks) return true;
  return /\{\{/.test(body || "");
}

export async function enqueueSend(input: EnqueueSendInput): Promise<string | null> {
  const supabase = db();
  if (!supabase) return null;
  const row = {
    chat_id: String(input.chat_id),
    subscriber_id: input.subscriber_id || null,
    status: input.status || "queued",
    skip_reason: input.skip_reason || null,
    body: input.body || "",
    image_url: input.image_url || null,
    buttons: input.buttons || [],
    automation_id: input.automation_id || null,
    broadcast_id: input.broadcast_id || null,
    follow_up_index: input.follow_up_index ?? null,
    scheduled_at: input.scheduled_at || nowIso(),
    metadata: input.metadata || {},
    attempt: 0,
    max_attempts: 3,
    parse_mode: input.parse_mode || "HTML",
    kind: input.kind || "message",
    poll: input.poll || null,
  };
  const { data, error } = await supabase.from("telegram_send_queue").insert(row).select("id").single();
  if (error || !data) return null;
  return String((data as { id: string }).id);
}

export async function enqueueBroadcast(opts: {
  broadcastId: string;
  reachable: { chat_id: string; subscriber_id: string; name?: string | null; phone?: string | null }[];
  skippedPhones: string[];
  body: string;
  image_url?: string | null;
  buttons?: TelegramButton[];
  scheduled_at?: string | null;
  fallbacks?: Record<string, string>;
  kind?: string;
  poll?: TelegramPollPayload | null;
  parse_mode?: string;
  question_key?: string | null;
  lead_field?: string | null;
}): Promise<{ enqueued: number; skipped: number }> {
  const supabase = db();
  if (!supabase) return { enqueued: 0, skipped: 0 };
  const scheduledAt = opts.scheduled_at || nowIso();
  let enqueued = 0;
  let skipped = 0;
  const kind = opts.kind || "message";
  const fallbacks = opts.fallbacks || {};

  const CHUNK = 100;
  for (let i = 0; i < opts.reachable.length; i += CHUNK) {
    const slice = opts.reachable.slice(i, i + CHUNK);
    const rows = slice.map((r) => ({
      chat_id: r.chat_id,
      subscriber_id: r.subscriber_id,
      status: "queued",
      body: opts.body,
      image_url: opts.image_url || null,
      buttons: opts.buttons || [],
      broadcast_id: opts.broadcastId,
      scheduled_at: scheduledAt,
      metadata: {
        name: r.name || null,
        phone: r.phone || null,
        fallbacks,
        template: true,
        question_key: opts.question_key || null,
        lead_field: opts.lead_field || null,
      },
      attempt: 0,
      max_attempts: 3,
      parse_mode: opts.parse_mode || "HTML",
      kind,
      poll: kind === "poll" ? opts.poll || null : null,
    }));
    const { error } = await supabase.from("telegram_send_queue").insert(rows);
    if (!error) enqueued += rows.length;
  }

  for (let i = 0; i < opts.skippedPhones.length; i += CHUNK) {
    const slice = opts.skippedPhones.slice(i, i + CHUNK);
    const rows = slice.map((phone) => ({
      chat_id: `skip:${phone}`,
      status: "skipped",
      skip_reason: "skipped_no_telegram",
      body: opts.body,
      image_url: opts.image_url || null,
      buttons: opts.buttons || [],
      broadcast_id: opts.broadcastId,
      scheduled_at: scheduledAt,
      metadata: { phone, fallbacks },
      attempt: 0,
      max_attempts: 0,
      parse_mode: opts.parse_mode || "HTML",
      kind,
      poll: kind === "poll" ? opts.poll || null : null,
    }));
    const { error } = await supabase.from("telegram_send_queue").insert(rows);
    if (!error) skipped += rows.length;
  }

  return { enqueued, skipped };
}

export async function scheduleFollowUps(opts: {
  chatId: string;
  subscriberId?: string | null;
  automationId: string;
  followUps: FollowUpStep[];
  vars?: Record<string, string | number | null | undefined>;
  baseBodyRender: (body: string) => string;
}): Promise<void> {
  const steps = opts.followUps || [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const delayH = Math.max(0, Number(step.delay_hours) || 0);
    const scheduled = new Date(Date.now() + delayH * 3600 * 1000).toISOString();
    await enqueueSend({
      chat_id: opts.chatId,
      subscriber_id: opts.subscriberId,
      body: opts.baseBodyRender(step.body || ""),
      image_url: step.image_url || null,
      buttons: step.buttons || [],
      automation_id: opts.automationId,
      follow_up_index: i,
      scheduled_at: scheduled,
      metadata: {
        stop_if_replied: !!step.stop_if_replied,
        stop_if_converted: !!step.stop_if_converted,
        vars: opts.vars || {},
      },
    });
  }
}

async function shouldSkipFollowUp(row: TelegramSendQueueRow): Promise<boolean> {
  const meta = row.metadata || {};
  if (!meta.stop_if_replied && !row.automation_id) return false;
  const supabase = db();
  if (!supabase) return false;

  if (meta.stop_if_replied || row.follow_up_index != null) {
    const { data: auto } = row.automation_id
      ? await supabase
          .from("telegram_automations")
          .select("stop_on_reply")
          .eq("id", row.automation_id)
          .maybeSingle()
      : { data: null };
    const stopReply = !!(meta.stop_if_replied || (auto as { stop_on_reply?: boolean } | null)?.stop_on_reply);
    if (stopReply) {
      const { count } = await supabase
        .from("telegram_messages")
        .select("id", { count: "exact", head: true })
        .eq("chat_id", row.chat_id)
        .eq("direction", "inbound")
        .gt("created_at", row.created_at);
      if ((count || 0) > 0) return true;
    }
  }
  return false;
}

async function bumpBroadcastCounters(
  broadcastId: string | null,
  field: "sent_count" | "failed_count" | "blocked_count" | "skipped_count",
): Promise<void> {
  if (!broadcastId) return;
  const supabase = db();
  if (!supabase) return;
  try {
    const { data } = await supabase
      .from("telegram_broadcasts")
      .select(field)
      .eq("id", broadcastId)
      .maybeSingle();
    if (!data) return;
    const cur = Number((data as Record<string, unknown>)[field] || 0);
    await supabase
      .from("telegram_broadcasts")
      .update({ [field]: cur + 1 })
      .eq("id", broadcastId);
  } catch {
    /* ignore */
  }
}

async function logOutboundMessage(opts: {
  chatId: string;
  subscriberId: string | null;
  body: string;
  telegramMessageId: string | null;
}): Promise<void> {
  const supabase = db();
  if (!supabase) return;
  try {
    await supabase.from("telegram_messages").insert({
      chat_id: opts.chatId,
      subscriber_id: opts.subscriberId,
      direction: "outbound",
      body: opts.body,
      telegram_message_id: opts.telegramMessageId,
      is_read: true,
      metadata: { source: "queue" },
    });
  } catch {
    /* ignore */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function prepareRowBody(row: TelegramSendQueueRow): Promise<{ html: string; overLimit: boolean }> {
  const meta = row.metadata || {};
  const fallbacks =
    meta.fallbacks && typeof meta.fallbacks === "object"
      ? (meta.fallbacks as Record<string, string>)
      : {};

  if (!needsPersonalisation(row.body, meta)) {
    // Still sanitize/escape path if body was already prepared; strip leftover tokens.
    const prepared = prepareOutboundHtml(row.body, {}, fallbacks, { hasImage: !!row.image_url });
    return { html: prepared.html, overLimit: prepared.overLimit };
  }

  const vars = await resolveRecipientVars({
    chatId: row.chat_id,
    subscriberId: row.subscriber_id,
    nameHint: meta.name != null ? String(meta.name) : null,
    phoneHint: meta.phone != null ? String(meta.phone) : null,
  });
  // Merge any precomputed vars from metadata without overwriting real recipient data with empty.
  if (meta.vars && typeof meta.vars === "object") {
    for (const [k, v] of Object.entries(meta.vars as Record<string, unknown>)) {
      if (v != null && String(v).trim() && String(v).toLowerCase() !== "undefined") {
        vars[k] = String(v);
      }
    }
  }

  const prepared = prepareOutboundHtml(row.body, vars, fallbacks, { hasImage: !!row.image_url });
  return { html: prepared.html, overLimit: prepared.overLimit };
}

/**
 * Cheap idle check for cron early-exit: any queued-due or unpausable row.
 * Does not claim or mutate.
 */
export async function hasDueTelegramQueueWork(): Promise<boolean> {
  const supabase = db();
  if (!supabase) return false;
  const now = nowIso();
  const { data: queued } = await supabase
    .from("telegram_send_queue")
    .select("id")
    .eq("status", "queued")
    .lte("scheduled_at", now)
    .limit(1);
  if (queued && queued.length > 0) return true;
  const { data: paused } = await supabase
    .from("telegram_send_queue")
    .select("id")
    .eq("status", "paused")
    .lte("pause_until", now)
    .limit(1);
  return !!(paused && paused.length > 0);
}

export async function drainTelegramQueue(opts: { limit?: number } = {}): Promise<{
  processed: number;
  sent: number;
  failed: number;
  blocked: number;
  skipped: number;
  paused: number;
}> {
  const stats = { processed: 0, sent: 0, failed: 0, blocked: 0, skipped: 0, paused: 0 };
  const supabase = db();
  if (!supabase) return stats;

  const limit = Math.min(MAX_DRAIN, Math.max(1, opts.limit || 100));
  const now = nowIso();

  try {
    await supabase
      .from("telegram_send_queue")
      .update({ status: "queued", pause_until: null })
      .eq("status", "paused")
      .lte("pause_until", now);
  } catch {
    /* ignore */
  }

  const { data: due } = await supabase
    .from("telegram_send_queue")
    .select("*")
    .eq("status", "queued")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(limit);

  const rows = ((due || []) as Record<string, unknown>[]).map(mapRow);
  if (!rows.length) return stats;

  const lastSentByChat = new Map<string, number>();
  let globalWindowStart = Date.now();
  let globalCount = 0;

  for (const row of rows) {
    stats.processed++;

    if (row.chat_id.startsWith("skip:")) {
      stats.skipped++;
      continue;
    }

    try {
      if (await shouldSkipFollowUp(row)) {
        await supabase
          .from("telegram_send_queue")
          .update({ status: "skipped", skip_reason: "stopped_on_reply", sent_at: nowIso() })
          .eq("id", row.id);
        stats.skipped++;
        await bumpBroadcastCounters(row.broadcast_id, "skipped_count");
        continue;
      }
    } catch {
      /* continue to send */
    }

    const last = lastSentByChat.get(row.chat_id) || 0;
    const waitChat = PER_CHAT_MS - (Date.now() - last);
    if (waitChat > 0) await sleep(waitChat);

    const elapsed = Date.now() - globalWindowStart;
    if (elapsed >= 1000) {
      globalWindowStart = Date.now();
      globalCount = 0;
    }
    if (globalCount >= GLOBAL_PER_SEC) {
      await sleep(Math.max(0, 1000 - elapsed));
      globalWindowStart = Date.now();
      globalCount = 0;
    }

    // --- Poll path ---
    if (row.kind === "poll" && row.poll) {
      const result = await sendPoll({
        chat_id: row.chat_id,
        question: row.poll.question,
        options: row.poll.options,
        is_anonymous: row.poll.is_anonymous !== false,
        allows_multiple_answers: !!row.poll.allows_multiple_answers,
      });
      globalCount++;
      lastSentByChat.set(row.chat_id, Date.now());

      if (result.ok) {
        const msgId = result.result?.message_id != null ? String(result.result.message_id) : null;
        const pollId = result.result?.poll?.id != null ? String(result.result.poll.id) : null;
        await supabase
          .from("telegram_send_queue")
          .update({
            status: "sent",
            telegram_message_id: msgId,
            sent_at: nowIso(),
            last_error: null,
            rendered_body: row.poll.question,
            metadata: { ...row.metadata, poll_id: pollId },
          })
          .eq("id", row.id);
        await logOutboundMessage({
          chatId: row.chat_id,
          subscriberId: row.subscriber_id,
          body: row.poll.question,
          telegramMessageId: msgId,
        });
        stats.sent++;
        await bumpBroadcastCounters(row.broadcast_id, "sent_count");
        continue;
      }

      // Fall through to shared error handling below via result variable
      await handleSendFailure(supabase, row, result, stats, now);
      if (result.isRateLimited || result.error_code === 429) break;
      continue;
    }

    // --- Message / question path with personalisation ---
    const prepared = await prepareRowBody(row);
    // Safety: never enqueue/send raw tokens (prepareOutboundHtml should already strip them).
    if (prepared.overLimit || /\{\{/.test(prepared.html)) {
      await supabase
        .from("telegram_send_queue")
        .update({
          status: "failed",
          last_error: prepared.overLimit ? "over_char_limit" : "unresolved_tokens",
          sent_at: nowIso(),
          rendered_body: prepared.html,
        })
        .eq("id", row.id);
      stats.failed++;
      await bumpBroadcastCounters(row.broadcast_id, "failed_count");
      continue;
    }

    const markup = buildKeyboard(row.buttons);
    let result;
    if (row.image_url) {
      result = await sendPhoto({
        chat_id: row.chat_id,
        photo: row.image_url,
        caption: prepared.html || undefined,
        parse_mode: "HTML",
        reply_markup: markup,
      });
    } else {
      result = await sendMessage({
        chat_id: row.chat_id,
        text: prepared.html || "(empty)",
        parse_mode: "HTML",
        reply_markup: markup,
        disable_web_page_preview: true,
      });
    }

    globalCount++;
    lastSentByChat.set(row.chat_id, Date.now());

    if (result.ok) {
      const msgId = result.result?.message_id != null ? String(result.result.message_id) : null;
      await supabase
        .from("telegram_send_queue")
        .update({
          status: "sent",
          telegram_message_id: msgId,
          sent_at: nowIso(),
          last_error: null,
          rendered_body: prepared.html,
        })
        .eq("id", row.id);
      await logOutboundMessage({
        chatId: row.chat_id,
        subscriberId: row.subscriber_id,
        body: prepared.html,
        telegramMessageId: msgId,
      });
      stats.sent++;
      await bumpBroadcastCounters(row.broadcast_id, "sent_count");
      continue;
    }

    await handleSendFailure(supabase, row, result, stats, now);
    if (result.isRateLimited || result.error_code === 429) break;
  }

  return stats;
}

async function handleSendFailure(
  supabase: NonNullable<ReturnType<typeof db>>,
  row: TelegramSendQueueRow,
  result: {
    isBlocked?: boolean;
    isRateLimited?: boolean;
    error_code?: number;
    description?: string;
    retryAfterSec?: number;
  },
  stats: { failed: number; blocked: number; paused: number },
  now: string,
): Promise<void> {
  if (result.isBlocked || result.error_code === 403) {
    await markInactive(row.chat_id, "blocked_bot");
    await supabase
      .from("telegram_send_queue")
      .update({
        status: "blocked",
        last_error: result.description || "blocked",
        sent_at: nowIso(),
      })
      .eq("id", row.id);
    stats.blocked++;
    await bumpBroadcastCounters(row.broadcast_id, "blocked_count");
    return;
  }

  if (result.isRateLimited || result.error_code === 429) {
    const retryAfter = Math.max(1, result.retryAfterSec || 1);
    const pauseUntil = new Date(Date.now() + retryAfter * 1000).toISOString();
    await supabase
      .from("telegram_send_queue")
      .update({
        status: "paused",
        pause_until: pauseUntil,
        last_error: result.description || "rate_limited",
      })
      .eq("id", row.id);
    try {
      await supabase
        .from("telegram_send_queue")
        .update({ status: "paused", pause_until: pauseUntil })
        .eq("status", "queued")
        .lte("scheduled_at", now);
    } catch {
      /* ignore */
    }
    stats.paused++;
    return;
  }

  const attempt = row.attempt + 1;
  if (attempt < row.max_attempts) {
    const backoffSec = Math.min(300, Math.pow(2, attempt) * 2);
    const nextAt = new Date(Date.now() + backoffSec * 1000).toISOString();
    await supabase
      .from("telegram_send_queue")
      .update({
        status: "queued",
        attempt,
        scheduled_at: nextAt,
        last_error: result.description || "transient_error",
      })
      .eq("id", row.id);
  } else {
    await supabase
      .from("telegram_send_queue")
      .update({
        status: "failed",
        attempt,
        last_error: result.description || "failed",
        sent_at: nowIso(),
      })
      .eq("id", row.id);
    stats.failed++;
    await bumpBroadcastCounters(row.broadcast_id, "failed_count");
  }
}
