/**
 * Thin Telegram Bot API client via plain fetch. No wrapper library.
 */
import { apiBase, botConfigured } from "./config";

export interface TelegramApiParameters {
  retry_after?: number;
  migrate_to_chat_id?: number;
  [key: string]: unknown;
}

export interface TelegramApiResult<T = unknown> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: TelegramApiParameters;
  /** Convenience flags parsed from the response. */
  isBlocked?: boolean;
  isRateLimited?: boolean;
  retryAfterSec?: number;
}

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface SendMessageOpts {
  chat_id: string | number;
  text: string;
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
  disable_web_page_preview?: boolean;
  reply_markup?: {
    inline_keyboard?: InlineKeyboardButton[][];
  };
}

export interface SendPhotoOpts {
  chat_id: string | number;
  photo: string;
  caption?: string;
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
  reply_markup?: {
    inline_keyboard?: InlineKeyboardButton[][];
  };
}

function enrich<T>(raw: TelegramApiResult<T>): TelegramApiResult<T> {
  const code = raw.error_code;
  const desc = (raw.description || "").toLowerCase();
  const retryAfter = Number(raw.parameters?.retry_after);
  const isRateLimited = code === 429 || Number.isFinite(retryAfter);
  const isBlocked =
    code === 403 ||
    desc.includes("blocked by the user") ||
    desc.includes("user is deactivated") ||
    desc.includes("bot was blocked") ||
    desc.includes("chat not found");
  return {
    ...raw,
    isBlocked,
    isRateLimited,
    retryAfterSec: Number.isFinite(retryAfter) ? retryAfter : undefined,
  };
}

export async function callMethod<T = unknown>(
  method: string,
  body?: Record<string, unknown>,
): Promise<TelegramApiResult<T>> {
  if (!botConfigured()) {
    return { ok: false, error_code: 0, description: "bot_not_configured" };
  }
  const base = apiBase();
  if (!base) {
    return { ok: false, error_code: 0, description: "bot_not_configured" };
  }
  try {
    const res = await fetch(`${base}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as TelegramApiResult<T>;
    if (!res.ok && json.ok === undefined) {
      return enrich({
        ok: false,
        error_code: res.status,
        description: `http_${res.status}`,
      });
    }
    return enrich(json);
  } catch (e) {
    return {
      ok: false,
      error_code: 0,
      description: (e as Error).message || "network_error",
    };
  }
}

export async function sendMessage(opts: SendMessageOpts): Promise<TelegramApiResult<{ message_id: number }>> {
  return callMethod("sendMessage", opts as unknown as Record<string, unknown>);
}

export async function sendPhoto(opts: SendPhotoOpts): Promise<TelegramApiResult<{ message_id: number }>> {
  return callMethod("sendPhoto", opts as unknown as Record<string, unknown>);
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<TelegramApiResult<boolean>> {
  return callMethod("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text || undefined,
  });
}

/** Build Telegram inline_keyboard from {label,url} buttons (max 3). */
export function inlineKeyboardFromButtons(
  buttons: { label: string; url: string }[] | null | undefined,
): { inline_keyboard: InlineKeyboardButton[][] } | undefined {
  const rows = (buttons || [])
    .filter((b) => b?.label && b?.url)
    .slice(0, 3)
    .map((b) => [{ text: b.label, url: b.url }]);
  if (!rows.length) return undefined;
  return { inline_keyboard: rows };
}
