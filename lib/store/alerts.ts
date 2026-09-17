/**
 * Store ops alerts.
 *
 * Uses the low-level bot API and the existing reports channel resolution, in
 * exactly the way lib/telegram/feeHealthAlert.ts already does from the course
 * cron. It adds no Telegram event type and touches no dispatch schedule — it is
 * a direct send at the moment something is wrong.
 *
 * Never throws: an alert failing must never take down a payment path.
 */
import { sendMessage } from "@/lib/telegram/botApi";
import { getReportSettings, resolveReportsChannelId } from "@/lib/telegram/reports/settings";
import { assertReportsChannel } from "@/lib/telegram/reports/channelGuard";
import { tgLog } from "@/lib/telegram/log";

export async function storeOpsAlert(html: string): Promise<boolean> {
  try {
    const settings = await getReportSettings();
    const resolved = resolveReportsChannelId(settings);
    const guarded = await assertReportsChannel(resolved);
    if (!guarded.ok || !guarded.id) {
      tgLog("store_alert_no_channel", { error: guarded.error }, "warn");
      return false;
    }
    const res = await sendMessage({
      chat_id: guarded.id,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      disable_notification: false,
    });
    return !!res.ok;
  } catch (e) {
    tgLog("store_alert_failed", { error: (e as Error).message }, "error");
    return false;
  }
}

/**
 * A store reference turned up somewhere it should not have, or a reference we do
 * not recognise turned up on a store endpoint. Both are silent-failure classes
 * that would otherwise take weeks to notice, so they page ops immediately.
 */
export async function alertStoreMisroute(detail: {
  where: string;
  referenceNo: string;
  note: string;
}): Promise<void> {
  const safe = (s: string) => String(s).replace(/[<>&]/g, "");
  await storeOpsAlert(
    [
      "🚨 <b>Notes Store payment misroute</b>",
      `where: <code>${safe(detail.where)}</code>`,
      `reference: <code>${safe(detail.referenceNo)}</code>`,
      safe(detail.note),
    ].join("\n"),
  );
}
