import type { ActionActor } from "../adminGuard";
import { logAdminActivity } from "../adminActivity";
import { SITE_URL } from "../config";
import { getSupabaseAdmin } from "../supabase";
import type { PhoneAudienceId } from "../adminPhoneAudiences";
import { resolvePhoneAudience } from "../adminPhoneAudiences";
import { listAnswersForBroadcast, pollResults } from "./answers";
import { resolveTelegramAudience } from "./audiences";
import { prepareOutboundHtml } from "./compose";
import { enqueueBroadcast, enqueueSend } from "./queue";
import { SAMPLE_VARS } from "./render";
import type {
  TelegramBroadcast,
  TelegramBroadcastKind,
  TelegramButton,
  TelegramPollPayload,
} from "./types";

function db() {
  return getSupabaseAdmin();
}

function siteBase(): string {
  return (SITE_URL || "https://www.namanias.com").replace(/\/$/, "");
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

function asFallbacks(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (v != null) out[k] = String(v);
  }
  return out;
}

function mapBroadcast(row: Record<string, unknown>): TelegramBroadcast {
  return {
    id: String(row.id),
    name: row.name != null ? String(row.name) : null,
    audience_id: String(row.audience_id),
    message_body: String(row.message_body || ""),
    image_url: row.image_url != null ? String(row.image_url) : null,
    buttons: asButtons(row.buttons),
    status: (row.status as TelegramBroadcast["status"]) || "draft",
    scheduled_at: row.scheduled_at != null ? String(row.scheduled_at) : null,
    audience_size: Number(row.audience_size || 0),
    reachable_count: Number(row.reachable_count || 0),
    sent_count: Number(row.sent_count || 0),
    failed_count: Number(row.failed_count || 0),
    blocked_count: Number(row.blocked_count || 0),
    skipped_count: Number(row.skipped_count || 0),
    created_by: row.created_by != null ? String(row.created_by) : null,
    created_at: String(row.created_at),
    completed_at: row.completed_at != null ? String(row.completed_at) : null,
    parse_mode: row.parse_mode != null ? String(row.parse_mode) : "HTML",
    fallbacks: asFallbacks(row.fallbacks),
    template_id: row.template_id != null ? String(row.template_id) : null,
    kind: (row.kind as TelegramBroadcastKind) || "message",
    poll: asPoll(row.poll),
    question_key: row.question_key != null ? String(row.question_key) : null,
    lead_field: row.lead_field != null ? String(row.lead_field) : null,
  };
}

/** Rewrite URL buttons through the public click tracker when broadcast_id is known. */
export function trackifyButtons(
  buttons: TelegramButton[] | undefined,
  broadcastId: string,
): TelegramButton[] {
  return (buttons || []).map((b) => {
    if (b.callback_data) return b;
    if (!b.url) return b;
    const tracked = `${siteBase()}/api/telegram/click?b=${encodeURIComponent(broadcastId)}&l=${encodeURIComponent(b.label)}&u=${encodeURIComponent(b.url)}`;
    return { label: b.label, url: tracked };
  });
}

export async function listBroadcasts(limit = 50): Promise<TelegramBroadcast[]> {
  const supabase = db();
  if (!supabase) return [];
  const { data } = await supabase
    .from("telegram_broadcasts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Math.min(100, Math.max(1, limit)));
  return ((data || []) as Record<string, unknown>[]).map(mapBroadcast);
}

export interface CreateBroadcastInput {
  audienceId: PhoneAudienceId | string;
  fromMs: number;
  toMs: number;
  body: string;
  image?: string | null;
  buttons?: TelegramButton[];
  name?: string | null;
  scheduledAt?: string | null;
  actor?: ActionActor | null;
  fallbacks?: Record<string, string>;
  kind?: TelegramBroadcastKind;
  poll?: TelegramPollPayload | null;
  question_key?: string | null;
  lead_field?: string | null;
  template_id?: string | null;
  parse_mode?: "HTML" | string;
}

function normalizeQuestionButtons(
  buttons: TelegramButton[] | undefined,
  broadcastId: string,
): TelegramButton[] {
  return (buttons || []).slice(0, 3).map((b, i) => {
    const label = b.label;
    const optionKey =
      b.callback_data?.includes(":")
        ? b.callback_data.split(":").pop() || `opt${i}`
        : `opt${i}`;
    return {
      label,
      callback_data: `q:${broadcastId}:${optionKey}`.slice(0, 64),
    };
  });
}

export async function createAndEnqueueBroadcast(
  input: CreateBroadcastInput,
): Promise<{ ok: boolean; broadcast?: TelegramBroadcast; error?: string }> {
  const supabase = db();
  if (!supabase) return { ok: false, error: "db_unavailable" };

  const kind: TelegramBroadcastKind = input.kind || "message";
  const fallbacks = input.fallbacks || {};
  const parseMode = input.parse_mode || "HTML";

  if (kind === "poll") {
    const poll = asPoll(input.poll);
    if (!poll) return { ok: false, error: "poll_required" };
  } else if (!input.body?.trim()) {
    return { ok: false, error: "body_required" };
  }

  // Character-limit check with sample vars before enqueue (message/question only).
  if (kind !== "poll") {
    const check = prepareOutboundHtml(input.body, SAMPLE_VARS, fallbacks, {
      hasImage: !!input.image,
    });
    if (check.overLimit) {
      return {
        ok: false,
        error: `over_char_limit:${check.plainLength || check.html.length}>${check.limit}`,
      };
    }
  }

  const audienceId = String(input.audienceId || "");
  if (!audienceId) return { ok: false, error: "audience_required" };

  const resolved = await resolveTelegramAudience(audienceId, input.fromMs, input.toMs);

  let skippedPhones: string[] = [];
  // Phone audiences have a phone list to mark skipped; answer: audiences do not.
  if (!audienceId.startsWith("answer:")) {
    try {
      const people = await resolvePhoneAudience(audienceId as PhoneAudienceId, input.fromMs, input.toMs);
      const reachablePhones = new Set(
        resolved.reachable.map((r) => r.phone).filter(Boolean) as string[],
      );
      skippedPhones = people.map((p) => p.phone).filter((p) => !reachablePhones.has(p));
    } catch {
      skippedPhones = [];
    }
  }

  const scheduledAt = input.scheduledAt || null;
  const status = "queued";

  const insert: Record<string, unknown> = {
    name: input.name || null,
    audience_id: audienceId,
    message_body: kind === "poll" ? input.poll?.question || input.body || "" : input.body,
    image_url: input.image || null,
    buttons: input.buttons || [],
    status,
    scheduled_at: scheduledAt,
    audience_size: resolved.audienceSize || resolved.reachable.length,
    reachable_count: resolved.reachable.length,
    skipped_count: skippedPhones.length,
    created_by: input.actor?.id || null,
    parse_mode: parseMode,
    fallbacks,
    template_id: input.template_id || null,
    kind,
    poll: kind === "poll" ? input.poll || null : null,
    question_key: input.question_key || null,
    lead_field: input.lead_field || null,
  };

  const { data, error } = await supabase.from("telegram_broadcasts").insert(insert).select("*").single();
  if (error || !data) return { ok: false, error: error?.message || "insert_failed" };
  const broadcast = mapBroadcast(data as Record<string, unknown>);

  let buttons = input.buttons || [];
  if (kind === "question") {
    buttons = normalizeQuestionButtons(buttons, broadcast.id);
    await supabase
      .from("telegram_broadcasts")
      .update({ buttons, question_key: input.question_key || broadcast.question_key || `q:${broadcast.id}` })
      .eq("id", broadcast.id);
  } else if (kind === "message" && buttons.some((b) => b.url)) {
    buttons = trackifyButtons(buttons, broadcast.id);
    await supabase.from("telegram_broadcasts").update({ buttons }).eq("id", broadcast.id);
  }

  const { enqueued, skipped } = await enqueueBroadcast({
    broadcastId: broadcast.id,
    reachable: resolved.reachable,
    skippedPhones,
    // Store template body with {{vars}} — personalise on drain.
    body: kind === "poll" ? "" : input.body,
    image_url: input.image || null,
    buttons,
    scheduled_at: scheduledAt || new Date().toISOString(),
    fallbacks,
    kind,
    poll: kind === "poll" ? input.poll || null : null,
    parse_mode: parseMode,
    question_key: input.question_key || (kind === "question" ? `q:${broadcast.id}` : null),
    lead_field: input.lead_field || null,
  });

  await supabase
    .from("telegram_broadcasts")
    .update({
      status: "sending",
      skipped_count: skipped,
      reachable_count: enqueued,
    })
    .eq("id", broadcast.id);

  void logAdminActivity({
    actor: input.actor,
    action: "telegram_broadcast_sent",
    entityType: "telegram_broadcast",
    entityId: broadcast.id,
    metadata: {
      audienceId,
      audienceSize: resolved.audienceSize,
      reachable: enqueued,
      skipped,
      scheduledAt,
      kind,
    },
  });

  const { data: updated } = await supabase
    .from("telegram_broadcasts")
    .select("*")
    .eq("id", broadcast.id)
    .single();

  return { ok: true, broadcast: mapBroadcast((updated || data) as Record<string, unknown>) };
}

export async function getBroadcastDetail(id: string): Promise<{
  broadcast: TelegramBroadcast;
  answers: Awaited<ReturnType<typeof listAnswersForBroadcast>>;
  pollResults: Awaited<ReturnType<typeof pollResults>>;
  buttonClicks: { label: string | null; url: string | null; count: number }[];
  queueCounts: Record<string, number>;
} | null> {
  const supabase = db();
  if (!supabase) return null;
  const { data } = await supabase.from("telegram_broadcasts").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const broadcast = mapBroadcast(data as Record<string, unknown>);

  const [answers, results, clicksRes, queueRes] = await Promise.all([
    listAnswersForBroadcast(id),
    pollResults(id),
    supabase
      .from("telegram_button_clicks")
      .select("button_label, button_url")
      .eq("broadcast_id", id)
      .limit(5000),
    supabase.from("telegram_send_queue").select("status").eq("broadcast_id", id).limit(10000),
  ]);

  const clickMap = new Map<string, { label: string | null; url: string | null; count: number }>();
  for (const c of clicksRes.data || []) {
    const label = (c as { button_label?: string | null }).button_label || null;
    const url = (c as { button_url?: string | null }).button_url || null;
    const key = `${label || ""}|${url || ""}`;
    const cur = clickMap.get(key) || { label, url, count: 0 };
    cur.count++;
    clickMap.set(key, cur);
  }

  const queueCounts: Record<string, number> = {};
  for (const q of queueRes.data || []) {
    const st = String((q as { status?: string }).status || "unknown");
    queueCounts[st] = (queueCounts[st] || 0) + 1;
  }

  return {
    broadcast,
    answers,
    pollResults: results,
    buttonClicks: [...clickMap.values()].sort((a, b) => b.count - a.count),
    queueCounts,
  };
}

export async function createDirectSend(opts: {
  chatId: string;
  body: string;
  image?: string | null;
  buttons?: TelegramButton[];
  fallbacks?: Record<string, string>;
  actor?: ActionActor | null;
}): Promise<{ ok: boolean; queueId?: string | null; error?: string }> {
  const chatId = String(opts.chatId || "").trim();
  if (!chatId) return { ok: false, error: "chat_id_required" };
  if (!opts.body?.trim()) return { ok: false, error: "body_required" };

  const fallbacks = opts.fallbacks || {};
  const check = prepareOutboundHtml(opts.body, SAMPLE_VARS, fallbacks, { hasImage: !!opts.image });
  if (check.overLimit) {
    return { ok: false, error: `over_char_limit:${check.html.length}>${check.limit}` };
  }

  const supabase = db();
  let subscriberId: string | null = null;
  let name: string | null = null;
  let phone: string | null = null;
  if (supabase) {
    const { data: sub } = await supabase
      .from("telegram_subscribers")
      .select("id, first_name, phone")
      .eq("chat_id", chatId)
      .maybeSingle();
    if (sub) {
      subscriberId = String((sub as { id: string }).id);
      name = (sub as { first_name?: string | null }).first_name || null;
      phone = (sub as { phone?: string | null }).phone || null;
    }
  }

  const queueId = await enqueueSend({
    chat_id: chatId,
    subscriber_id: subscriberId,
    body: opts.body,
    image_url: opts.image || null,
    buttons: opts.buttons || [],
    parse_mode: "HTML",
    kind: "message",
    metadata: {
      template: true,
      fallbacks,
      name,
      phone,
      direct: true,
      actor_id: opts.actor?.id || null,
    },
  });

  if (!queueId) return { ok: false, error: "enqueue_failed" };

  void logAdminActivity({
    actor: opts.actor,
    action: "telegram_direct_send",
    entityType: "telegram_send_queue",
    entityId: queueId,
    metadata: { chatId },
  });

  return { ok: true, queueId };
}
