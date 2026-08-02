/**
 * Ensure digests/alerts only target a real channel/supergroup — never a private user DM.
 */
import { getChat } from "../botApi";
import { maskChannelId, normalizeChannelId } from "./settings";

export async function assertReportsChannel(
  raw: string | null | undefined,
): Promise<{
  ok: boolean;
  id: string | null;
  title: string | null;
  type: string | null;
  error: string | null;
}> {
  const id = normalizeChannelId(raw || "");
  if (!id) {
    return { ok: false, id: null, title: null, type: null, error: "channel_not_configured" };
  }
  const chat = await getChat(id);
  if (!chat.ok || !chat.result) {
    return {
      ok: false,
      id,
      title: null,
      type: null,
      error: chat.description || `error_${chat.error_code || "unknown"}`,
    };
  }
  const type = chat.result.type;
  if (type === "private") {
    return {
      ok: false,
      id,
      title: null,
      type,
      error: `${maskChannelId(id)} is a private user chat — refusing to send reports there`,
    };
  }
  if (type !== "channel" && type !== "supergroup") {
    return {
      ok: false,
      id,
      title: chat.result.title || null,
      type,
      error: `unsupported chat type ${type}`,
    };
  }
  return {
    ok: true,
    id: String(chat.result.id),
    title: chat.result.title || null,
    type,
    error: null,
  };
}
