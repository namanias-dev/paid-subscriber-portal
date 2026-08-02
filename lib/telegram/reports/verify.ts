/**
 * One-shot channel validation for Settings → Reports Test post / cron verify.
 * Accepts channel or supergroup; rejects private. No discovery.
 */
import { getChat, getMe, sendMessage } from "../botApi";
import { tgLog } from "../log";
import {
  getReportSettings,
  maskChannelId,
  normalizeChannelId,
} from "./settings";
import { assertReportsChannel } from "./channelGuard";

export interface ChannelVerifyResult {
  ok: boolean;
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
  const settings = await getReportSettings();
  const raw = settings.channel_id || (process.env.TELEGRAM_REPORTS_CHANNEL_ID || "").trim();
  const out: ChannelVerifyResult = {
    ok: false,
    channelIdMasked: null,
    channelIdNormalized: null,
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

  const guarded = await assertReportsChannel(raw);
  if (!guarded.ok || !guarded.id) {
    out.getChatError = guarded.error || "channel_not_configured";
    tgLog("reports_getChat_failed", { error: out.getChatError }, "error");
    return out;
  }

  out.getChatOk = true;
  out.channelIdNormalized = guarded.id;
  out.channelIdMasked = maskChannelId(guarded.id);
  out.chatTitle = guarded.title;
  out.chatType = guarded.type;

  if (opts?.sendTest === false) {
    out.ok = true;
    return out;
  }

  const test = await sendMessage({
    chat_id: guarded.id,
    text: `✅ Reports channel linked · @${out.botUsername || "bot"} · ${new Date().toISOString()}`,
    disable_notification: true,
    disable_web_page_preview: true,
  });
  if (!test.ok) {
    out.testError = test.description || `error_${test.error_code || "unknown"}`;
    tgLog("reports_test_failed", { channel: out.channelIdMasked, error: out.testError }, "error");
    return out;
  }
  out.testOk = true;
  out.testMessageId = test.result?.message_id ?? null;
  out.ok = true;
  return out;
}

/** Validate a candidate id (settings save / test post). */
export async function validateReportsChannelId(raw: string): Promise<{
  ok: boolean;
  id: string | null;
  title: string | null;
  type: string | null;
  error: string | null;
}> {
  const n = normalizeChannelId(raw);
  if (!n) return { ok: false, id: null, title: null, type: null, error: "channel_not_configured" };
  const chat = await getChat(n);
  if (!chat.ok || !chat.result) {
    return {
      ok: false,
      id: n,
      title: null,
      type: null,
      error: chat.description || `error_${chat.error_code || "unknown"}`,
    };
  }
  if (chat.result.type === "private") {
    return {
      ok: false,
      id: n,
      title: null,
      type: "private",
      error: "Rejected: chat type is private (need channel or supergroup)",
    };
  }
  if (chat.result.type !== "channel" && chat.result.type !== "supergroup") {
    return {
      ok: false,
      id: n,
      title: chat.result.title || null,
      type: chat.result.type,
      error: `Unsupported chat type: ${chat.result.type}`,
    };
  }
  return {
    ok: true,
    id: String(chat.result.id),
    title: chat.result.title || null,
    type: chat.result.type,
    error: null,
  };
}
