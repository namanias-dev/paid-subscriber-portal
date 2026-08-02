import { inlineKeyboardFromButtons, sendMessage, sendPhoto } from "./botApi";
import { DEFAULT_WELCOME, defaultWelcomeButtons } from "./defaults";
import { tgLog } from "./log";
import { renderTelegramBody } from "./render";
import { getSettings } from "./subscribers";
import { getSupabaseAdmin } from "../supabase";

async function storeOutbound(opts: {
  chatId: string;
  subscriberId?: string | null;
  body: string;
  telegramMessageId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  try {
    await db.from("telegram_messages").insert({
      chat_id: opts.chatId,
      subscriber_id: opts.subscriberId || null,
      direction: "outbound",
      body: opts.body,
      telegram_message_id: opts.telegramMessageId || null,
      is_read: true,
      metadata: opts.metadata || {},
    });
  } catch (e) {
    tgLog("store_outbound_failed", { error: (e as Error).message, chat_id: opts.chatId }, "error");
  }
}

/** Send welcome body + buttons (and optional image). Returns send result. */
export async function sendWelcome(
  chatId: string | number,
  vars: { name?: string | null; first_name?: string | null } = {},
  subscriberId?: string | null,
): Promise<{ ok: boolean; description?: string }> {
  try {
    const settings = await getSettings();
    const raw = (settings.welcome_body || DEFAULT_WELCOME).trim() || DEFAULT_WELCOME;
    const body = renderTelegramBody(raw, {
      name: vars.name || vars.first_name || "",
      first_name: vars.first_name || vars.name || "",
    });
    const buttons =
      settings.welcome_buttons?.length > 0 ? settings.welcome_buttons : defaultWelcomeButtons();
    const markup = inlineKeyboardFromButtons(buttons);
    const imageUrl = settings.welcome_image_url?.trim() || null;

    let res;
    if (imageUrl) {
      res = await sendPhoto({
        chat_id: chatId,
        photo: imageUrl,
        caption: body,
        reply_markup: markup,
      });
    } else {
      res = await sendMessage({
        chat_id: chatId,
        text: body,
        reply_markup: markup,
        disable_web_page_preview: true,
      });
    }

    if (res.ok) {
      await storeOutbound({
        chatId: String(chatId),
        subscriberId,
        body,
        telegramMessageId: res.result?.message_id != null ? String(res.result.message_id) : null,
        metadata: { source: "welcome" },
      });
    } else {
      tgLog(
        "welcome_send_failed",
        { chat_id: String(chatId), error_code: res.error_code, description: res.description },
        "error",
      );
    }
    return { ok: !!res.ok, description: res.description };
  } catch (e) {
    tgLog("welcome_exception", { error: (e as Error).message, chat_id: String(chatId) }, "error");
    return { ok: false, description: (e as Error).message };
  }
}

export async function sendPlainAutoReply(
  chatId: string | number,
  text: string,
  subscriberId?: string | null,
  source = "auto_reply",
): Promise<void> {
  const body = (text || "").trim();
  if (!body) return;
  const res = await sendMessage({
    chat_id: chatId,
    text: body,
    disable_web_page_preview: true,
  });
  if (res.ok) {
    await storeOutbound({
      chatId: String(chatId),
      subscriberId,
      body,
      telegramMessageId: res.result?.message_id != null ? String(res.result.message_id) : null,
      metadata: { source },
    });
  } else {
    tgLog(
      "auto_reply_failed",
      { chat_id: String(chatId), source, description: res.description },
      "error",
    );
  }
}

export { DEFAULT_WELCOME, DEFAULT_FIRST_INBOUND_ACK, DEFAULT_UNKNOWN_COMMAND, defaultWelcomeButtons } from "./defaults";
