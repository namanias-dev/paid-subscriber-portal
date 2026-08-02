/**
 * Live Telegram status for Mission Control. Cached 60s. Never exposes the token.
 */
import { botConfigured, botUsername as envBotUsername, webhookSecret } from "./config";
import {
  callMethod,
  getWebhookInfoStatus,
  invalidateWebhookInfoCache,
  type WebhookInfoStatus,
} from "./botApi";
import { getSupabaseAdmin } from "../supabase";
import { tgLog } from "./log";

export interface BotMeStatus {
  online: boolean;
  id: number | null;
  username: string | null;
  firstName: string | null;
  canJoinGroups: boolean | null;
  error: string | null;
  /** True when a profile photo exists (served via /api/admin/telegram/bot-avatar). */
  hasAvatar: boolean;
}

export interface TelegramLiveStatus {
  configured: boolean;
  online: boolean;
  bot: BotMeStatus;
  webhook: WebhookInfoStatus;
  webhookSecretConfigured: boolean;
  webhookHitsLastHour: number;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  /** Green only when online AND webhook registered AND no pending/errors. */
  healthy: boolean;
  healthReason: string | null;
}

type GetMeRaw = {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
  can_join_groups?: boolean;
};

const TTL_MS = 60_000;
let meCache: { at: number; value: BotMeStatus } | null = null;
let liveCache: { at: number; value: TelegramLiveStatus } | null = null;

export function invalidateTelegramStatusCache(): void {
  meCache = null;
  liveCache = null;
  invalidateWebhookInfoCache();
}

export async function getMeStatus(opts?: { force?: boolean }): Promise<BotMeStatus> {
  const now = Date.now();
  if (!opts?.force && meCache && now - meCache.at < TTL_MS) return meCache.value;

  if (!botConfigured()) {
    const value: BotMeStatus = {
      online: false,
      id: null,
      username: envBotUsername(),
      firstName: null,
      canJoinGroups: null,
      error: "bot_not_configured",
      hasAvatar: false,
    };
    meCache = { at: now, value };
    return value;
  }

  const res = await callMethod<GetMeRaw>("getMe", {});
  if (!res.ok || !res.result) {
    const value: BotMeStatus = {
      online: false,
      id: null,
      username: envBotUsername(),
      firstName: null,
      canJoinGroups: null,
      error: res.description || "getMe_failed",
      hasAvatar: false,
    };
    meCache = { at: now, value };
    tgLog("getMe_failed", { error: value.error }, "error");
    return value;
  }

  const me = res.result;
  let hasAvatar = false;
  if (me.id != null) {
    const photos = await callMethod<{ total_count?: number }>("getUserProfilePhotos", {
      user_id: me.id,
      limit: 1,
    });
    hasAvatar = !!(photos.ok && (photos.result?.total_count || 0) > 0);
  }

  const value: BotMeStatus = {
    online: true,
    id: me.id ?? null,
    username: me.username ? String(me.username).replace(/^@/, "") : envBotUsername(),
    firstName: me.first_name ? String(me.first_name) : null,
    canJoinGroups: typeof me.can_join_groups === "boolean" ? me.can_join_groups : null,
    error: null,
    hasAvatar,
  };
  meCache = { at: now, value };
  return value;
}

async function countWebhookHitsLastHour(): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) return 0;
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db
    .from("telegram_webhook_events")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  return count ?? 0;
}

async function lastMessageAt(direction: "inbound" | "outbound"): Promise<string | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db
    .from("telegram_messages")
    .select("created_at")
    .eq("direction", direction)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.created_at ? String(data.created_at) : null;
}

export async function getTelegramLiveStatus(opts?: { force?: boolean }): Promise<TelegramLiveStatus> {
  const now = Date.now();
  if (!opts?.force && liveCache && now - liveCache.at < TTL_MS) return liveCache.value;

  const [bot, webhook, webhookHitsLastHour, lastInboundAt, lastOutboundAt] = await Promise.all([
    getMeStatus(opts),
    getWebhookInfoStatus(opts),
    countWebhookHitsLastHour(),
    lastMessageAt("inbound"),
    lastMessageAt("outbound"),
  ]);

  const configured = botConfigured();
  const pending = webhook.pendingUpdateCount ?? 0;
  let healthy = configured && bot.online && webhook.webhookRegistered && pending === 0 && !webhook.lastErrorMessage;
  let healthReason: string | null = null;
  if (!configured) healthReason = "TELEGRAM_BOT_TOKEN missing";
  else if (!bot.online) healthReason = bot.error || "getMe failed — bot offline";
  else if (!webhook.webhookRegistered) healthReason = "Webhook URL not registered";
  else if (pending > 0) healthReason = `${pending} pending update(s) — Telegram could not deliver`;
  else if (webhook.lastErrorMessage) healthReason = webhook.lastErrorMessage;

  const value: TelegramLiveStatus = {
    configured,
    online: bot.online,
    bot,
    webhook,
    webhookSecretConfigured: !!webhookSecret(),
    webhookHitsLastHour,
    lastInboundAt,
    lastOutboundAt,
    healthy,
    healthReason,
  };
  liveCache = { at: now, value };
  return value;
}

export async function reregisterWebhook(): Promise<{
  ok: boolean;
  description?: string;
  result?: unknown;
  url: string;
}> {
  const secret = webhookSecret();
  const site =
    (process.env.NEXT_PUBLIC_SITE_URL || "https://www.namanias.com").replace(/\/$/, "") ||
    "https://www.namanias.com";
  const url = `${site}/api/telegram/webhook`;
  if (!botConfigured()) {
    return { ok: false, description: "bot_not_configured", url };
  }
  if (!secret) {
    return { ok: false, description: "TELEGRAM_WEBHOOK_SECRET missing", url };
  }
  const res = await callMethod("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  invalidateTelegramStatusCache();
  tgLog("setWebhook", { ok: res.ok, description: res.description || null, url });
  return {
    ok: !!res.ok,
    description: res.description,
    result: res.result,
    url,
  };
}
