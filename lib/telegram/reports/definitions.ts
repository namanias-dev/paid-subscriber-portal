/**
 * Permanent reporting definitions for the executive-brief channel.
 * Updated in place. A failed description or pin does not fail the digest.
 */
import { editMessageText, getChat, pinChatMessage, sendMessage, setChatDescription } from "../botApi";
import { tgLog } from "../log";
import { REPORTING_CHANNEL_DESCRIPTION, reportingDefinitionsHtml } from "./definitionCopy";
import { getSnapshotBySlot, saveSnapshot } from "./snapshots";

export const DEFINITIONS_SLOT = "reporting_definitions";
export { REPORTING_CHANNEL_DESCRIPTION, reportingDefinitionsHtml } from "./definitionCopy";

function messageIdOf(metrics: Record<string, number | string | null | undefined> | undefined): number | null {
  const raw = metrics?.message_id;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Set the short channel description and keep one pinned definitions message.
 * Does not change channel identity, membership, privacy, or administrators.
 */
export async function ensureReportingReference(chatId: string): Promise<{
  descriptionSet: boolean;
  pinned: boolean;
}> {
  const html = reportingDefinitionsHtml();
  let descriptionSet = false;
  let pinned = false;
  try {
    const described = await setChatDescription(chatId, REPORTING_CHANNEL_DESCRIPTION);
    descriptionSet = described.ok === true;
    if (!described.ok) {
      tgLog("report_description_failed", { error: described.description || described.error_code }, "warn");
    }

    const chat = await getChat(chatId);
    const snap = await getSnapshotBySlot(DEFINITIONS_SLOT);
    let messageId = messageIdOf(snap?.metrics);

    if (messageId) {
      const edited = await editMessageText({
        chat_id: chatId,
        message_id: messageId,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      const unchanged = /message is not modified/i.test(edited.description || "");
      if (!edited.ok && !unchanged) messageId = null;
    }

    if (!messageId) {
      const sent = await sendMessage({
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        disable_notification: true,
      });
      if (!sent.ok || sent.result?.message_id == null) {
        tgLog("report_definitions_send_failed", { error: sent.description || sent.error_code }, "warn");
        return { descriptionSet, pinned: false };
      }
      messageId = sent.result.message_id;
    }

    const currentPin = chat.ok ? chat.result?.pinned_message?.message_id : undefined;
    if (currentPin !== messageId) {
      const pin = await pinChatMessage(chatId, messageId);
      pinned = pin.ok === true;
      if (!pin.ok) tgLog("report_definitions_pin_failed", { error: pin.description || pin.error_code }, "warn");
    } else {
      pinned = true;
    }

    await saveSnapshot({
      slotKey: DEFINITIONS_SLOT,
      kind: "definitions",
      metrics: { message_id: messageId },
      messageHtml: html,
    });
  } catch (e) {
    tgLog("report_definitions_failed", { error: (e as Error).message }, "warn");
  }
  return { descriptionSet, pinned };
}
