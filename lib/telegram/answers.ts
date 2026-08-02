/**
 * Poll / callback question answers + lead-field side effects.
 */
import { getSupabaseAdmin } from "../supabase";
import type { TelegramReachable } from "./types";

function db() {
  return getSupabaseAdmin();
}

const SAFE_LEAD_FIELDS = new Set([
  "status",
  "notes",
  "course_interest",
  "course",
  "source",
  "behaviour_status",
  "utm_source",
  "utm_medium",
  "utm_campaign",
]);

export interface TelegramAnswerRow {
  id: string;
  subscriber_id: string | null;
  chat_id: string;
  broadcast_id: string | null;
  kind: "poll" | "button" | string;
  question_key: string;
  option_key: string;
  option_label: string | null;
  poll_id: string | null;
  lead_id: string | null;
  lead_field: string | null;
  raw: Record<string, unknown>;
  created_at: string;
}

function mapAnswer(row: Record<string, unknown>): TelegramAnswerRow {
  return {
    id: String(row.id),
    subscriber_id: row.subscriber_id != null ? String(row.subscriber_id) : null,
    chat_id: String(row.chat_id),
    broadcast_id: row.broadcast_id != null ? String(row.broadcast_id) : null,
    kind: String(row.kind || ""),
    question_key: String(row.question_key || ""),
    option_key: String(row.option_key || ""),
    option_label: row.option_label != null ? String(row.option_label) : null,
    poll_id: row.poll_id != null ? String(row.poll_id) : null,
    lead_id: row.lead_id != null ? String(row.lead_id) : null,
    lead_field: row.lead_field != null ? String(row.lead_field) : null,
    raw: (row.raw as Record<string, unknown>) || {},
    created_at: String(row.created_at),
  };
}

async function resolveSubscriberContext(chatId: string): Promise<{
  subscriberId: string | null;
  leadId: string | null;
}> {
  const supabase = db();
  if (!supabase) return { subscriberId: null, leadId: null };
  const { data } = await supabase
    .from("telegram_subscribers")
    .select("id, linked_lead_id")
    .eq("chat_id", String(chatId))
    .maybeSingle();
  if (!data) return { subscriberId: null, leadId: null };
  return {
    subscriberId: String((data as { id: string }).id),
    leadId:
      (data as { linked_lead_id?: string | null }).linked_lead_id != null
        ? String((data as { linked_lead_id: string }).linked_lead_id)
        : null,
  };
}

async function maybeUpdateLeadField(
  leadId: string | null,
  leadField: string | null | undefined,
  value: string,
): Promise<void> {
  if (!leadId || !leadField) return;
  const field = String(leadField).trim();
  if (!SAFE_LEAD_FIELDS.has(field)) return;
  const supabase = db();
  if (!supabase) return;
  try {
    await supabase.from("leads").update({ [field]: value }).eq("id", leadId);
  } catch {
    /* ignore */
  }
}

export async function recordPollAnswer(opts: {
  chatId: string;
  pollId: string;
  optionIds: number[];
  broadcastId?: string | null;
  questionKey?: string | null;
  optionLabels?: string[];
  leadField?: string | null;
  raw?: Record<string, unknown>;
}): Promise<TelegramAnswerRow | null> {
  const supabase = db();
  if (!supabase) return null;

  let questionKey = opts.questionKey || null;
  let leadField = opts.leadField || null;
  let broadcastId = opts.broadcastId || null;
  let optionLabels = opts.optionLabels || [];

  // Resolve broadcast/question from queue row that sent this poll.
  if (!broadcastId || !questionKey) {
    const { data: q } = await supabase
      .from("telegram_send_queue")
      .select("broadcast_id, poll, metadata")
      .eq("kind", "poll")
      .eq("chat_id", String(opts.chatId))
      .not("telegram_message_id", "is", null)
      .order("sent_at", { ascending: false })
      .limit(20);
    for (const row of q || []) {
      const meta = (row as { metadata?: Record<string, unknown> }).metadata || {};
      const poll = (row as { poll?: { options?: string[]; question_key?: string } | null }).poll;
      const bid = (row as { broadcast_id?: string | null }).broadcast_id;
      if (meta.poll_id && String(meta.poll_id) === String(opts.pollId)) {
        broadcastId = bid != null ? String(bid) : broadcastId;
        questionKey = questionKey || String(meta.question_key || poll?.question_key || "");
        leadField = leadField || (meta.lead_field != null ? String(meta.lead_field) : null);
        if (poll?.options?.length) optionLabels = poll.options;
        break;
      }
      // Fallback: most recent poll for this chat if poll_id not yet stored.
      if (!broadcastId && bid) {
        broadcastId = String(bid);
        if (poll?.options?.length) optionLabels = poll.options;
        questionKey = questionKey || String(meta.question_key || "");
        leadField = leadField || (meta.lead_field != null ? String(meta.lead_field) : null);
      }
    }
  }

  if (broadcastId && (!questionKey || !leadField)) {
    const { data: b } = await supabase
      .from("telegram_broadcasts")
      .select("question_key, lead_field, poll")
      .eq("id", broadcastId)
      .maybeSingle();
    if (b) {
      questionKey = questionKey || ((b as { question_key?: string | null }).question_key ?? null);
      leadField = leadField || ((b as { lead_field?: string | null }).lead_field ?? null);
      const poll = (b as { poll?: { options?: string[] } | null }).poll;
      if (!optionLabels.length && poll?.options?.length) optionLabels = poll.options;
    }
  }

  questionKey = questionKey || `poll:${opts.pollId}`;
  const optionId = opts.optionIds[0] ?? 0;
  const optionKey = String(optionId);
  const optionLabel = optionLabels[optionId] ?? optionKey;

  const ctx = await resolveSubscriberContext(opts.chatId);
  const row = {
    subscriber_id: ctx.subscriberId,
    chat_id: String(opts.chatId),
    broadcast_id: broadcastId,
    kind: "poll",
    question_key: questionKey,
    option_key: optionKey,
    option_label: optionLabel,
    poll_id: String(opts.pollId),
    lead_id: ctx.leadId,
    lead_field: leadField,
    raw: opts.raw || { option_ids: opts.optionIds },
  };

  const { data, error } = await supabase
    .from("telegram_answers")
    .upsert(row, { onConflict: "chat_id,poll_id", ignoreDuplicates: false })
    .select("*")
    .maybeSingle();

  // Upsert on partial unique index may need insert+update fallback.
  if (error || !data) {
    const { data: existing } = await supabase
      .from("telegram_answers")
      .select("id")
      .eq("chat_id", String(opts.chatId))
      .eq("poll_id", String(opts.pollId))
      .eq("kind", "poll")
      .maybeSingle();
    if (existing) {
      const { data: updated } = await supabase
        .from("telegram_answers")
        .update(row)
        .eq("id", (existing as { id: string }).id)
        .select("*")
        .single();
      if (updated) {
        await maybeUpdateLeadField(ctx.leadId, leadField, optionLabel);
        return mapAnswer(updated as Record<string, unknown>);
      }
    }
    const { data: inserted } = await supabase.from("telegram_answers").insert(row).select("*").single();
    if (!inserted) return null;
    await maybeUpdateLeadField(ctx.leadId, leadField, optionLabel);
    return mapAnswer(inserted as Record<string, unknown>);
  }

  await maybeUpdateLeadField(ctx.leadId, leadField, optionLabel);
  return mapAnswer(data as Record<string, unknown>);
}

export async function recordButtonAnswer(opts: {
  chatId: string;
  broadcastId: string;
  optionKey: string;
  optionLabel?: string | null;
  questionKey?: string | null;
  leadField?: string | null;
  raw?: Record<string, unknown>;
}): Promise<TelegramAnswerRow | null> {
  const supabase = db();
  if (!supabase) return null;

  let questionKey = opts.questionKey || null;
  let leadField = opts.leadField || null;
  let optionLabel = opts.optionLabel || opts.optionKey;

  const { data: b } = await supabase
    .from("telegram_broadcasts")
    .select("question_key, lead_field, buttons")
    .eq("id", opts.broadcastId)
    .maybeSingle();
  if (b) {
    questionKey = questionKey || ((b as { question_key?: string | null }).question_key ?? null);
    leadField = leadField || ((b as { lead_field?: string | null }).lead_field ?? null);
    const buttons = (b as { buttons?: { label?: string; callback_data?: string }[] }).buttons || [];
    const match = buttons.find(
      (btn) =>
        btn.callback_data === `q:${opts.broadcastId}:${opts.optionKey}` ||
        btn.callback_data?.endsWith(`:${opts.optionKey}`),
    );
    if (match?.label) optionLabel = match.label;
  }
  questionKey = questionKey || `q:${opts.broadcastId}`;

  const ctx = await resolveSubscriberContext(opts.chatId);
  const row = {
    subscriber_id: ctx.subscriberId,
    chat_id: String(opts.chatId),
    broadcast_id: opts.broadcastId,
    kind: "button",
    question_key: questionKey,
    option_key: opts.optionKey,
    option_label: optionLabel,
    poll_id: null,
    lead_id: ctx.leadId,
    lead_field: leadField,
    raw: opts.raw || {},
  };

  const { data } = await supabase.from("telegram_answers").insert(row).select("*").single();
  if (!data) return null;
  await maybeUpdateLeadField(ctx.leadId, leadField, String(optionLabel));
  return mapAnswer(data as Record<string, unknown>);
}

export async function listAnswersForBroadcast(broadcastId: string): Promise<TelegramAnswerRow[]> {
  const supabase = db();
  if (!supabase) return [];
  const { data } = await supabase
    .from("telegram_answers")
    .select("*")
    .eq("broadcast_id", broadcastId)
    .order("created_at", { ascending: false })
    .limit(2000);
  return ((data || []) as Record<string, unknown>[]).map(mapAnswer);
}

export async function pollResults(broadcastId: string): Promise<
  {
    option_key: string;
    option_label: string | null;
    count: number;
  }[]
> {
  const answers = await listAnswersForBroadcast(broadcastId);
  const map = new Map<string, { option_key: string; option_label: string | null; count: number }>();
  for (const a of answers) {
    const cur = map.get(a.option_key) || {
      option_key: a.option_key,
      option_label: a.option_label,
      count: 0,
    };
    cur.count++;
    if (!cur.option_label && a.option_label) cur.option_label = a.option_label;
    map.set(a.option_key, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/**
 * Active subscribers who answered a given question with optionKey.
 */
export async function resolveAnswerAudience(
  questionKey: string,
  optionKey: string,
): Promise<TelegramReachable[]> {
  const supabase = db();
  if (!supabase) return [];

  const { data: answers } = await supabase
    .from("telegram_answers")
    .select("chat_id, subscriber_id")
    .eq("question_key", questionKey)
    .eq("option_key", optionKey)
    .order("created_at", { ascending: false })
    .limit(5000);

  const chatIds = [
    ...new Set(((answers || []) as { chat_id?: string }[]).map((a) => String(a.chat_id || "")).filter(Boolean)),
  ];
  if (!chatIds.length) return [];

  const reachable: TelegramReachable[] = [];
  const seen = new Set<string>();
  const CHUNK = 200;
  for (let i = 0; i < chatIds.length; i += CHUNK) {
    const slice = chatIds.slice(i, i + CHUNK);
    const { data: subs } = await supabase
      .from("telegram_subscribers")
      .select("id, chat_id, first_name, phone, is_active")
      .eq("is_active", true)
      .in("chat_id", slice);
    for (const s of subs || []) {
      const chatId = String((s as { chat_id: string }).chat_id);
      if (seen.has(chatId)) continue;
      seen.add(chatId);
      reachable.push({
        chat_id: chatId,
        subscriber_id: String((s as { id: string }).id),
        name: (s as { first_name?: string | null }).first_name || null,
        phone: (s as { phone?: string | null }).phone || null,
      });
    }
  }
  return reachable;
}

export async function recordButtonClick(opts: {
  broadcastId?: string | null;
  queueId?: string | null;
  chatId?: string | null;
  buttonLabel?: string | null;
  buttonUrl: string;
}): Promise<void> {
  const supabase = db();
  if (!supabase) return;
  try {
    await supabase.from("telegram_button_clicks").insert({
      broadcast_id: opts.broadcastId || null,
      queue_id: opts.queueId || null,
      chat_id: opts.chatId || null,
      button_label: opts.buttonLabel || null,
      button_url: opts.buttonUrl,
    });
  } catch {
    /* ignore */
  }
}
