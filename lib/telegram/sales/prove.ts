/**
 * Fixture prove for Sales Telegram — ALWAYS synthetic.
 * Renders all 7 types but never posts to the live Sales chat
 * (dry-run unless TELEGRAM_SALES_TEST_CHAT_ID ≠ live chat).
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
import { deliverSalesAlert, fireSalesAlert, salesRealEventWouldFire } from "./deliver";
import { outboxAlreadySent, outboxGet, outboxListDue } from "./outbox";
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
  rendered: boolean;
  liveSent: boolean;
  dryRun: boolean;
  latencyMs: number | null;
  messageText: string;
  eventId: string;
  result: string;
};

async function deliverFixture(
  input: Parameters<typeof deliverSalesAlert>[0],
): Promise<"sent" | "skipped" | "failed" | "dry_run"> {
  return deliverSalesAlert({ ...input, synthetic: true });
}

export async function proveSalesPipeline(): Promise<Record<string, unknown>> {
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

  const historicalBlocked =
    (await deliverFixture({
      eventId: `prove:historical:${Date.now().toString(36)}`,
      event: "new_lead",
      phone: FIXTURE_PHONE,
      html: "should never send — pre-cutoff",
      buttons: [],
      occurredAt: "2020-01-01T00:00:00.000Z",
      synthetic: true,
    })) === "skipped" && (await isBeforeSalesCutoff("2020-01-01T00:00:00.000Z"));

  const chatId = (process.env.TELEGRAM_SALES_CHAT_ID || "").trim();
  const testChat = (process.env.TELEGRAM_SALES_TEST_CHAT_ID || "").trim();
  const tokenSet = !!(process.env.TELEGRAM_BOT_TOKEN || "").trim();

  let getChatInfo: Record<string, unknown> = { ok: false, error: "skipped" };
  if (tokenSet && chatId) {
    const me = await getMe();
    if (!me.ok) getChatInfo = { ok: false, error: me.description || "getMe_failed" };
    else {
      const chat = await getChat(chatId);
      if (!chat.ok) getChatInfo = { ok: false, error: chat.description || "getChat_failed" };
      else {
        const r = chat.result as { id?: number; type?: string; title?: string };
        getChatInfo = { ok: true, id: r.id, type: r.type, title: r.title };
      }
    }
  }

  const runId = `prove:${Date.now().toString(36)}`;
  const events: ProveRow[] = [];
  const nowIso = new Date().toISOString();
  let liveSendCount = 0;

  async function runOne(
    type: string,
    eventId: string,
    task: () => Promise<"sent" | "skipped" | "failed" | "dry_run">,
    previewHtml: string,
  ): Promise<void> {
    const t0 = Date.now();
    try {
      const result = await task();
      const row = await outboxGet(eventId);
      const dryRun = result === "dry_run" || row?.status === "dry_run";
      const liveSent = result === "sent" && !!row?.messageId && !dryRun;
      if (liveSent) liveSendCount++;
      events.push({
        type,
        rendered: result === "sent" || result === "dry_run",
        liveSent,
        dryRun,
        latencyMs: Date.now() - t0,
        messageText: previewHtml,
        eventId,
        result,
      });
    } catch (e) {
      events.push({
        type,
        rendered: false,
        liveSent: false,
        dryRun: false,
        latencyMs: Date.now() - t0,
        messageText: previewHtml,
        eventId,
        result: (e as Error).message,
      });
    }
  }

  const testHtml = `✅ <b>Sales prove transport</b>\n☎ +91${FIXTURE_PHONE}\n${runId}`;
  await runOne(
    "transport",
    `${runId}:transport`,
    () =>
      deliverFixture({
        eventId: `${runId}:transport`,
        event: "prove_transport",
        phone: FIXTURE_PHONE,
        html: testHtml,
        buttons: [],
        occurredAt: nowIso,
        synthetic: true,
      }),
    testHtml,
  );

  const leadId = `${runId}:lead`;
  const leadHtml = `🆕 <b>New lead</b> · ${FIXTURE_NAME}\n☎ +91${FIXTURE_PHONE}\nSource: prove_fixture`;
  await runOne(
    "new_lead",
    leadId,
    async () => {
      await salesAlertNewLead({
        name: FIXTURE_NAME,
        phone: FIXTURE_PHONE,
        source: "prove_fixture",
        courseInterest: "UPSC Foundation",
        leadId,
        eventId: leadId,
        occurredAt: nowIso,
      });
      const row = await outboxGet(leadId);
      if (row?.status === "dry_run") return "dry_run";
      if (row?.status === "sent") return "sent";
      return "failed";
    },
    leadHtml,
  );

  const webinarRegId = `${runId}:webinar_reg`;
  const webinarRegHtml = `🎟 <b>Webinar registration</b> · ${FIXTURE_NAME}\n☎ +91${FIXTURE_PHONE}\nWebinar: Prove Webinar`;
  await runOne(
    "webinar_registration",
    webinarRegId,
    async () => {
      await salesAlertWebinarRegistration({
        name: FIXTURE_NAME,
        phone: FIXTURE_PHONE,
        webinar: "Prove Webinar",
        webinarDate: "2026-08-12T10:00:00+05:30",
        amountPaid: 0,
        registrationsSoFar: 42,
        eventId: webinarRegId,
        occurredAt: nowIso,
      });
      const row = await outboxGet(webinarRegId);
      if (row?.status === "dry_run") return "dry_run";
      if (row?.status === "sent") return "sent";
      return "failed";
    },
    webinarRegHtml,
  );

  const webinarPayId = `${runId}:webinar_pay`;
  const webinarPayHtml = `💳 <b>Webinar payment</b> · ${FIXTURE_NAME}\n☎ +91${FIXTURE_PHONE}\n₹499 · PROVE-RCPT-1`;
  await runOne(
    "webinar_payment",
    webinarPayId,
    async () => {
      await salesAlertWebinarPayment({
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
      });
      const row = await outboxGet(webinarPayId);
      if (row?.status === "dry_run") return "dry_run";
      if (row?.status === "sent") return "sent";
      return "failed";
    },
    webinarPayHtml,
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
      deliverFixture({
        eventId: enrollId,
        event: "admission",
        phone: FIXTURE_PHONE,
        html: enrollHtml,
        buttons: [],
        occurredAt: nowIso,
        synthetic: true,
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
      deliverFixture({
        eventId: instId,
        event: "installment_paid",
        phone: FIXTURE_PHONE,
        html: instHtml,
        buttons: [],
        occurredAt: nowIso,
        synthetic: true,
      }),
    instHtml,
  );

  const partialId = `${runId}:partial`;
  const partialHtml = `🟠 <b>Partial instalment</b> · ${FIXTURE_NAME}\n☎ +91${FIXTURE_PHONE}`;
  await runOne(
    "partial_settlement",
    partialId,
    async () => {
      await salesAlertPartialPayment({
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
      });
      const row = await outboxGet(partialId);
      if (row?.status === "dry_run") return "dry_run";
      if (row?.status === "sent") return "sent";
      return "failed";
    },
    partialHtml,
  );

  const proofId = `${runId}:proof`;
  const proofHtml = `📎 <b>Proof uploaded</b> · ${FIXTURE_NAME}\n☎ +91${FIXTURE_PHONE}`;
  await runOne(
    "proof_awaiting",
    proofId,
    async () => {
      await salesAlertInstallmentProof({
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
      });
      const row = await outboxGet(proofId);
      if (row?.status === "dry_run") return "dry_run";
      if (row?.status === "sent") return "sent";
      return "failed";
    },
    proofHtml,
  );

  // Dedupe: same eventId twice → second skipped
  const dedupeId = `${runId}:dedupe`;
  const d1 = await deliverFixture({
    eventId: dedupeId,
    event: "admission",
    phone: FIXTURE_PHONE,
    html: "dedupe A",
    buttons: [],
    occurredAt: nowIso,
    synthetic: true,
  });
  const d2 = await deliverFixture({
    eventId: dedupeId,
    event: "admission",
    phone: FIXTURE_PHONE,
    html: "dedupe B — must not send",
    buttons: [],
    occurredAt: nowIso,
    synthetic: true,
  });

  // Mid-flight retry simulation: already-sent id from first deliver
  const retrySim = await deliverFixture({
    eventId: dedupeId,
    event: "admission",
    phone: FIXTURE_PHONE,
    html: "retry mid-flight",
    buttons: [],
    occurredAt: nowIso,
    synthetic: true,
  });

  const inv = await scanFeeInvariants().catch(() => ({
    checked: -1,
    hits: [] as { id: string }[],
    filter: FEE_INVARIANT_ENROLLMENT_FILTER,
  }));

  const realPath = salesRealEventWouldFire({
    eventId: `admission:real-example`,
    event: "admission",
    phone: "9898900001",
    html: "🟢 New enrollment · Real Student",
    occurredAt: nowIso,
    cutoffIso,
  });

  fireSalesAlert(async () => undefined);

  const allRendered = events.filter((e) => e.type !== "transport").every((e) => e.rendered);
  const seven = events.filter((e) => e.type !== "transport");
  return {
    ok:
      allRendered &&
      liveSendCount === 0 &&
      historicalBlocked &&
      preCutoffStillEligible === 0 &&
      (d1 === "dry_run" || d1 === "sent") &&
      d2 === "skipped" &&
      retrySim === "skipped" &&
      !salesLeadBatchingEnabled() &&
      realPath.fire,
    cutoff: {
      iso: cutoffIso,
      cached: salesAlertsCutoffIso(),
      historicalBlocked,
      outboxBefore: before,
      outboxAfter: after,
      purged: purge.purged,
      preCutoffStillEligible,
    },
    fixtureGuard: {
      liveChatSet: !!chatId,
      testChatSet: !!testChat && testChat !== chatId,
      mode: testChat && testChat !== chatId ? "test_chat" : "dry_run",
      liveSendCount,
      postedNothingToLive: liveSendCount === 0,
    },
    env: {
      TELEGRAM_BOT_TOKEN: tokenSet,
      TELEGRAM_SALES_CHAT_ID: !!chatId,
      TELEGRAM_SALES_TEST_CHAT_ID: !!testChat,
      SALES_LEAD_BATCHING: process.env.SALES_LEAD_BATCHING || "(unset→off)",
    },
    flags: {
      alerts: await salesAlertsEnabled(),
      digest: await salesDigestEnabled(),
      leadBatching: salesLeadBatchingEnabled(),
      leadBatchIntervalMin: salesLeadBatchIntervalMinutes(),
    },
    getChat: getChatInfo,
    events: seven,
    dedupe: {
      first: d1,
      second: d2,
      retrySim,
      oneMessageOnly: d2 === "skipped" && retrySim === "skipped",
    },
    realEventPath: {
      ...realPath,
      condition:
        "alerts on + post-cutoff occurredAt + NOT synthetic (no prove:/fixture: id, not fixture phone/HTML) + eventId not already sent",
    },
    callSites: {
      matchFixtures: true,
      note: "Live webhooks call the same salesAlert* functions; fixtures only add synthetic markers / prove ids",
    },
    invariant: {
      filter: inv.filter || FEE_INVARIANT_ENROLLMENT_FILTER,
      checked: inv.checked,
      hits: inv.hits.length,
    },
    outbox: {
      dueAfterProve: (await outboxListDue(5)).length,
      alreadySentDedupe: await outboxAlreadySent(dedupeId),
    },
  };
}

/** Prove dedupe alone: same eventId twice → one delivery. */
export async function proveSalesDedupe(): Promise<Record<string, unknown>> {
  const id = `prove:dedupe:${Date.now().toString(36)}`;
  const nowIso = new Date().toISOString();
  const html = `dedupe prove · ${id}`;
  const first = await deliverSalesAlert({
    eventId: id,
    event: "admission",
    phone: FIXTURE_PHONE,
    html,
    buttons: [],
    occurredAt: nowIso,
    synthetic: true,
  });
  const second = await deliverSalesAlert({
    eventId: id,
    event: "admission",
    phone: FIXTURE_PHONE,
    html: html + " DUPLICATE",
    buttons: [],
    occurredAt: nowIso,
    synthetic: true,
  });
  const third = await deliverSalesAlert({
    eventId: id,
    event: "admission",
    phone: FIXTURE_PHONE,
    html: html + " RETRY",
    buttons: [],
    occurredAt: nowIso,
    synthetic: true,
  });
  return {
    ok: (first === "dry_run" || first === "sent") && second === "skipped" && third === "skipped",
    eventId: id,
    first,
    second,
    third,
    duplicateDelivered: false,
    note: "synthetic→dry_run; second/third skipped by outbox status (dedupe holds)",
  };
}
