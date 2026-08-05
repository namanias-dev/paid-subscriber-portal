/**
 * Sales & Admissions Telegram channel — lead-conversion alerts only.
 * Never blocks payments / proofs / checkout / ops channel.
 */
export { sendToChannel, salesChannelConfigured, type TelegramChannel } from "../channels";
export {
  fireSalesAlert,
  salesAlertPaymentFailed,
  salesAlertCheckoutAbandoned,
  salesAlertLinkExpired,
  salesAlertInstallmentProof,
  salesAlertWebinarProof,
  salesAlertAdmission,
  salesAlertInstallmentPaid,
  salesAlertPaymentSucceeded,
  flushSalesQueuedAlerts,
} from "./send";
export { runSalesDigestIfDue, buildSalesDigestHtml, salesDigestDueNow } from "./digest";
export { sweepCheckoutAbandoned, fireAbandonSweep } from "./abandoned";
export {
  salesAlertsEnabled,
  salesDigestEnabled,
  ensureSalesFlagRows,
  setSalesFlagsEnabled,
} from "./settings";
export { maskPhone, salesInr } from "./format";
export { inSalesQuietHours, RATE_LIMIT_PER_MIN, alreadyDeduped } from "./dedupe";
export { runSalesTodaySeed, collectTodaySalesSeedEvents, proveSeedDedup, SEED_DAY } from "./seed";

/** Optional one-shot smoke (gated — never on every deploy). */
export async function maybeSalesSmokeMessage(): Promise<boolean> {
  if ((process.env.TELEGRAM_SALES_SMOKE || "").trim() !== "1") return false;
  const { sendToChannel, salesChannelConfigured } = await import("../channels");
  if (!salesChannelConfigured()) return false;
  const { ensureSalesFlagRows } = await import("./settings");
  await ensureSalesFlagRows();
  const res = await sendToChannel("sales", {
    text: "✅ <b>Sales channel connected</b>\nNaman IAS — Sales &amp; Admissions\nSmoke test (TELEGRAM_SALES_SMOKE=1).",
    parse_mode: "HTML",
    disable_notification: true,
  });
  return !!res.ok;
}
