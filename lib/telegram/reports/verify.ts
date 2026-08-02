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
  diagnosis: string | null;
}

async function tryChat(
  id: string,
): Promise<{
  ok: boolean;
  id: string;
  type?: string;
  title?: string;
  error?: string;
}> {
  const chat = await getChat(id);
  if (!chat.ok || !chat.result) {
    return { ok: false, id, error: chat.description || `error_${chat.error_code || "unknown"}` };
  }
  return {
    ok: true,
    id,
    type: chat.result.type,
    title: chat.result.title,
  };
}

export async function verifyReportsChannel(opts?: {
  sendTest?: boolean;
}): Promise<ChannelVerifyResult> {
  const envRaw = (process.env.TELEGRAM_REPORTS_CHANNEL_ID || "").trim();
  const settings = await getReportSettings();
  const candidates: string[] = [];
  const push = (v: string | null | undefined) => {
    const n = normalizeChannelId(v || "");
    if (n && !candidates.includes(n)) candidates.push(n);
    const raw = (v || "").trim();
    if (raw && !candidates.includes(raw)) candidates.push(raw);
    if (/^\d{9,}$/.test(raw)) {
      const pref = `-100${raw}`;
      if (!candidates.includes(pref)) candidates.push(pref);
    }
  };
  push(settings.channel_id);
  push(envRaw);

  const out: ChannelVerifyResult = {
    ok: false,
    envPresent: envRaw.length > 0 || !!(settings.channel_id && settings.channel_id.trim()),
    envRawLen: envRaw.length,
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
    diagnosis: null,
  };

  const me = await getMe();
  if (me.ok && me.result) {
    out.botUsername = me.result.username || me.result.first_name || null;
  }

  if (!candidates.length) {
    out.getChatError = "channel_not_configured";
    out.diagnosis = "No TELEGRAM_REPORTS_CHANNEL_ID and no settings.channel_id.";
    return out;
  }

  let chosen: { id: string; type?: string; title?: string } | null = null;
  const errors: string[] = [];
  for (const id of candidates) {
    const r = await tryChat(id);
    if (!r.ok) {
      errors.push(`${maskChannelId(id)}: ${r.error}`);
      continue;
    }
    if (r.type === "channel" || r.type === "supergroup") {
      chosen = r;
      break;
    }
    if (r.type === "private") {
      errors.push(
        `${maskChannelId(id)} is a PRIVATE USER chat — digests would DM a person, not the Ops channel.`,
      );
      out.diagnosis =
        "TELEGRAM_REPORTS_CHANNEL_ID points at a private user chat_id (not a channel). Paste the channel id (usually starts with -100…).";
    } else {
      errors.push(`${maskChannelId(id)} type=${r.type}`);
    }
  }

  if (!chosen) {
    out.getChatError = errors[0] || "chat_not_found";
    if (!out.diagnosis) out.diagnosis = errors.join(" | ");
    tgLog("reports_getChat_failed", { errors }, "error");
    return out;
  }

  out.getChatOk = true;
  out.channelIdNormalized = chosen.id;
  out.channelIdMasked = maskChannelId(chosen.id);
  out.chatTitle = chosen.title || null;
  out.chatType = chosen.type || null;

  if (opts?.sendTest === false) {
    out.ok = true;
    return out;
  }

  const test = await sendMessage({
    chat_id: chosen.id,
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
