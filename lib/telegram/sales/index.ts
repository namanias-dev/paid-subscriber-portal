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
  salesAlertPartialPayment,
  salesAlertPaymentSucceeded,
  salesAlertWebinarRegistration,
  salesAlertWebinarPayment,
  salesAlertNewLead,
  flushSalesQueuedAlerts,
  sweepSalesOutbox,
} from "./send";
export { proveSalesPipeline, proveSalesDedupe } from "./prove";
export { purgeFixtureSalesMessages, listFixtureSalesOutbox, isSalesFixturePayload } from "./purgeFixtures";
export { reportUnpaidInvariantGap } from "./unpaidGapReport";
export { salesRealEventWouldFire } from "./deliver";
export { runSalesDigestIfDue, buildSalesDigestHtml, salesDigestDueNow } from "./digest";
export { sweepCheckoutAbandoned, fireAbandonSweep } from "./abandoned";
export {
  countSalesWebinarRegistrationsSoFar,
  legacyRawWebinarRegistrationRowCount,
  countDistinctWebinarRegistrationPhones,
} from "./webinarRegistrationCount";
export {
  formatSalesWebinarRegistrationHtml,
  formatWebinarRegistrationAmountLine,
} from "./send";
export {
  salesAlertsEnabled,
  salesDigestEnabled,
  salesLeadBatchingEnabled,
  salesLeadBatchIntervalMinutes,
  ensureSalesFlagRows,
  setSalesFlagsEnabled,
} from "./settings";
export {
  resolveSalesAlertsCutoff,
  purgePreCutoffSalesOutbox,
  countSalesOutboxPending,
  isBeforeSalesCutoff,
} from "./cutoff";
export { maskPhone, salesInr } from "./format";
export { inSalesQuietHours, RATE_LIMIT_PER_MIN, alreadyDeduped } from "./dedupe";
export {
  runSalesTodaySeed,
  collectTodaySalesSeedEvents,
  proveSeedDedup,
  finishSalesSeedDigest,
  editSeedMessagesInPlace,
  SEED_DAY,
} from "./seed";

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
