/**
 * Fixture prove for Sales Telegram — no real enrollments or charges.
 * Calls deliverSalesAlert directly (awaited) so latency is measurable.
 */
import { getChat, getMe } from "../botApi";
import { salesChannelConfigured } from "../channels";
import { deliverSalesAlert, fireSalesAlert } from "./deliver";
import { outboxAlreadySent, outboxHasDueWork, outboxListDue } from "./outbox";
import {
  salesAlertNewLead,
  salesAlertPartialPayment,
  salesAlertInstallmentProof,
  salesAlertWebinarPayment,
  salesAlertWebinarRegistration,
} from "./send";
import { salesAlertsEnabled, salesDigestEnabled } from "./settings";

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

export async function proveSalesPipeline(): Promise<{
  ok: boolean;
  root: string;
  env: { TELEGRAM_BOT_TOKEN: boolean; TELEGRAM_SALES_CHAT_ID: boolean; chatIdPrefix: string | null };
  flags: { alerts: boolean; digest: boolean };
  getChat: { ok: boolean; id?: number | string; type?: string; title?: string; error?: string };
  testMessage: { arrived: boolean; latencyMs: number | null; text: string };
  events: ProveRow[];
  outbox: { emptyBefore: boolean; dueAfter: number; dedupeOk: boolean };
  quietHours: { sales: false; note: string };
}> {
  const chatId = (process.env.TELEGRAM_SALES_CHAT_ID || "").trim();
  const tokenSet = !!(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const env = {
    TELEGRAM_BOT_TOKEN: tokenSet,
    TELEGRAM_SALES_CHAT_ID: !!chatId,
    chatIdPrefix: chatId ? chatId.slice(0, 4) : null,
  };

  let getChatInfo: {
    ok: boolean;
    id?: number | string;
    type?: string;
    title?: string;
    error?: string;
  } = { ok: false, error: "skipped" };
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

  const emptyBefore = !(await outboxHasDueWork());
  const runId = `prove:${Date.now().toString(36)}`;
  const events: ProveRow[] = [];

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
      }),
    `🆕 <b>New lead</b> · ${FIXTURE_NAME}\n☎ +91${FIXTURE_PHONE}\nSource: prove_fixture\nCourse interest: UPSC Foundation`,
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
      }),
    `🎟 <b>Webinar registration</b> · ${FIXTURE_NAME}\n☎ +91${FIXTURE_PHONE}\nWebinar: Prove Webinar\nAmount paid: free\nRegistrations so far: 42`,
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
      }),
    `💳 <b>Webinar payment</b> · ${FIXTURE_NAME}\n☎ +91${FIXTURE_PHONE}\nWebinar: Prove Webinar\nAmount: ₹499\nMethod: UPI\nReceipt: PROVE-RCPT-1`,
  );

  const enrollId = `${runId}:admission`;
  const enrollHtml = [
    `🟢 <b>New enrollment</b> · ${FIXTURE_NAME}`,
    `☎ +91${FIXTURE_PHONE}`,
    `Course: Prove Course`,
    `Total fee: ₹50,000`,
    `Discount: ₹5,000`,
    `Paid now: ₹20,000`,
    `Paid to date: ₹20,000`,
    `Remaining: ₹25,000`,
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
      }),
    enrollHtml,
  );

  const instId = `${runId}:inst_paid`;
  const instHtml = [
    `✅ <b>Instalment paid</b> · ${FIXTURE_NAME}`,
    `☎ +91${FIXTURE_PHONE}`,
    `Course: Prove Course`,
    `Instalment 2 of 4`,
    `Amount: ₹10,000`,
    `Fee ₹50,000 · Paid ₹30,000 · Balance ₹20,000`,
    `Next instalment: ₹10,000 · due 12 Aug`,
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
      }),
    `🟠 <b>Partial instalment</b> · ${FIXTURE_NAME}\n☎ +91${FIXTURE_PHONE}\nPaid now: ₹4,000\nShortfall carried: ₹1,000\nNext instalment: ₹11,000 · due 01 Sep`,
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
      }),
    `📎 <b>Proof uploaded — needs review</b> · ${FIXTURE_NAME}\n☎ +91${FIXTURE_PHONE}\nInstalment 2\nClaimed: ₹10,000\nWaiting: 3h`,
  );

  const dedupeSecond = await deliverSalesAlert({
    eventId: `${runId}:transport`,
    event: "prove_transport",
    phone: FIXTURE_PHONE,
    html: testHtml,
    buttons: [],
  });
  const dueAfter = (await outboxListDue(5)).length;

  const alerts = await salesAlertsEnabled();
  const digest = await salesDigestEnabled();
  fireSalesAlert(async () => undefined);

  const allArrived = testMessage.arrived && events.every((e) => e.arrived);
  return {
    ok: allArrived && salesChannelConfigured() && dedupeSecond === "skipped",
    root: allArrived
      ? "transport_ok_fixtures_delivered"
      : !tokenSet || !chatId
        ? "config_missing"
        : "delivery_incomplete",
    env,
    flags: { alerts, digest },
    getChat: getChatInfo,
    testMessage,
    events,
    outbox: {
      emptyBefore,
      dueAfter,
      dedupeOk: dedupeSecond === "skipped",
    },
    quietHours: {
      sales: false,
      note: "Sales has no quiet hours; student SMS ACCESS_QUIET_HOURS_IST 08–21 untouched",
    },
  };
}
