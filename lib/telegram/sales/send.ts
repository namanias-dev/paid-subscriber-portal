/**
 * Sales channel instant alerts — fire-and-forget, isolated from ops + payments.
 */
import { tgLog } from "../log";
import { type SalesEventType } from "./dedupe";
import { deliverSalesAlert, sweepSalesOutbox } from "./deliver";
export { fireSalesAlert, sweepSalesOutbox } from "./deliver";
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
import { enqueueSalesLeadBatch } from "./leadBatch";
import { salesLeadBatchingEnabled } from "./settings";
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

function waitingLabel(since: string | null | undefined): string | null {
  if (!since) return null;
  const ms = Date.parse(since);
  if (!Number.isFinite(ms)) return null;
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 60) return `Waiting: ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `Waiting: ${hours}h`;
  return `Waiting: ${Math.round(hours / 24)}d`;
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
  if (context.nextInstallmentDate || context.nextInstallmentAmount) {
    const amt = optionalSalesInr(context.nextInstallmentAmount);
    const when = context.nextInstallmentDate
      ? escapeHtml(compactDate(context.nextInstallmentDate) || context.nextInstallmentDate)
      : null;
    lines.push(`Next instalment: ${[amt, when && `due ${when}`].filter(Boolean).join(" · ")}`);
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
  eventId: string;
  event: SalesEventType;
  phone: string;
  html: string;
  buttons: { label: string; url: string }[];
  occurredAt?: string | Date | null;
}): Promise<"sent" | "skipped" | "failed" | "dry_run"> {
  return deliverSalesAlert(input);
}

export async function salesAlertPaymentFailed(input: {
  name: string;
  phone: string;
  course: string;
  amount: number;
  reason?: string | null;
  studentId?: string | null;
  payment?: Payment | null;
  occurredAt?: string | Date | null;
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
    eventId: `payment_failed:${input.payment?.reference_no || input.payment?.id || input.phone}`,
    event: "payment_failed",
    phone: input.phone,
    html,
    buttons: [{ label: "Open in admin", url: link }],
    occurredAt: input.payment?.created_at ?? new Date(),
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
  occurredAt?: string | Date | null;
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
    eventId: `checkout_abandoned:${input.payment?.reference_no || input.payment?.id || input.phone}`,
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
  occurredAt?: string | Date | null;
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
    eventId: `payment_link_expired:${input.payment?.reference_no || input.payment?.id || input.phone}`,
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
  waitingSince?: string | null;
  eventId?: string | null;
  occurredAt?: string | Date | null;
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
  const expected = context?.nextInstallmentAmount || null;
  const claimed = input.amount;
  const pct = context?.progressPct;
  const html = [
    `📎 <b>Proof uploaded — needs review</b> · ${escapeHtml(input.name || "Student")}`,
    phoneLine(input.phone),
    clean(input.course || context?.enrollment.course_title)
      ? `Course: ${escapeHtml((input.course || context?.enrollment.course_title)!)}`
      : null,
    `Instalment ${input.installmentNo}${context?.installmentTotal ? ` of ${context.installmentTotal}` : ""}`,
    claimed != null ? `Claimed: ${optionalSalesInr(claimed)}` : null,
    expected != null ? `Instalment amount: ${optionalSalesInr(expected)}` : null,
    pct != null ? `Paid so far: ${pct}%` : null,
    context?.dueDate
      ? `Due: ${escapeHtml(compactDate(context.dueDate) || context.dueDate)}`
      : null,
    waitingLabel(input.waitingSince),
    formatIstShort(new Date()),
  ]
    .filter(Boolean)
    .join("\n");
  await deliverOrQueue({
    eventId:
      input.eventId ||
      `installment_proof:${input.proofId || input.enrollmentId || input.phone}:${input.installmentNo}`,
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
  occurredAt?: string | Date | null;
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
    eventId: `webinar_proof:${input.proofId || input.payment?.id || input.phone}`,
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
  eventId?: string | null;
  occurredAt?: string | Date | null;
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
    `🟢 <b>New enrollment</b> · ${escapeHtml(input.name || "Student")}`,
    phoneLine(input.phone),
    clean(input.course) ? `Course: ${escapeHtml(input.course)}` : null,
    context?.totalFee ? `Total fee: ${optionalSalesInr(context.totalFee)}` : null,
    context?.discount ? `Discount: ${optionalSalesInr(context.discount)}` : null,
    amount ? `Paid now: ${amount}` : null,
    context?.paid ? `Paid to date: ${optionalSalesInr(context.paid)}` : null,
    context?.balance ? `Remaining: ${optionalSalesInr(context.balance)}` : null,
    context?.plan ? `Plan: ${escapeHtml(context.plan === "full" ? "full" : "instalments")}` : null,
    clean(input.source) ? `Source: ${escapeHtml(input.source!)}` : null,
    formatIstShort(new Date()),
  ]
    .filter(Boolean)
    .join("\n");
  await deliverOrQueue({
    eventId: input.eventId || `admission:${input.enrollmentId || input.phone}:${Math.round(input.amount)}`,
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
  eventId?: string | null;
  occurredAt?: string | Date | null;
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
    eventId:
      input.eventId ||
      `installment_paid:${input.enrollmentId || input.phone}:${input.installmentNo || 0}:${Math.round(input.amount)}`,
    event: "installment_paid",
    phone: input.phone,
    html,
    buttons: [{ label: "Open in admin", url: link }],
  });
}

/** Partial payment with shortfall carried to next instalment — full phone. */
export async function salesAlertPartialPayment(input: {
  name: string;
  phone: string;
  course: string;
  amountPaid: number;
  shortfallCarried: number;
  nextAmount: number;
  nextDue?: string | null;
  installmentNo?: number | null;
  studentId?: string | null;
  enrollmentId?: string | null;
  enrollment?: CourseEnrollment | null;
  eventId?: string | null;
  occurredAt?: string | Date | null;
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
    "installment_partial",
  );
  const paid = optionalSalesInr(input.amountPaid);
  const shortfall = optionalSalesInr(input.shortfallCarried);
  const nextAmt = optionalSalesInr(input.nextAmount || context?.nextInstallmentAmount);
  const nextDue = compactDate(input.nextDue || context?.nextInstallmentDate);
  const html = [
    `🟠 <b>Partial instalment</b> · ${escapeHtml(input.name || "Student")}`,
    phoneLine(input.phone),
    clean(input.course) ? `Course: ${escapeHtml(input.course)}` : null,
    input.installmentNo != null
      ? `Instalment ${input.installmentNo}${context?.installmentTotal ? ` of ${context.installmentTotal}` : ""}`
      : null,
    paid ? `Paid now: ${paid}` : null,
    context?.totalFee ? `Total fee: ${optionalSalesInr(context.totalFee)}` : null,
    context?.paid ? `Paid to date: ${optionalSalesInr(context.paid)}` : null,
    context?.balance ? `Remaining: ${optionalSalesInr(context.balance)}` : null,
    shortfall ? `Shortfall carried: ${shortfall}` : null,
    nextAmt
      ? `Next instalment: ${nextAmt}${nextDue ? ` · due ${escapeHtml(nextDue)}` : ""}`
      : null,
    formatIstShort(new Date()),
  ]
    .filter(Boolean)
    .join("\n");
  await deliverOrQueue({
    eventId:
      input.eventId ||
      `installment_partial:${input.enrollmentId || input.phone}:${input.installmentNo || 0}:${Math.round(input.amountPaid)}`,
    event: "installment_partial",
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
  eventId?: string | null;
  occurredAt?: string | Date | null;
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
    eventId:
      input.eventId ||
      `payment_succeeded:${input.enrollmentId || input.phone}:${Math.round(input.amount)}`,
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

export async function salesAlertWebinarRegistration(input: {
  name: string;
  phone: string;
  webinar: string;
  webinarDate?: string | null;
  amountPaid?: number | null;
  registrationsSoFar?: number | null;
  eventId?: string | null;
  occurredAt?: string | Date | null;
}): Promise<void> {
  const link = adminStudentDeepLink({ phone: input.phone });
  const html = [
    `🎟 <b>Webinar registration</b> · ${escapeHtml(input.name || "Student")}`,
    phoneLine(input.phone),
    clean(input.webinar) ? `Webinar: ${escapeHtml(input.webinar)}` : null,
    input.webinarDate ? `Date: ${escapeHtml(compactDate(input.webinarDate) || input.webinarDate)}` : null,
    optionalSalesInr(input.amountPaid) ? `Amount paid: ${optionalSalesInr(input.amountPaid)}` : `Amount paid: free`,
    input.registrationsSoFar != null ? `Registrations so far: ${input.registrationsSoFar}` : null,
    formatIstShort(new Date()),
  ].filter(Boolean).join("\n");
  await deliverOrQueue({
    eventId: input.eventId || `webinar_reg:${input.phone}:${input.webinar}`,
    event: "webinar_registration",
    phone: input.phone,
    html,
    buttons: [{ label: "Open in admin", url: link }],
  });
}

export async function salesAlertWebinarPayment(input: {
  name: string;
  phone: string;
  webinar: string;
  webinarDate?: string | null;
  amount: number;
  method?: string | null;
  receiptNo?: string | null;
  registrationsSoFar?: number | null;
  eventId?: string | null;
  occurredAt?: string | Date | null;
}): Promise<void> {
  const link = adminStudentDeepLink({ phone: input.phone });
  const html = [
    `💳 <b>Webinar payment</b> · ${escapeHtml(input.name || "Student")}`,
    phoneLine(input.phone),
    clean(input.webinar) ? `Webinar: ${escapeHtml(input.webinar)}` : null,
    input.webinarDate ? `Date: ${escapeHtml(compactDate(input.webinarDate) || input.webinarDate)}` : null,
    optionalSalesInr(input.amount) ? `Amount: ${optionalSalesInr(input.amount)}` : null,
    clean(input.method) ? `Method: ${escapeHtml(input.method!)}` : null,
    clean(input.receiptNo) ? `Receipt: ${escapeHtml(input.receiptNo!)}` : null,
    input.registrationsSoFar != null ? `Registrations so far: ${input.registrationsSoFar}` : null,
    formatIstShort(new Date()),
  ].filter(Boolean).join("\n");
  await deliverOrQueue({
    eventId: input.eventId || `webinar_pay:${input.phone}:${Math.round(input.amount)}:${input.receiptNo || "x"}`,
    event: "webinar_payment",
    phone: input.phone,
    html,
    buttons: [{ label: "Open in admin", url: link }],
  });
}

export async function salesAlertNewLead(input: {
  name: string;
  phone: string;
  source?: string | null;
  courseInterest?: string | null;
  leadId?: string | null;
  eventId?: string | null;
  occurredAt?: string | Date | null;
}): Promise<void> {
  const link = adminStudentDeepLink({ phone: input.phone });
  const html = [
    `🆕 <b>New lead</b> · ${escapeHtml(input.name || "Lead")}`,
    phoneLine(input.phone),
    clean(input.source) ? `Source: ${escapeHtml(input.source!)}` : null,
    clean(input.courseInterest) ? `Course interest: ${escapeHtml(input.courseInterest!)}` : null,
    formatIstShort(new Date()),
  ].filter(Boolean).join("\n");
  const eventId = input.eventId || `lead:${input.leadId || input.phone}`;
  const buttons = [{ label: "Open in admin", url: link }];
  // Batching DEFAULT OFF — when SALES_LEAD_BATCHING=1, queue instead of instant send.
  // Payments/proofs never use this path.
  if (salesLeadBatchingEnabled()) {
    await enqueueSalesLeadBatch({
      name: input.name,
      phone: input.phone,
      source: input.source,
      courseInterest: input.courseInterest,
      leadId: input.leadId,
      eventId,
      html,
      buttons,
      queuedAt: new Date().toISOString(),
    });
    return;
  }
  await deliverOrQueue({
    eventId,
    event: "new_lead",
    phone: input.phone,
    html,
    buttons,
    occurredAt: input.occurredAt ?? new Date(),
  });
}

export async function flushSalesQueuedAlerts(_opts?: { force?: boolean }): Promise<number> {
  try {
    // Drain legacy rate-queue if any remain, then sweep outbox.
    const { drainSalesQueue } = await import("./dedupe");
    const { deliverSalesAlert: deliver } = await import("./deliver");
    const items = await drainSalesQueue();
    let sent = 0;
    for (const item of items) {
      const r = await deliver({
        eventId: `legacy_queue:${item.event}:${item.phone}:${item.queuedAt}`,
        event: item.event,
        phone: item.phone,
        html: item.html,
        buttons: item.buttons,
      });
      if (r === "sent") sent++;
    }
    const sweep = await sweepSalesOutbox(40);
    return sent + sweep.sent;
  } catch (e) {
    tgLog("sales_queue_flush_failed", { error: (e as Error).message }, "error");
    return 0;
  }
}
