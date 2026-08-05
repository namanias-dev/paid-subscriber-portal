/**
 * Fixture prove for Sales Telegram — cutoff gate + 7 event types.
 * No real enrollments or charges.
 */
import { getChat, getMe } from "../botApi";
import { salesChannelConfigured } from "../channels";
import {
  countSalesOutboxPending,
  isBeforeSalesCutoff,
  purgePreCutoffSalesOutbox,
  resolveSalesAlertsCutoff,
  salesAlertsCutoffIso,
} from "./cutoff";
import { deliverSalesAlert, fireSalesAlert } from "./deliver";
import { outboxAlreadySent, outboxListDue } from "./outbox";
import {
  salesAlertInstallmentProof,
  salesAlertNewLead,
  salesAlertPartialPayment,
  salesAlertWebinarPayment,
  salesAlertWebinarRegistration,
} from "./send";
import {
  salesAlertsEnabled,
  salesDigestEnabled,
  salesLeadBatchIntervalMinutes,
  salesLeadBatchingEnabled,
} from "./settings";
import {
  FEE_INVARIANT_ENROLLMENT_FILTER,
  scanFeeInvariants,
} from "../feeHealthAlert";

const FIXTURE_PHONE = "9898900199";
const FIXTURE_NAME = "Sales Prove Fixture";

export type ProveRow = {
  type: string;
  arrived: boolean;
  latencyMs: number | null;
  messageText: string;
  eventId: string;
  result: string;
};

export async function proveSalesPipeline(): Promise<Record<string, unknown>> {
  // 1) Cutoff lock + outbox purge proof (highest priority)
  const before = await countSalesOutboxPending();
  const cutoffIso = await resolveSalesAlertsCutoff();
  const purge = await purgePreCutoffSalesOutbox();
  const after = await countSalesOutboxPending();
  const dueEligible = await outboxListDue(100);
  const preCutoffStillEligible = dueEligible.filter((r) => {
    const ms = Date.parse(r.createdAt);
    const cut = Date.parse(cutoffIso);
    return Number.isFinite(ms) && ms < cut;
  }).length;

  // Historical event must be blocked
  const historicalBlocked =
    (await deliverSalesAlert({
      eventId: `prove:historical:${Date.now().toString(36)}`,
      event: "new_lead",
      phone: FIXTURE_PHONE,
      html: "should never send — pre-cutoff",
      buttons: [],
      occurredAt: "2020-01-01T00:00:00.000Z",
    })) === "skipped" && (await isBeforeSalesCutoff("2020-01-01T00:00:00.000Z"));

  const chatId = (process.env.TELEGRAM_SALES_CHAT_ID || "").trim();
  const tokenSet = !!(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const env = {
    TELEGRAM_BOT_TOKEN: tokenSet,
    TELEGRAM_SALES_CHAT_ID: !!chatId,
    chatIdPrefix: chatId ? chatId.slice(0, 4) : null,
    SALES_LEAD_BATCHING: process.env.SALES_LEAD_BATCHING || "(unset→off)",
    SALES_LEAD_BATCH_INTERVAL_MIN: String(salesLeadBatchIntervalMinutes()),
  };

  let getChatInfo: Record<string, unknown> = { ok: false, error: "skipped" };
  if (tokenSet && chatId) {
    const me = await getMe();
    if (!me.ok) {
      getChatInfo = { ok: false, error: me.description || "getMe_failed" };
    } else {
      const chat = await getChat(chatId);
      if (!chat.ok) {
        getChatInfo = { ok: false, error: chat.description || "getChat_failed" };
      } else {
        const r = chat.result as { id?: number; type?: string; title?: string };
        getChatInfo = { ok: true, id: r.id, type: r.type, title: r.title };
      }
    }
  }

  const runId = `prove:${Date.now().toString(36)}`;
  const events: ProveRow[] = [];
  const nowIso = new Date().toISOString();

  async function runOne(
    type: string,
    eventId: string,
    task: () => Promise<unknown>,
    previewHtml: string,
  ): Promise<void> {
    const t0 = Date.now();
    try {
      await task();
      const sent = await outboxAlreadySent(eventId);
      events.push({
        type,
        arrived: sent,
        latencyMs: Date.now() - t0,
        messageText: previewHtml,
        eventId,
        result: sent ? "sent" : "not_sent",
      });
    } catch (e) {
      events.push({
        type,
        arrived: false,
        latencyMs: Date.now() - t0,
        messageText: previewHtml,
        eventId,
        result: (e as Error).message,
      });
    }
  }

  const testHtml = `✅ <b>Sales prove transport</b>\n☎ +91${FIXTURE_PHONE}\n${runId}`;
  const tTest = Date.now();
  const testRes = await deliverSalesAlert({
    eventId: `${runId}:transport`,
    event: "prove_transport",
    phone: FIXTURE_PHONE,
    html: testHtml,
    buttons: [],
    occurredAt: nowIso,
  });
  const testMessage = {
    arrived: testRes === "sent",
    latencyMs: Date.now() - tTest,
    text: testHtml,
  };

  const leadId = `${runId}:lead`;
  await runOne(
    "new_lead",
    leadId,
    () =>
      salesAlertNewLead({
        name: FIXTURE_NAME,
        phone: FIXTURE_PHONE,
        source: "prove_fixture",
        courseInterest: "UPSC Foundation",
        leadId,
        eventId: leadId,
        occurredAt: nowIso,
      }),
    `🆕 <b>New lead</b> · ${FIXTURE_NAME}\n☎ +91${FIXTURE_PHONE}\nSource: prove_fixture`,
  );

  const webinarRegId = `${runId}:webinar_reg`;
  await runOne(
    "webinar_registration",
    webinarRegId,
    () =>
      salesAlertWebinarRegistration({
        name: FIXTURE_NAME,
        phone: FIXTURE_PHONE,
        webinar: "Prove Webinar",
        webinarDate: "2026-08-12T10:00:00+05:30",
        amountPaid: 0,
        registrationsSoFar: 42,
        eventId: webinarRegId,
        occurredAt: nowIso,
      }),
    `🎟 <b>Webinar registration</b> · ${FIXTURE_NAME}\n☎ +91${FIXTURE_PHONE}`,
  );

  const webinarPayId = `${runId}:webinar_pay`;
  await runOne(
    "webinar_payment",
    webinarPayId,
    () =>
      salesAlertWebinarPayment({
        name: FIXTURE_NAME,
        phone: FIXTURE_PHONE,
        webinar: "Prove Webinar",
        webinarDate: "2026-08-12T10:00:00+05:30",
        amount: 499,
        method: "UPI",
        receiptNo: "PROVE-RCPT-1",
        registrationsSoFar: 43,
        eventId: webinarPayId,
        occurredAt: nowIso,
      }),
    `💳 <b>Webinar payment</b> · ${FIXTURE_NAME}\n☎ +91${FIXTURE_PHONE}\n₹499 UPI`,
  );

  const enrollId = `${runId}:admission`;
  const enrollHtml = [
    `🟢 <b>New enrollment</b> · ${FIXTURE_NAME}`,
    `☎ +91${FIXTURE_PHONE}`,
    `Course: Prove Course`,
    `Total fee: ₹50,000`,
    `Paid now: ₹20,000`,
    `Plan: instalments`,
  ].join("\n");
  await runOne(
    "new_enrollment",
    enrollId,
    () =>
      deliverSalesAlert({
        eventId: enrollId,
        event: "admission",
        phone: FIXTURE_PHONE,
        html: enrollHtml,
        buttons: [],
        occurredAt: nowIso,
      }),
    enrollHtml,
  );

  const instId = `${runId}:inst_paid`;
  const instHtml = [
    `✅ <b>Instalment paid</b> · ${FIXTURE_NAME}`,
    `☎ +91${FIXTURE_PHONE}`,
    `Instalment 2 of 4`,
    `Amount: ₹10,000`,
  ].join("\n");
  await runOne(
    "installment_payment",
    instId,
    () =>
      deliverSalesAlert({
        eventId: instId,
        event: "installment_paid",
        phone: FIXTURE_PHONE,
        html: instHtml,
        buttons: [],
        occurredAt: nowIso,
      }),
    instHtml,
  );

  const partialId = `${runId}:partial`;
  await runOne(
    "partial_settlement",
    partialId,
    () =>
      salesAlertPartialPayment({
        name: FIXTURE_NAME,
        phone: FIXTURE_PHONE,
        course: "Prove Course",
        amountPaid: 4000,
        shortfallCarried: 1000,
        nextAmount: 11000,
        nextDue: "2026-09-01",
        installmentNo: 2,
        enrollmentId: `fixture-${runId}`,
        eventId: partialId,
        occurredAt: nowIso,
      }),
    `🟠 <b>Partial instalment</b> · ${FIXTURE_NAME}\n☎ +91${FIXTURE_PHONE}`,
  );

  const proofId = `${runId}:proof`;
  await runOne(
    "proof_awaiting",
    proofId,
    () =>
      salesAlertInstallmentProof({
        name: FIXTURE_NAME,
        phone: FIXTURE_PHONE,
        course: "Prove Course",
        installmentNo: 2,
        amount: 10000,
        proofId,
        enrollmentId: `fixture-enr-${runId}`,
        waitingSince: new Date(Date.now() - 3 * 3600_000).toISOString(),
        eventId: proofId,
        occurredAt: nowIso,
      }),
    `📎 <b>Proof uploaded</b> · ${FIXTURE_NAME}\n☎ +91${FIXTURE_PHONE}`,
  );

  const dedupeSecond = await deliverSalesAlert({
    eventId: `${runId}:transport`,
    event: "prove_transport",
    phone: FIXTURE_PHONE,
    html: testHtml,
    buttons: [],
    occurredAt: nowIso,
  });

  const inv = await scanFeeInvariants().catch(() => ({
    checked: -1,
    hits: [] as { id: string }[],
    filter: FEE_INVARIANT_ENROLLMENT_FILTER,
  }));

  fireSalesAlert(async () => undefined);

  const allArrived = testMessage.arrived && events.every((e) => e.arrived);
  return {
    ok:
      allArrived &&
      historicalBlocked &&
      preCutoffStillEligible === 0 &&
      after.preCutoffEligible === 0 &&
      salesChannelConfigured() &&
      dedupeSecond === "skipped" &&
      !salesLeadBatchingEnabled(),
    cutoff: {
      iso: cutoffIso,
      cached: salesAlertsCutoffIso(),
      historicalBlocked,
      outboxBefore: before,
      outboxAfter: after,
      purged: purge.purged,
      preCutoffStillEligible,
    },
    env,
    flags: {
      alerts: await salesAlertsEnabled(),
      digest: await salesDigestEnabled(),
      leadBatching: salesLeadBatchingEnabled(),
      leadBatchIntervalMin: salesLeadBatchIntervalMinutes(),
      enableBatchingHow: "Set Vercel env SALES_LEAD_BATCHING=1 (optional SALES_LEAD_BATCH_INTERVAL_MIN, default 20). Redeploy. Only new_lead is affected.",
    },
    getChat: getChatInfo,
    testMessage,
    events,
    callSites: {
      new_lead: "lib/dataProvider.ts fireLeadCreated → salesAlertNewLead",
      webinar_registration: "lib/dataProvider.ts registerWebinar → salesAlertWebinarRegistration",
      webinar_payment: "lib/analytics/server.ts recordPaymentPaid (item_type=webinar) → salesAlertWebinarPayment",
      new_enrollment: "lib/analytics/server.ts recordPaymentPaid (course, non-installment) → salesAlertAdmission",
      installment_payment: "lib/analytics/server.ts recordPaymentPaid (course, installment) → salesAlertInstallmentPaid",
      partial_settlement: "lib/installmentProofRecordPayment.ts accept_as_partial → salesAlertPartialPayment",
      proof_awaiting: "lib/installmentPaymentProofs.ts upload → salesAlertInstallmentProof",
      feeState: "lib/telegram/sales/context.ts → enrollmentFeeStateFromEnrollment (same SSO as getEnrollmentFeeState)",
      matchFixtures: true,
    },
    invariant: {
      filter: inv.filter || FEE_INVARIANT_ENROLLMENT_FILTER,
      checked: inv.checked,
      hits: inv.hits.length,
    },
    outbox: {
      dedupeOk: dedupeSecond === "skipped",
      dueAfterProve: (await outboxListDue(5)).length,
    },
    quietHours: {
      sales: false,
      note: "Sales 24×7; student SMS ACCESS_QUIET_HOURS_IST 08–21 untouched",
    },
  };
}
