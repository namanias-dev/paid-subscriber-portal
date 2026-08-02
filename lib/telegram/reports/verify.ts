/**
 * Production channel verification + one-line test post for business reports.
 */
import { getChat, getMe, sendMessage } from "../botApi";
import { tgLog } from "../log";
import {
  getReportSettings,
  maskChannelId,
  normalizeChannelId,
  resolveReportsChannelId,
} from "./settings";

export interface ChannelVerifyResult {
  ok: boolean;
  envPresent: boolean;
  envRawLen: number;
  channelIdMasked: string | null;
  channelIdNormalized: string | null;
  botUsername: string | null;
  getChatOk: boolean;
  getChatError: string | null;
  chatTitle: string | null;
  chatType: string | null;
  testOk: boolean;
  testError: string | null;
  testMessageId: number | null;
}

export async function verifyReportsChannel(opts?: {
  sendTest?: boolean;
}): Promise<ChannelVerifyResult> {
  const envRaw = (process.env.TELEGRAM_REPORTS_CHANNEL_ID || "").trim();
  const settings = await getReportSettings();
  const resolved = resolveReportsChannelId(settings);
  const normalized = resolved ? normalizeChannelId(resolved) : null;

  const out: ChannelVerifyResult = {
    ok: false,
    envPresent: envRaw.length > 0 || !!(settings.channel_id && settings.channel_id.trim()),
    envRawLen: envRaw.length,
    channelIdMasked: maskChannelId(normalized),
    channelIdNormalized: normalized,
    botUsername: null,
    getChatOk: false,
    getChatError: null,
    chatTitle: null,
    chatType: null,
    testOk: false,
    testError: null,
    testMessageId: null,
  };

  const me = await getMe();
  if (me.ok && me.result) {
    out.botUsername = me.result.username || me.result.first_name || null;
  }

  if (!normalized) {
    out.getChatError = "channel_not_configured";
    return out;
  }

  const chat = await getChat(normalized);
  if (!chat.ok) {
    out.getChatError = chat.description || `error_${chat.error_code || "unknown"}`;
    tgLog("reports_getChat_failed", { channel: maskChannelId(normalized), error: out.getChatError }, "error");
    return out;
  }
  out.getChatOk = true;
  out.chatTitle = chat.result?.title || null;
  out.chatType = chat.result?.type || null;

  if (opts?.sendTest === false) {
    out.ok = true;
    return out;
  }

  const test = await sendMessage({
    chat_id: normalized,
    text: `✅ Reports channel linked · @${out.botUsername || "bot"} · ${new Date().toISOString()}`,
    disable_notification: true,
    disable_web_page_preview: true,
  });
  if (!test.ok) {
    out.testError = test.description || `error_${test.error_code || "unknown"}`;
    tgLog("reports_test_failed", { channel: maskChannelId(normalized), error: out.testError }, "error");
    return out;
  }
  out.testOk = true;
  out.testMessageId = test.result?.message_id ?? null;
  out.ok = true;
  return out;
}
