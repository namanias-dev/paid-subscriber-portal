/**
 * Telegram update processor. Must be awaited by the webhook route before HTTP 200.
 */
import { getSupabaseAdmin } from "../supabase";
import { answerCallbackQuery, sendMessage } from "./botApi";
import { recordButtonAnswer, recordPollAnswer } from "./answers";
import { fireTriggerForSubscriber } from "./dispatch";
import { tgLog } from "./log";
import {
  findByChatId,
  getSettings,
  markInactive,
  markFirstInboundAckSent,
  recordWebhookEvent,
  touchInteraction,
  upsertFromStart,
} from "./subscribers";
import { DEFAULT_FIRST_INBOUND_ACK, DEFAULT_UNKNOWN_COMMAND } from "./defaults";
import { sendPlainAutoReply, sendWelcome } from "./welcome";

export interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id: number; type?: string; title?: string };
    from?: { id: number; username?: string; first_name?: string; is_bot?: boolean };
    forward_from_chat?: { id: number; type?: string; title?: string };
    forward_origin?: {
      type?: string;
      chat?: { id: number; type?: string; title?: string };
    };
  };
  channel_post?: {
    message_id?: number;
    text?: string;
    chat?: { id: number; type?: string; title?: string };
  };
  edited_channel_post?: {
    message_id?: number;
    text?: string;
    chat?: { id: number; type?: string; title?: string };
  };
  my_chat_member?: {
    chat?: { id: number; type?: string; title?: string };
    new_chat_member?: { status?: string };
  };
  chat_member?: {
    chat?: { id: number; type?: string; title?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    from?: { id: number; username?: string; first_name?: string };
    message?: {
      message_id?: number;
      chat?: { id: number };
      text?: string;
    };
  };
  poll_answer?: {
    poll_id: string;
    user?: { id: number; username?: string; first_name?: string };
    option_ids?: number[];
  };
}

async function storeInbound(opts: {
  chatId: string;
  subscriberId?: string | null;
  body: string | null;
  telegramMessageId?: string | null;
  callbackData?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    tgLog("store_inbound_no_db", { chat_id: opts.chatId }, "error");
    return;
  }
  const { error } = await supabase.from("telegram_messages").insert({
    chat_id: opts.chatId,
    subscriber_id: opts.subscriberId || null,
    direction: "inbound",
    body: opts.body,
    telegram_message_id: opts.telegramMessageId || null,
    callback_data: opts.callbackData || null,
    is_read: false,
    metadata: opts.metadata || {},
  });
  if (error) {
    tgLog("store_inbound_failed", { chat_id: opts.chatId, error: error.message }, "error");
  }
}

function parseStartPayload(text: string): string | null {
  const t = (text || "").trim();
  if (!t.startsWith("/start")) return null;
  const parts = t.split(/\s+/);
  return parts[1] || null;
}

async function handleStart(update: NonNullable<TelegramUpdate["message"]>): Promise<void> {
  const chatId = update.chat?.id;
  if (chatId == null) {
    tgLog("start_no_chat", {}, "warn");
    return;
  }
  const payload = parseStartPayload(update.text || "");
  tgLog("start_begin", { chat_id: String(chatId), payload });

  const result = await upsertFromStart({
    chatId,
    userId: update.from?.id,
    username: update.from?.username || null,
    firstName: update.from?.first_name || null,
    payload,
  });

  if (!result) {
    tgLog("start_upsert_failed", { chat_id: String(chatId), payload }, "error");
  } else {
    tgLog("start_upsert_ok", {
      chat_id: String(chatId),
      isNew: result.isNew,
      reactivated: result.reactivated,
      linked_lead_id: result.subscriber.linked_lead_id,
      subscriber_id: result.subscriber.id,
    });
  }

  await storeInbound({
    chatId: String(chatId),
    subscriberId: result?.subscriber.id,
    body: update.text || "/start",
    telegramMessageId: update.message_id != null ? String(update.message_id) : null,
    metadata: { kind: "command", command: "start", payload },
  });

  // Always reply on /start so the user never sees silence.
  const welcome = await sendWelcome(
    chatId,
    {
      first_name: update.from?.first_name || result?.subscriber.first_name,
      name: result?.subscriber.first_name || update.from?.first_name,
    },
    result?.subscriber.id,
  );
  tgLog("start_welcome", { chat_id: String(chatId), ok: welcome.ok, description: welcome.description ?? null });

  fireTriggerForSubscriber("subscriber_joined", chatId);
}

async function handleStop(update: NonNullable<TelegramUpdate["message"]>): Promise<void> {
  const chatId = update.chat?.id;
  if (chatId == null) return;
  await markInactive(chatId, "user_stop");
  await storeInbound({
    chatId: String(chatId),
    body: update.text || "/stop",
    telegramMessageId: update.message_id != null ? String(update.message_id) : null,
    metadata: { kind: "command", command: "stop" },
  });
  await sendPlainAutoReply(chatId, "You have unsubscribed. Send /start anytime to rejoin.", null, "stop_ack");
  tgLog("stop_ok", { chat_id: String(chatId) });
}

async function handleText(update: NonNullable<TelegramUpdate["message"]>): Promise<void> {
  const chatId = update.chat?.id;
  if (chatId == null) return;
  const text = update.text || "";
  await touchInteraction(chatId);
  const sub = await findByChatId(chatId);
  const settings = await getSettings();

  await storeInbound({
    chatId: String(chatId),
    subscriberId: sub?.id,
    body: text,
    telegramMessageId: update.message_id != null ? String(update.message_id) : null,
    metadata: { kind: "text" },
  });

  // Unrecognised slash-commands (not /start or /stop).
  if (text.startsWith("/") && !text.startsWith("/start") && !text.startsWith("/stop")) {
    const reply = (settings.unknown_command_reply || DEFAULT_UNKNOWN_COMMAND).trim();
    await sendPlainAutoReply(chatId, reply, sub?.id, "unknown_command");
    return;
  }

  // First-inbound acknowledgement — once per conversation, not per message.
  if (settings.first_inbound_ack_enabled !== false && sub && !sub.first_inbound_ack_sent_at) {
    const ack = (settings.first_inbound_ack_body || DEFAULT_FIRST_INBOUND_ACK).trim();
    if (ack) {
      await sendPlainAutoReply(chatId, ack, sub.id, "first_inbound_ack");
      await markFirstInboundAckSent(chatId);
    }
  }

  if (sub?.is_active) fireTriggerForSubscriber("subscriber_replied", chatId);
  tgLog("text_ok", { chat_id: String(chatId), len: text.length });
}

async function handlePollAnswer(pa: NonNullable<TelegramUpdate["poll_answer"]>): Promise<void> {
  const userId = pa.user?.id;
  if (userId == null || !pa.poll_id) return;
  const chatId = String(userId); // private chats: chat_id === user_id
  await touchInteraction(chatId);
  await storeInbound({
    chatId,
    body: `poll_answer:${pa.poll_id}:${(pa.option_ids || []).join(",")}`,
    metadata: { kind: "poll_answer", poll_id: pa.poll_id, option_ids: pa.option_ids || [] },
  });
  try {
    await recordPollAnswer({
      chatId,
      pollId: String(pa.poll_id),
      optionIds: pa.option_ids || [],
      raw: { user: pa.user || null, option_ids: pa.option_ids || [] },
    });
  } catch (e) {
    tgLog("poll_answer_record_failed", { error: (e as Error).message }, "warn");
  }
  tgLog("poll_answer_ok", { chat_id: chatId, poll_id: pa.poll_id });
}

async function handleCallback(cq: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
  const chatId = cq.message?.chat?.id ?? cq.from?.id;
  if (chatId == null) return;
  await touchInteraction(chatId);
  const data = cq.data || "";
  await storeInbound({
    chatId: String(chatId),
    body: data || null,
    telegramMessageId: cq.message?.message_id != null ? String(cq.message.message_id) : null,
    callbackData: data || null,
    metadata: { kind: "callback" },
  });

  // Question buttons: q:{broadcastId}:{optionKey}
  if (data.startsWith("q:")) {
    const parts = data.split(":");
    const broadcastId = parts[1] || "";
    const optionKey = parts.slice(2).join(":") || "";
    if (broadcastId && optionKey) {
      try {
        await recordButtonAnswer({
          chatId: String(chatId),
          broadcastId,
          optionKey,
          raw: { callback_data: data },
        });
      } catch (e) {
        tgLog("button_answer_failed", { error: (e as Error).message }, "warn");
      }
      try {
        await answerCallbackQuery(cq.id, "Recorded");
      } catch (e) {
        tgLog("callback_answer_failed", { error: (e as Error).message }, "warn");
      }
      try {
        await sendMessage({
          chat_id: chatId,
          text: "Thanks — recorded.",
          disable_web_page_preview: true,
        });
      } catch {
        /* ignore */
      }
      return;
    }
  }

  try {
    await answerCallbackQuery(cq.id);
  } catch (e) {
    tgLog("callback_answer_failed", { error: (e as Error).message }, "warn");
  }
}

/** Process one Telegram update. Awaited by the webhook route before responding. */
export async function processUpdate(update: TelegramUpdate): Promise<void> {
  let kind = "unknown";
  let chatId: string | null = null;
  let ok = true;
  let error: string | null = null;

  try {
    if (update.poll_answer) {
      kind = "poll_answer";
      chatId = update.poll_answer.user?.id != null ? String(update.poll_answer.user.id) : null;
      await handlePollAnswer(update.poll_answer);
    } else if (update.callback_query) {
      kind = "callback_query";
      chatId = String(update.callback_query.message?.chat?.id ?? update.callback_query.from?.id ?? "");
      await handleCallback(update.callback_query);
    } else if (update.channel_post?.chat) {
      kind = "channel_post";
      chatId = String(update.channel_post.chat.id);
    } else if (update.edited_channel_post?.chat) {
      kind = "edited_channel_post";
      chatId = String(update.edited_channel_post.chat.id);
    } else if (update.my_chat_member?.chat) {
      kind = "my_chat_member";
      chatId = String(update.my_chat_member.chat.id);
    } else if (update.chat_member?.chat) {
      kind = "chat_member";
      chatId = String(update.chat_member.chat.id);
    } else {
      const msg = update.message;
      if (!msg?.chat?.id) {
        kind = "no_message";
        const keys = Object.keys(update).filter((k) => k !== "update_id");
        tgLog("update_ignored", { update_id: update.update_id ?? null, keys }, "warn");
      } else {
        chatId = String(msg.chat.id);
        const text = (msg.text || "").trim();
        if (text.startsWith("/start")) {
          kind = "start";
          await handleStart(msg);
        } else if (text.startsWith("/stop") || text.toLowerCase() === "stop") {
          kind = "stop";
          await handleStop(msg);
        } else if (text) {
          kind = "text";
          await handleText(msg);
        } else {
          kind = msg.forward_from_chat || msg.forward_origin ? "forward" : "non_text";
        }
      }
    }
  } catch (e) {
    ok = false;
    error = (e as Error).message || "handler_exception";
    tgLog("process_update_error", { error, update_id: update.update_id ?? null }, "error");
  } finally {
    await recordWebhookEvent({
      updateId: update.update_id ?? null,
      kind,
      chatId,
      ok,
      error,
    });
  }
}
