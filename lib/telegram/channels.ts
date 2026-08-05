/**
 * Channel-aware Telegram send. Ops and sales are fully independent:
 * a misconfigured / failing sales chat never touches ops, and vice versa.
 */
import { sendMessage, type SendMessageOpts, type TelegramApiResult } from "./botApi";
import { tgLog } from "./log";

export type TelegramChannel = "ops" | "sales";

function salesChatId(): string | null {
  const id = (process.env.TELEGRAM_SALES_CHAT_ID || "").trim();
  return id || null;
}

/**
 * Send to ops or sales. Never throws.
 * - sales: uses TELEGRAM_SALES_CHAT_ID; unset → silent no-op ({ ok:false }).
 * - ops: requires opts.chat_id (existing callers keep resolving their own channel).
 */
export async function sendToChannel(
  channel: TelegramChannel,
  opts: Omit<SendMessageOpts, "chat_id"> & { chat_id?: string | number },
): Promise<TelegramApiResult<{ message_id: number }>> {
  try {
    if (channel === "sales") {
      const id = salesChatId();
      if (!id) {
        return { ok: false, error_code: 0, description: "sales_chat_unset" };
      }
      return await sendMessage({ ...opts, chat_id: id });
    }
    if (opts.chat_id == null || opts.chat_id === "") {
      return { ok: false, error_code: 0, description: "ops_chat_required" };
    }
    return await sendMessage({ ...opts, chat_id: opts.chat_id });
  } catch (e) {
    tgLog(
      "sendToChannel_exception",
      { channel, error: (e as Error).message },
      "error",
    );
    return { ok: false, error_code: 0, description: (e as Error).message || "send_exception" };
  }
}

export function salesChannelConfigured(): boolean {
  return !!salesChatId();
}
