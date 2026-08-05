/**
 * Sales channel instant alerts — fire-and-forget, isolated from ops + payments.
 */
import { buildKeyboard } from "../botApi";
import { sendToChannel, salesChannelConfigured } from "../channels";
import { tgLog } from "../log";
import {
  alreadyDeduped,
  enqueueSalesAlert,
  inSalesQuietHours,
  markDeduped,
  tryConsumeRateSlot,
  type SalesEventType,
} from "./dedupe";
import { adminStudentDeepLink, escapeHtml, formatIstShort, maskPhone, salesInr } from "./format";
import { salesAlertsEnabled } from "./settings";

async function deliverOrQueue(input: {
  event: SalesEventType;
  phone: string;
  html: string;
  buttons: { label: string; url: string }[];
}): Promise<"sent" | "queued" | "skipped" | "failed"> {
  if (!salesChannelConfigured()) return "skipped";
  if (!(await salesAlertsEnabled())) return "skipped";
  if (await alreadyDeduped(input.event, input.phone)) return "skipped";

  if (inSalesQuietHours()) {
    await enqueueSalesAlert({
      ...input,
      queuedAt: new Date().toISOString(),
      reason: "quiet",
    });
    await markDeduped(input.event, input.phone);
    return "queued";
  }

  if (!(await tryConsumeRateSlot())) {
    await enqueueSalesAlert({
      ...input,
      queuedAt: new Date().toISOString(),
      reason: "rate",
    });
    await markDeduped(input.event, input.phone);
    return "queued";
  }

  const res = await sendToChannel("sales", {
    text: input.html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    disable_notification: false,
    reply_markup: buildKeyboard(input.buttons.map((b) => ({ label: b.label, url: b.url }))),
  });
  if (res.ok) {
    await markDeduped(input.event, input.phone);
    return "sent";
  }
  tgLog("sales_alert_send_failed", { event: input.event, error: res.description }, "warn");
  return "failed";
}

/** Fire-and-forget — never throws to caller. */
export function fireSalesAlert(task: () => Promise<unknown>): void {
  void (async () => {
    try {
      await task();
    } catch (e) {
      tgLog("sales_alert_exception", { error: (e as Error).message }, "error");
    }
  })();
}

export async function salesAlertPaymentFailed(input: {
  name: string;
  phone: string;
  course: string;
  amount: number;
  reason?: string | null;
  studentId?: string | null;
}): Promise<void> {
  const link = adminStudentDeepLink({ studentId: input.studentId, phone: input.phone });
  const html = [
    `🔴 <b>Payment failed</b> · ${escapeHtml(input.name || "Student")}`,
    `${escapeHtml(input.course || "Course")} · ${salesInr(input.amount)} · ${escapeHtml(maskPhone(input.phone))}`,
    input.reason ? `Reason: ${escapeHtml(input.reason)}` : null,
    formatIstShort(new Date()),
  ]
    .filter(Boolean)
    .join("\n");
  await deliverOrQueue({
    event: "payment_failed",
    phone: input.phone,
    html,
    buttons: [{ label: "Open in admin", url: link }],
  });
}

export async function salesAlertCheckoutAbandoned(input: {
  name: string;
  phone: string;
  course: string;
  minutesAgo: number;
  studentId?: string | null;
}): Promise<void> {
  const link = adminStudentDeepLink({ studentId: input.studentId, phone: input.phone });
  const html = [
    `🟡 <b>Started checkout, didn't pay</b> · ${escapeHtml(input.name || "Student")}`,
    `${escapeHtml(input.course || "Course")} · opened ${Math.max(1, Math.round(input.minutesAgo))} min ago`,
    `${escapeHtml(maskPhone(input.phone))} · ${formatIstShort(new Date())}`,
  ].join("\n");
  await deliverOrQueue({
    event: "checkout_abandoned",
    phone: input.phone,
    html,
    buttons: [{ label: "Open in admin", url: link }],
  });
}

export async function salesAlertLinkExpired(input: {
  name: string;
  phone: string;
  course: string;
  studentId?: string | null;
}): Promise<void> {
  const link = adminStudentDeepLink({ studentId: input.studentId, phone: input.phone });
  const html = [
    `⚪ <b>Link expired unused</b> · ${escapeHtml(input.name || "Student")}`,
    `${escapeHtml(input.course || "Course")} · ${escapeHtml(maskPhone(input.phone))}`,
    formatIstShort(new Date()),
  ].join("\n");
  await deliverOrQueue({
    event: "payment_link_expired",
    phone: input.phone,
    html,
    buttons: [{ label: "Open in admin", url: link }],
  });
}

export async function salesAlertInstallmentProof(input: {
  name: string;
  phone: string;
  installmentNo: number;
  amount: number | null;
  studentId?: string | null;
  enrollmentId?: string | null;
  proofId?: string | null;
}): Promise<void> {
  const link = adminStudentDeepLink({
    studentId: input.studentId,
    enrollmentId: input.enrollmentId,
    phone: input.phone,
    proofId: input.proofId,
    review: "installment_proof",
  });
  const html = [
    `📎 <b>Proof uploaded — needs review</b> · ${escapeHtml(input.name || "Student")}`,
    `Instalment ${input.installmentNo} · ${salesInr(input.amount)} · ${escapeHtml(maskPhone(input.phone))}`,
    formatIstShort(new Date()),
  ].join("\n");
  await deliverOrQueue({
    event: "installment_proof_uploaded",
    phone: input.phone,
    html,
    buttons: [{ label: "Review", url: link }],
  });
}

export async function salesAlertWebinarProof(input: {
  name: string;
  phone: string;
  studentId?: string | null;
  proofId?: string | null;
}): Promise<void> {
  const link = adminStudentDeepLink({
    studentId: input.studentId,
    phone: input.phone,
    proofId: input.proofId,
    review: "payment_proof",
  });
  const html = [
    `📎 <b>Webinar proof uploaded</b> · ${escapeHtml(input.name || "Student")}`,
    `${escapeHtml(maskPhone(input.phone))} · ${formatIstShort(new Date())}`,
  ].join("\n");
  await deliverOrQueue({
    event: "webinar_proof_uploaded",
    phone: input.phone,
    html,
    buttons: [{ label: "Review", url: link }],
  });
}

/** Flush quiet/rate queue (called from 10:00 digest). Never throws. */
export async function flushSalesQueuedAlerts(): Promise<number> {
  try {
    const { drainSalesQueue } = await import("./dedupe");
    const items = await drainSalesQueue();
    let sent = 0;
    for (const item of items) {
      if (!(await tryConsumeRateSlot())) {
        await enqueueSalesAlert(item);
        continue;
      }
      const res = await sendToChannel("sales", {
        text: item.html + `\n<i>Queued (${item.reason})</i>`,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: buildKeyboard(item.buttons.map((b) => ({ label: b.label, url: b.url }))),
      });
      if (res.ok) sent++;
    }
    return sent;
  } catch (e) {
    tgLog("sales_queue_flush_failed", { error: (e as Error).message }, "error");
    return 0;
  }
}
