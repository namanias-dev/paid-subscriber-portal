/**
 * Sales channel delivery — inline waitUntil, retry, outbox. No quiet hours,
 * no rate limit, no MC gating. Never throws to payment/user paths.
 *
 * Hard cutoff: events occurred before SALES_ALERTS_CUTOFF never send.
 */
import { waitUntil } from "@vercel/functions";
import { buildKeyboard } from "../botApi";
import { sendToChannel, salesChannelConfigured } from "../channels";
import { tgLog } from "../log";
import { isBeforeSalesCutoff, purgePreCutoffSalesOutbox, resolveSalesAlertsCutoff } from "./cutoff";
import { salesAlertsEnabled } from "./settings";
import {
  outboxAlreadySent,
  outboxGet,
  outboxMarkSent,
  outboxUpsert,
  type SalesOutboxRow,
} from "./outbox";

export type SalesDeliverInput = {
  /** Stable unique id — payment ref, proof id, lead id, etc. Prevents double-post. */
  eventId: string;
  event: string;
  phone: string;
  html: string;
  buttons: { label: string; url: string }[];
  /** When the underlying business event occurred. Pre-cutoff → never alert. */
  occurredAt?: string | Date | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendOnce(input: SalesDeliverInput): Promise<{
  ok: boolean;
  messageId: number | null;
  error: string | null;
  errorCode: number | null;
}> {
  const res = await sendToChannel("sales", {
    text: input.html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    disable_notification: false,
    reply_markup: buildKeyboard(input.buttons.map((b) => ({ label: b.label, url: b.url }))),
  });
  if (res.ok) {
    const messageId = (res.result as { message_id?: number } | undefined)?.message_id ?? null;
    return { ok: true, messageId, error: null, errorCode: null };
  }
  return {
    ok: false,
    messageId: null,
    error: res.description || "send_failed",
    errorCode: res.error_code ?? null,
  };
}

/** Up to 3 attempts with short backoff; then mark outbox failed. */
export async function deliverSalesAlert(input: SalesDeliverInput): Promise<"sent" | "skipped" | "failed"> {
  if (!salesChannelConfigured()) {
    tgLog("sales_alert_skipped", { reason: "sales_chat_unset", eventId: input.eventId, event: input.event }, "error");
    return "skipped";
  }
  if (!(await salesAlertsEnabled())) {
    tgLog("sales_alert_skipped", { reason: "alerts_disabled", eventId: input.eventId, event: input.event }, "warn");
    return "skipped";
  }
  await resolveSalesAlertsCutoff();
  const occurredAt = input.occurredAt ?? new Date();
  if (await isBeforeSalesCutoff(occurredAt)) {
    tgLog(
      "sales_alert_skipped",
      {
        reason: "pre_cutoff",
        eventId: input.eventId,
        event: input.event,
        occurredAt: occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt,
      },
      "info",
    );
    return "skipped";
  }
  if (await outboxAlreadySent(input.eventId)) return "skipped";

  const now = new Date().toISOString();
  const prev = await outboxGet(input.eventId);
  if (prev?.status === "skipped") return "skipped";
  let attempts = prev?.attempts || 0;

  // Seed pending row so sweeper can see it if process dies mid-retry.
  await outboxUpsert({
    eventId: input.eventId,
    event: input.event,
    phone: input.phone,
    html: input.html,
    buttons: input.buttons,
    status: "pending",
    attempts,
    lastError: null,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  });

  const backoffs = [0, 400, 1200];
  let lastError: string | null = null;
  let lastCode: number | null = null;
  for (let i = 0; i < backoffs.length; i++) {
    if (backoffs[i]! > 0) await sleep(backoffs[i]!);
    attempts += 1;
    const res = await sendOnce(input);
    if (res.ok) {
      await outboxMarkSent(input.eventId, res.messageId);
      tgLog("sales_alert_sent", { eventId: input.eventId, event: input.event, messageId: res.messageId, attempts }, "info");
      return "sent";
    }
    lastError = res.error;
    lastCode = res.errorCode;
    tgLog(
      "sales_alert_send_failed",
      { eventId: input.eventId, event: input.event, attempt: attempts, error: lastError, error_code: lastCode },
      "error",
    );
  }

  const failed: SalesOutboxRow = {
    eventId: input.eventId,
    event: input.event,
    phone: input.phone,
    html: input.html,
    buttons: input.buttons,
    status: "failed",
    attempts,
    lastError,
    createdAt: prev?.createdAt || now,
    updatedAt: new Date().toISOString(),
  };
  await outboxUpsert(failed);
  tgLog("sales_alert_outbox_failed", { eventId: input.eventId, event: input.event, attempts, error: lastError }, "error");
  return "failed";
}

/**
 * Fire-and-forget via waitUntil so Vercel keeps the isolate alive until send finishes.
 * Never throws to the caller.
 */
export function fireSalesAlert(task: () => Promise<unknown>): void {
  const run = async () => {
    try {
      await task();
    } catch (e) {
      tgLog("sales_alert_exception", { error: (e as Error).message, stack: (e as Error).stack }, "error");
    }
  };
  try {
    waitUntil(run());
  } catch {
    // Local / non-Vercel: still fire without blocking caller.
    void run();
  }
}

/** Sweeper: purge pre-cutoff first, then send only post-cutoff pending/failed. Idle when empty. */
export async function sweepSalesOutbox(limit = 40): Promise<{
  due: number;
  sent: number;
  failed: number;
  purged: number;
  cutoffIso: string;
}> {
  const { purged, cutoffIso } = await purgePreCutoffSalesOutbox();
  const { outboxListDue } = await import("./outbox");
  const due = await outboxListDue(limit);
  if (!due.length) return { due: 0, sent: 0, failed: 0, purged, cutoffIso };
  let sent = 0;
  let failed = 0;
  for (const row of due) {
    const result = await deliverSalesAlert({
      eventId: row.eventId,
      event: row.event,
      phone: row.phone,
      html: row.html,
      buttons: row.buttons || [],
      occurredAt: row.createdAt,
    });
    if (result === "sent") sent++;
    else if (result === "failed") failed++;
  }
  return { due: due.length, sent, failed, purged, cutoffIso };
}
