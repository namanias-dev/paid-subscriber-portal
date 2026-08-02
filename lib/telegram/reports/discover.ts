/**
 * Discover / validate the reports channel ID.
 * Handles the common mistake of pasting a private user chat_id instead of a channel id.
 */
import { callMethod, getChat, getMe, sendMessage } from "../botApi";
import { tgLog } from "../log";
import { reregisterWebhook } from "../status";
import {
  getReportSettings,
  maskChannelId,
  normalizeChannelId,
  updateReportSettings,
} from "./settings";
import { verifyReportsChannel, type ChannelVerifyResult } from "./verify";

function extractChatsFromUpdates(updates: unknown[]): { id: string; type: string; title: string | null }[] {
  const out: { id: string; type: string; title: string | null }[] = [];
  const seen = new Set<string>();
  for (const u of updates) {
    if (!u || typeof u !== "object") continue;
    const o = u as Record<string, unknown>;
    const candidates = [
      (o.message as { chat?: Record<string, unknown> } | undefined)?.chat,
      (o.channel_post as { chat?: Record<string, unknown> } | undefined)?.chat,
      (o.edited_channel_post as { chat?: Record<string, unknown> } | undefined)?.chat,
      (o.my_chat_member as { chat?: Record<string, unknown> } | undefined)?.chat,
      (o.chat_member as { chat?: Record<string, unknown> } | undefined)?.chat,
    ];
    for (const c of candidates) {
      if (!c || c.id == null) continue;
      const id = String(c.id);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        type: String(c.type || ""),
        title: c.title != null ? String(c.title) : null,
      });
    }
  }
  return out;
}

export async function diagnoseAndDiscoverChannel(): Promise<{
  ok: boolean;
  verify: ChannelVerifyResult;
  rawEnvLen: number;
  rawGetChat: { ok: boolean; type?: string; title?: string; error?: string };
  discovered: { id: string; type: string; title: string | null }[];
  chosen: string | null;
  savedToSettings: boolean;
  notes: string[];
}> {
  const notes: string[] = [];
  const envRaw = (process.env.TELEGRAM_REPORTS_CHANNEL_ID || "").trim();
  const settings = await getReportSettings();

  // 1) Probe raw env without -100 rewrite
  const rawGetChat: { ok: boolean; type?: string; title?: string; error?: string } = {
    ok: false,
  };
  if (envRaw) {
    const raw = await getChat(envRaw);
    if (raw.ok && raw.result) {
      rawGetChat.ok = true;
      rawGetChat.type = raw.result.type;
      rawGetChat.title = raw.result.title;
      if (raw.result.type === "private") {
        notes.push(
          `TELEGRAM_REPORTS_CHANNEL_ID=${envRaw} is a PRIVATE USER chat, not a channel. That is why Ops is empty — digests were DMing a user.`,
        );
      } else if (raw.result.type === "channel" || raw.result.type === "supergroup") {
        notes.push(`Raw env ID works as ${raw.result.type}: ${raw.result.title}`);
      }
    } else {
      rawGetChat.error = raw.description || "getChat_failed";
    }
  } else {
    notes.push("TELEGRAM_REPORTS_CHANNEL_ID is empty in this runtime.");
  }

  // 2) Brief getUpdates scan (deleteWebhook → getUpdates → restore)
  const discovered: { id: string; type: string; title: string | null }[] = [];
  try {
    await callMethod("deleteWebhook", { drop_pending_updates: false });
    const updates = await callMethod<{ update_id?: number }[]>("getUpdates", {
      limit: 100,
      timeout: 0,
      allowed_updates: ["message", "channel_post", "my_chat_member", "chat_member"],
    });
    if (updates.ok && Array.isArray(updates.result)) {
      discovered.push(...extractChatsFromUpdates(updates.result as unknown[]));
      notes.push(`getUpdates returned ${updates.result.length} update(s), ${discovered.length} chat(s).`);
    } else {
      notes.push(`getUpdates failed: ${updates.description || "unknown"}`);
    }
  } catch (e) {
    notes.push(`getUpdates exception: ${(e as Error).message}`);
  } finally {
    // Always restore webhook with channel updates enabled
    const restored = await reregisterWebhook();
    notes.push(restored.ok ? "Webhook restored." : `Webhook restore failed: ${restored.description}`);
  }

  // Prefer an Ops-named channel, else any channel
  const channels = discovered.filter((c) => c.type === "channel" || c.type === "supergroup");
  let chosen: string | null = null;
  const ops = channels.find((c) => /ops/i.test(c.title || ""));
  if (ops) chosen = ops.id;
  else if (channels[0]) chosen = channels[0].id;

  // If settings already has a working channel, keep it
  if (!chosen && settings.channel_id) {
    const existing = normalizeChannelId(settings.channel_id);
    if (existing) {
      const g = await getChat(existing);
      if (g.ok && (g.result?.type === "channel" || g.result?.type === "supergroup")) {
        chosen = existing;
        notes.push(`Using settings.channel_id ${maskChannelId(existing)}`);
      }
    }
  }

  // If raw env is already a channel, use it (normalized)
  if (!chosen && rawGetChat.ok && (rawGetChat.type === "channel" || rawGetChat.type === "supergroup")) {
    chosen = normalizeChannelId(envRaw);
  }

  let savedToSettings = false;
  if (chosen) {
    await updateReportSettings({ channel_id: chosen });
    savedToSettings = true;
    notes.push(`Saved channel ${maskChannelId(chosen)} to telegram_report_settings.`);
  } else {
    notes.push(
      "No channel chat discovered. Post any message in «Naman IAS — Ops» (bot is admin) OR remove+re-add the bot — webhook will capture the channel id automatically.",
    );
  }

  const verify = await verifyReportsChannel({ sendTest: !!chosen });
  return {
    ok: verify.ok,
    verify,
    rawEnvLen: envRaw.length,
    rawGetChat,
    discovered,
    chosen,
    savedToSettings,
    notes,
  };
}

/** Persist a channel id when webhook sees channel_post / my_chat_member / forward. */
export async function maybeCaptureReportsChannel(chat: {
  id: number | string;
  type?: string;
  title?: string | null;
}): Promise<{ captured: boolean; id: string | null }> {
  const type = String(chat.type || "");
  if (type !== "channel" && type !== "supergroup") return { captured: false, id: null };
  const id = normalizeChannelId(String(chat.id));
  if (!id) return { captured: false, id: null };
  const settings = await getReportSettings();
  // Always prefer an Ops-titled channel; otherwise fill if empty / broken env.
  const title = chat.title || "";
  const isOps = /ops/i.test(title) || /naman\s*ias/i.test(title);
  if (settings.channel_id && settings.channel_id === id) {
    return { captured: false, id };
  }
  if (settings.channel_id && !isOps) return { captured: false, id: null };
  await updateReportSettings({ channel_id: id });
  tgLog("reports_channel_captured", { id: maskChannelId(id), title }, "info");
  return { captured: true, id };
}

/** Accept a pasted channel id from a private DM (e.g. "-100…"). */
export async function maybeCaptureReportsChannelIdFromText(
  text: string,
): Promise<{ captured: boolean; id: string | null }> {
  const m = text.match(/(?:^|\s)(-100\d{8,}|-\d{10,})(?:\s|$)/);
  if (!m) return { captured: false, id: null };
  const id = normalizeChannelId(m[1]);
  if (!id) return { captured: false, id: null };
  const chat = await getChat(id);
  if (!chat.ok || !chat.result) return { captured: false, id: null };
  return maybeCaptureReportsChannel({
    id: chat.result.id,
    type: chat.result.type,
    title: chat.result.title,
  });
}

/** After capture: one-line test + morning digest (fire-and-forget safe to await in webhook). */
export async function kickoffReportsAfterChannelCapture(channelId: string): Promise<{
  testMessageId: number | null;
  digestMessageId: number | null;
  digestOk: boolean;
}> {
  const me = await getMe();
  const bot = me.ok && me.result ? me.result.username || "bot" : "bot";
  const test = await sendMessage({
    chat_id: channelId,
    text: `✅ Reports channel linked · @${bot} · ${new Date().toISOString()}`,
    disable_notification: true,
    disable_web_page_preview: true,
  });
  const { sendDigestNow } = await import("./digest");
  const digest = await sendDigestNow({
    force: true,
    skipIdempotency: true,
    morningExtras: true,
  });
  return {
    testMessageId: test.result?.message_id ?? null,
    digestMessageId: digest.messageId ?? null,
    digestOk: !!digest.ok,
  };
}
