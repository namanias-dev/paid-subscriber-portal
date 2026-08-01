/**
 * Telegram update processor. Designed for fire-and-forget after HTTP 200.
 */
import { getSupabaseAdmin } from "../supabase";
import { answerCallbackQuery } from "./botApi";
import { fireTriggerForSubscriber } from "./dispatch";
import { findByChatId, markInactive, touchInteraction, upsertFromStart } from "./subscribers";
import { sendWelcome } from "./welcome";

export interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id: number; type?: string };
    from?: { id: number; username?: string; first_name?: string; is_bot?: boolean };
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
  if (!supabase) return;
  try {
    await supabase.from("telegram_messages").insert({
      chat_id: opts.chatId,
      subscriber_id: opts.subscriberId || null,
      direction: "inbound",
      body: opts.body,
      telegram_message_id: opts.telegramMessageId || null,
      callback_data: opts.callbackData || null,
      is_read: false,
      metadata: opts.metadata || {},
    });
  } catch {
    /* never break webhook */
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
  if (chatId == null) return;
  const payload = parseStartPayload(update.text || "");
  const result = await upsertFromStart({
    chatId,
    userId: update.from?.id,
    username: update.from?.username || null,
    firstName: update.from?.first_name || null,
    payload,
  });
  await storeInbound({
    chatId: String(chatId),
    subscriberId: result?.subscriber.id,
    body: update.text || "/start",
    telegramMessageId: update.message_id != null ? String(update.message_id) : null,
    metadata: { kind: "command", command: "start", payload },
  });

  // Welcome on first start (or reactivation after /stop).
  if (result?.isNew || result?.reactivated) {
    await sendWelcome(chatId);
  }
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
}

async function handleText(update: NonNullable<TelegramUpdate["message"]>): Promise<void> {
  const chatId = update.chat?.id;
  if (chatId == null) return;
  const text = update.text || "";
  await touchInteraction(chatId);
  const sub = await findByChatId(chatId);

  await storeInbound({
    chatId: String(chatId),
    subscriberId: sub?.id,
    body: text,
    telegramMessageId: update.message_id != null ? String(update.message_id) : null,
    metadata: { kind: "text" },
  });
  if (sub?.is_active) fireTriggerForSubscriber("subscriber_replied", chatId);
}

async function handleCallback(cq: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
  const chatId = cq.message?.chat?.id ?? cq.from?.id;
  if (chatId == null) return;
  await touchInteraction(chatId);
  await storeInbound({
    chatId: String(chatId),
    body: cq.data || null,
    telegramMessageId: cq.message?.message_id != null ? String(cq.message.message_id) : null,
    callbackData: cq.data || null,
    metadata: { kind: "callback" },
  });
  try {
    await answerCallbackQuery(cq.id);
  } catch {
    /* ignore */
  }
}

/** Process one Telegram update. Safe to void/.catch from the route. */
export async function processUpdate(update: TelegramUpdate): Promise<void> {
  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
      return;
    }
    const msg = update.message;
    if (!msg?.chat?.id) return;
    const text = (msg.text || "").trim();
    if (text.startsWith("/start")) {
      await handleStart(msg);
      return;
    }
    if (text.startsWith("/stop") || text.toLowerCase() === "stop") {
      await handleStop(msg);
      return;
    }
    if (text) {
      await handleText(msg);
    }
  } catch {
    /* webhook processing must never throw to the HTTP layer */
  }
}
