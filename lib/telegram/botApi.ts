/**
 * Thin Telegram Bot API client via plain fetch. No wrapper library.
 */
import { apiBase, botConfigured } from "./config";
import { tgLog } from "./log";

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
  /** Silent post — digests use true; alerts and 6 AM summary use false. */
  disable_notification?: boolean;
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
  const res = await callMethod<{ message_id: number }>(
    "sendMessage",
    opts as unknown as Record<string, unknown>,
  );
  // Success-path log trimmed (high volume from digests/queue). Keep failures.
  if (!res.ok) {
    tgLog(
      "sendMessage",
      {
        chat_id: String(opts.chat_id),
        ok: false,
        error_code: res.error_code ?? null,
        description: res.description ?? null,
        message_id: null,
      },
      "error",
    );
  }
  return res;
}

export async function sendPhoto(opts: SendPhotoOpts): Promise<TelegramApiResult<{ message_id: number }>> {
  return callMethod("sendPhoto", opts as unknown as Record<string, unknown>);
}

export interface SendPollOpts {
  chat_id: string | number;
  question: string;
  options: string[];
  is_anonymous?: boolean;
  allows_multiple_answers?: boolean;
}

export async function sendPoll(
  opts: SendPollOpts,
): Promise<TelegramApiResult<{ message_id: number; poll?: { id: string } }>> {
  const res = await callMethod<{ message_id: number; poll?: { id: string } }>("sendPoll", {
    chat_id: opts.chat_id,
    question: opts.question,
    options: opts.options,
    is_anonymous: opts.is_anonymous !== false,
    allows_multiple_answers: !!opts.allows_multiple_answers,
  });
  if (!res.ok) {
    tgLog(
      "sendPoll",
      {
        chat_id: String(opts.chat_id),
        ok: false,
        error_code: res.error_code ?? null,
        description: res.description ?? null,
        message_id: null,
        poll_id: null,
      },
      "error",
    );
  }
  return res;
}

export async function getChat(
  chatId: string | number,
): Promise<
  TelegramApiResult<{
    id: number;
    type: string;
    title?: string;
    username?: string;
  }>
> {
  return callMethod("getChat", { chat_id: chatId });
}

/** Pin a message in a channel/group. Never throws via callMethod. */
export async function pinChatMessage(
  chatId: string | number,
  messageId: number,
): Promise<TelegramApiResult<boolean>> {
  return callMethod<boolean>("pinChatMessage", {
    chat_id: chatId,
    message_id: messageId,
    disable_notification: true,
  });
}

export async function editMessageText(opts: {
  chat_id: string | number;
  message_id: number;
  text: string;
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
  disable_web_page_preview?: boolean;
  reply_markup?: { inline_keyboard?: InlineKeyboardButton[][] };
}): Promise<TelegramApiResult<{ message_id: number } | boolean>> {
  return callMethod("editMessageText", opts as unknown as Record<string, unknown>);
}

export async function getMe(): Promise<
  TelegramApiResult<{ id: number; username?: string; first_name?: string }>
> {
  return callMethod("getMe");
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

export type KeyboardButtonInput =
  | { label: string; url?: string; callback_data?: string }
  | { label: string; url: string }
  | { label: string; callback_data: string };

/** Build Telegram inline_keyboard from url and/or callback_data buttons (max 3). */
export function buildKeyboard(
  buttons: KeyboardButtonInput[] | null | undefined,
): { inline_keyboard: InlineKeyboardButton[][] } | undefined {
  const rows = (buttons || [])
    .map((b) => {
      const label = String(b?.label || "").trim();
      if (!label) return null;
      const url = "url" in b && b.url ? String(b.url).trim() : "";
      const callback = "callback_data" in b && b.callback_data ? String(b.callback_data).trim() : "";
      if (callback) return [{ text: label, callback_data: callback.slice(0, 64) }];
      if (url) return [{ text: label, url }];
      return null;
    })
    .filter(Boolean)
    .slice(0, 3) as InlineKeyboardButton[][];
  if (!rows.length) return undefined;
  return { inline_keyboard: rows };
}

/** @deprecated Prefer buildKeyboard — kept for url-only callers. */
export function inlineKeyboardFromButtons(
  buttons: KeyboardButtonInput[] | null | undefined,
): { inline_keyboard: InlineKeyboardButton[][] } | undefined {
  return buildKeyboard(buttons);
}

export interface WebhookInfoStatus {
  /** True when TELEGRAM_BOT_TOKEN is present (same check as the send path). */
  configured: boolean;
  /** True when getWebhookInfo reports a non-empty url. */
  webhookRegistered: boolean;
  webhookUrl: string | null;
  pendingUpdateCount: number | null;
  /** Last error message from Telegram, if any — never includes the token. */
  lastErrorMessage: string | null;
  lastErrorDate: string | null;
}

type WebhookInfoRaw = {
  url?: string;
  pending_update_count?: number;
  last_error_message?: string;
  last_error_date?: number;
};

const WEBHOOK_INFO_TTL_MS = 60_000;
let webhookInfoCache: { at: number; value: WebhookInfoStatus } | null = null;

export function invalidateWebhookInfoCache(): void {
  webhookInfoCache = null;
}

/**
 * Server-only status for Mission Control. Cached 60s. Never returns the token.
 * Uses the same botConfigured()/callMethod path as outbound sends.
 */
export async function getWebhookInfoStatus(opts?: { force?: boolean }): Promise<WebhookInfoStatus> {
  const now = Date.now();
  if (!opts?.force && webhookInfoCache && now - webhookInfoCache.at < WEBHOOK_INFO_TTL_MS) {
    return webhookInfoCache.value;
  }

  if (!botConfigured()) {
    const value: WebhookInfoStatus = {
      configured: false,
      webhookRegistered: false,
      webhookUrl: null,
      pendingUpdateCount: null,
      lastErrorMessage: null,
      lastErrorDate: null,
    };
    webhookInfoCache = { at: now, value };
    return value;
  }

  const res = await callMethod<WebhookInfoRaw>("getWebhookInfo", {});
  const info = res.ok && res.result ? res.result : null;
  const url = (info?.url || "").trim() || null;
  const lastMsg = (info?.last_error_message || "").trim() || null;
  const lastDateUnix = info?.last_error_date;
  const value: WebhookInfoStatus = {
    configured: true,
    webhookRegistered: !!url,
    webhookUrl: url,
    pendingUpdateCount:
      typeof info?.pending_update_count === "number" ? info.pending_update_count : null,
    lastErrorMessage: lastMsg || (!res.ok ? (res.description || "getWebhookInfo_failed") : null),
    lastErrorDate:
      typeof lastDateUnix === "number" && lastDateUnix > 0
        ? new Date(lastDateUnix * 1000).toISOString()
        : null,
  };
  webhookInfoCache = { at: now, value };
  return value;
}
