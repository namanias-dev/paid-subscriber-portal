/**
 * Sales channel instant alerts — fire-and-forget, isolated from ops + payments.
 */
import { buildKeyboard } from "../botApi";
import { sendToChannel, salesChannelConfigured } from "../channels";
import { tgLog } from "../log";
import {
  alreadyDeduped,
  enqueueSalesAlert,
  markDeduped,
  tryConsumeRateSlot,
  type SalesEventType,
} from "./dedupe";
import {
  classifyCheckoutLead,
  loadEnrollmentSalesContext,
  loadFailureSalesContext,
  loadWebinarProofSalesContext,
  type EnrollmentSalesContext,
} from "./context";
import {
  adminStudentDeepLink,
  escapeHtml,
  formatIstShort,
  optionalSalesInr,
  salesPhone,
} from "./format";
import { salesAlertsEnabled } from "./settings";
import type { CourseEnrollment, Payment } from "../../types";

function clean(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text && text !== "null" && text !== "undefined" ? text : null;
}

function phoneLine(phone: string): string | null {
  const value = salesPhone(phone);
  return value ? `☎ ${escapeHtml(value)}` : null;
}

function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}

function compactDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? formatIstShort(new Date(ms)) : null;
}

function enrollmentLines(
  context: EnrollmentSalesContext | null,
  opts?: { installmentNo?: number | null; amountLabel?: string; amount?: number | null },
): string[] {
  if (!context) return [];
  const lines: (string | null)[] = [];
  const no = opts?.installmentNo;
  if (no != null && no > 0) {
    lines.push(
      `Instalment ${no}${context.installmentTotal ? ` of ${context.installmentTotal}` : ""}`,
    );
  }
  const amount = optionalSalesInr(opts?.amount);
  if (amount) lines.push(`${opts?.amountLabel || "Amount"}: ${amount}`);
  const money = [
    context.totalFee ? `Fee ${optionalSalesInr(context.totalFee)}` : null,
    context.paid ? `Paid ${optionalSalesInr(context.paid)}` : null,
    context.balance ? `Balance ${optionalSalesInr(context.balance)}` : null,
  ].filter(Boolean);
  if (money.length) lines.push(money.join(" · "));
  if (context.nextInstallmentDate) {
    lines.push(`Next instalment: ${escapeHtml(compactDate(context.nextInstallmentDate) || context.nextInstallmentDate)}`);
  }
  if (context.accessStatus) lines.push(`Access: ${escapeHtml(context.accessStatus)}`);
  return lines.filter((line): line is string => !!line);
}

export async function safeSalesContext<T>(
  task: () => Promise<T>,
  event: SalesEventType,
): Promise<T | null> {
  try {
    return await task();
  } catch (error) {
    tgLog("sales_enrichment_failed", { event, error: (error as Error).message }, "warn");
    return null;
  }
}

async function deliverOrQueue(input: {
  event: SalesEventType;
  phone: string;
  html: string;
  buttons: { label: string; url: string }[];
}): Promise<"sent" | "queued" | "skipped" | "failed"> {
  if (!salesChannelConfigured()) return "skipped";
  if (!(await salesAlertsEnabled())) return "skipped";
  if (await alreadyDeduped(input.event, input.phone)) return "skipped";

  // No quiet hours — Sales & Admissions alerts deliver 24×7.
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
    const messageId = (res.result as { message_id?: number } | undefined)?.message_id ?? null;
    await markDeduped(input.event, input.phone, {
      message_id: messageId,
      chat_id: (process.env.TELEGRAM_SALES_CHAT_ID || "").trim() || null,
    });
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
  payment?: Payment | null;
}): Promise<void> {
  const link = adminStudentDeepLink({ studentId: input.studentId, phone: input.phone });
  const context = await safeSalesContext(
    () =>
      loadFailureSalesContext({
        phone: input.phone,
        course: input.course,
        at: input.payment?.created_at || new Date(),
      }),
    "payment_failed",
  );
  const amount = optionalSalesInr(input.amount);
  const html = [
    `🔴 <b>Payment failed</b> · ${escapeHtml(input.name || "Student")}`,
    phoneLine(input.phone),
    clean(input.course) ? `Course: ${escapeHtml(input.course)}` : null,
    amount ? `Attempted: ${amount}` : null,
    clean(input.reason) ? `Reason: ${escapeHtml(input.reason!)}` : null,
    context?.attemptToday ? `${ordinal(context.attemptToday)} attempt today` : null,
    context?.paidBefore === true
      ? "Payment history: paid before"
      : context?.paidBefore === false
        ? "Payment history: no prior payment"
        : null,
    formatIstShort(input.payment?.created_at || new Date()),
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
  amount?: number | null;
  leadKind?: "new lead" | "returning" | null;
  payment?: Payment | null;
  allPayments?: readonly Payment[] | null;
  studentId?: string | null;
}): Promise<void> {
  const link = adminStudentDeepLink({ studentId: input.studentId, phone: input.phone });
  const amount = optionalSalesInr(input.amount ?? input.payment?.amount);
  const leadKind =
    input.leadKind ||
    (input.payment && input.allPayments
      ? classifyCheckoutLead(input.payment, input.allPayments)
      : null);
  const html = [
    `🟡 <b>Started checkout, didn't pay</b> · ${escapeHtml(input.name || "Student")}`,
    phoneLine(input.phone),
    clean(input.course) ? `Course: ${escapeHtml(input.course)}` : null,
    amount ? `Amount: ${amount}` : null,
    `Opened ${Math.max(1, Math.round(input.minutesAgo))} min ago`,
    leadKind ? `Lead: ${escapeHtml(leadKind)}` : null,
    formatIstShort(input.payment?.created_at || new Date()),
  ]
    .filter(Boolean)
    .join("\n");
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
  amount?: number | null;
  sentAt?: string | null;
  wasOpened?: boolean | null;
  payment?: Payment | null;
  studentId?: string | null;
}): Promise<void> {
  const link = adminStudentDeepLink({ studentId: input.studentId, phone: input.phone });
  const amount = optionalSalesInr(input.amount ?? input.payment?.amount);
  const sentAt = input.sentAt || input.payment?.created_at || null;
  const html = [
    `⚪ <b>Link expired unused</b> · ${escapeHtml(input.name || "Student")}`,
    phoneLine(input.phone),
    clean(input.course) ? `Course: ${escapeHtml(input.course)}` : null,
    amount ? `Amount: ${amount}` : null,
    sentAt ? `Link sent: ${escapeHtml(formatIstShort(sentAt))}` : null,
    input.wasOpened === true
      ? "Opened: yes"
      : input.wasOpened === false
        ? "Opened: no"
        : null,
  ]
    .filter(Boolean)
    .join("\n");
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
  course?: string | null;
  installmentNo: number;
  amount: number | null;
  studentId?: string | null;
  enrollmentId?: string | null;
  proofId?: string | null;
  enrollment?: CourseEnrollment | null;
}): Promise<void> {
  const link = adminStudentDeepLink({
    studentId: input.studentId,
    enrollmentId: input.enrollmentId,
    phone: input.phone,
    proofId: input.proofId,
    review: "installment_proof",
  });
  const context = await safeSalesContext(
    () =>
      loadEnrollmentSalesContext({
        phone: input.phone,
        course: input.course,
        enrollmentId: input.enrollmentId,
        enrollment: input.enrollment,
        installmentNo: input.installmentNo,
      }),
    "installment_proof_uploaded",
  );
  const html = [
    `📎 <b>Proof uploaded — needs review</b> · ${escapeHtml(input.name || "Student")}`,
    phoneLine(input.phone),
    clean(input.course || context?.enrollment.course_title)
      ? `Course: ${escapeHtml((input.course || context?.enrollment.course_title)!)}`
      : null,
    ...enrollmentLines(context, {
      installmentNo: input.installmentNo,
      amountLabel: "Claimed",
      amount: input.amount,
    }),
    context?.dueDate
      ? `Due: ${escapeHtml(compactDate(context.dueDate) || context.dueDate)}`
      : null,
    formatIstShort(new Date()),
  ]
    .filter(Boolean)
    .join("\n");
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
  payment?: Payment | null;
}): Promise<void> {
  const link = adminStudentDeepLink({
    studentId: input.studentId,
    phone: input.phone,
    proofId: input.proofId,
    review: "payment_proof",
  });
  const context = input.payment
    ? await safeSalesContext(
        () => loadWebinarProofSalesContext(input.payment!),
        "webinar_proof_uploaded",
      )
    : null;
  const amount = optionalSalesInr(context?.amount);
  const html = [
    `📎 <b>Webinar proof uploaded</b> · ${escapeHtml(input.name || "Student")}`,
    phoneLine(input.phone),
    context?.webinarName ? `Webinar: ${escapeHtml(context.webinarName)}` : null,
    context?.webinarDate
      ? `Date: ${escapeHtml(formatIstShort(context.webinarDate))}`
      : null,
    amount ? `Amount: ${amount}` : null,
    context?.registrations != null
      ? `Registrations: ${context.registrations}`
      : null,
    formatIstShort(new Date()),
  ]
    .filter(Boolean)
    .join("\n");
  await deliverOrQueue({
    event: "webinar_proof_uploaded",
    phone: input.phone,
    html,
    buttons: [{ label: "Review", url: link }],
  });
}

export async function salesAlertAdmission(input: {
  name: string;
  phone: string;
  course: string;
  amount: number;
  studentId?: string | null;
  enrollmentId?: string | null;
  enrollment?: CourseEnrollment | null;
  source?: string | null;
}): Promise<void> {
  const link = adminStudentDeepLink({ studentId: input.studentId, phone: input.phone });
  const context = await safeSalesContext(
    () =>
      loadEnrollmentSalesContext({
        phone: input.phone,
        course: input.course,
        enrollmentId: input.enrollmentId,
        enrollment: input.enrollment,
      }),
    "admission",
  );
  const amount = optionalSalesInr(input.amount);
  const html = [
    `🟢 <b>New admission</b> · ${escapeHtml(input.name || "Student")}`,
    phoneLine(input.phone),
    clean(input.course) ? `Course: ${escapeHtml(input.course)}` : null,
    context?.plan ? `Plan: ${escapeHtml(context.plan)}` : null,
    amount ? `Paid: ${amount}` : null,
    context?.plan === "instalment" && context.balance
      ? `Balance: ${optionalSalesInr(context.balance)}`
      : null,
    clean(input.source) ? `Source: ${escapeHtml(input.source!)}` : null,
    formatIstShort(new Date()),
  ]
    .filter(Boolean)
    .join("\n");
  await deliverOrQueue({
    event: "admission",
    phone: input.phone,
    html,
    buttons: [{ label: "Open in admin", url: link }],
  });
}

export async function salesAlertInstallmentPaid(input: {
  name: string;
  phone: string;
  course: string;
  amount: number;
  installmentNo?: number | null;
  studentId?: string | null;
  enrollmentId?: string | null;
  enrollment?: CourseEnrollment | null;
}): Promise<void> {
  const link = adminStudentDeepLink({ studentId: input.studentId, phone: input.phone });
  const context = await safeSalesContext(
    () =>
      loadEnrollmentSalesContext({
        phone: input.phone,
        course: input.course,
        enrollmentId: input.enrollmentId,
        enrollment: input.enrollment,
        installmentNo: input.installmentNo,
      }),
    "installment_paid",
  );
  const html = [
    `✅ <b>Instalment paid</b> · ${escapeHtml(input.name || "Student")}`,
    phoneLine(input.phone),
    clean(input.course) ? `Course: ${escapeHtml(input.course)}` : null,
    ...enrollmentLines(context, {
      installmentNo: input.installmentNo,
      amountLabel: "Amount",
      amount: input.amount,
    }),
    formatIstShort(new Date()),
  ]
    .filter(Boolean)
    .join("\n");
  await deliverOrQueue({
    event: "installment_paid",
    phone: input.phone,
    html,
    buttons: [{ label: "Open in admin", url: link }],
  });
}

export async function salesAlertPaymentSucceeded(input: {
  name: string;
  phone: string;
  course: string;
  amount: number;
  studentId?: string | null;
  enrollmentId?: string | null;
  enrollment?: CourseEnrollment | null;
}): Promise<void> {
  const link = adminStudentDeepLink({ studentId: input.studentId, phone: input.phone });
  const context = await safeSalesContext(
    () =>
      loadEnrollmentSalesContext({
        phone: input.phone,
        course: input.course,
        enrollmentId: input.enrollmentId,
        enrollment: input.enrollment,
      }),
    "payment_succeeded",
  );
  const amount = optionalSalesInr(input.amount);
  const html = [
    `💚 <b>Payment succeeded</b> · ${escapeHtml(input.name || "Student")}`,
    phoneLine(input.phone),
    clean(input.course) ? `Course: ${escapeHtml(input.course)}` : null,
    amount ? `Paid: ${amount}` : null,
    context?.totalFee ? `Fee: ${optionalSalesInr(context.totalFee)}` : null,
    context?.paid ? `Paid so far: ${optionalSalesInr(context.paid)}` : null,
    context?.balance ? `Balance: ${optionalSalesInr(context.balance)}` : null,
    formatIstShort(new Date()),
  ]
    .filter(Boolean)
    .join("\n");
  await deliverOrQueue({
    event: "payment_succeeded",
    phone: input.phone,
    html,
    buttons: [{ label: "Open in admin", url: link }],
  });
}

/**
 * Flush rate-limit backlog. Never throws.
 * Called from digest + every telegram-reports cron tick.
 */
export async function flushSalesQueuedAlerts(_opts?: { force?: boolean }): Promise<number> {
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
      if (res.ok) {
        sent++;
        await markDeduped(item.event, item.phone, {
          message_id: (res.result as { message_id?: number } | undefined)?.message_id ?? null,
          chat_id: (process.env.TELEGRAM_SALES_CHAT_ID || "").trim() || null,
        });
      } else {
        // Put back so next awake tick can retry.
        await enqueueSalesAlert(item);
        tgLog("sales_queue_item_send_failed", { event: item.event, error: res.description }, "warn");
      }
    }
    return sent;
  } catch (e) {
    tgLog("sales_queue_flush_failed", { error: (e as Error).message }, "error");
    return 0;
  }
}
