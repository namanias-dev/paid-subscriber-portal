/**
 * Telegram HTML for the daily executive brief and the month-end report.
 * Parse mode is HTML. One emoji per main heading. Dynamic text is escaped.
 */
import type {
  AdmissionMetrics,
  CollectionCategory,
  CollectionMetrics,
  CollectionSource,
  PeopleMetrics,
} from "../../analytics/businessMetrics";
import type { SmsDeliveryMetrics } from "../../analytics/smsDelivery";
import { escapeHtml, inrExact } from "./format";

const RULE = "────────";

const CATEGORY_LABEL: Record<CollectionCategory, string> = {
  admission: "Full payments",
  installment: "Installments",
  seat: "Seat bookings",
  webinar: "Webinars",
  plan: "Plans",
  other: "Other payments",
};

const CATEGORY_DISPLAY: CollectionCategory[] = [
  "admission",
  "installment",
  "seat",
  "webinar",
  "plan",
  "other",
];

const SOURCE_LABEL: Record<CollectionSource, string> = {
  online: "Online",
  manual: "Staff recorded",
  other: "Other",
};

export interface LoginTrendBrief {
  /** Shown only when unique logins could not be loaded with the student block. */
  todayFallback: number | null;
  yesterday: number | null;
  avg30: number | null;
  historicalAvg: number | null;
  firstTrackedYmd: string | null;
}

export interface CourseBrief {
  title: string;
  total: number;
  capacity: number | null;
  online: number;
  offline: number;
  morning: number;
  evening: number;
  fullPaid: number;
  partial: number;
  unpaid: number;
  modeOk: boolean;
  timingOk: boolean;
  timingEmpty: boolean;
  modeEmpty: boolean;
}

export interface WebinarBrief {
  title: string;
  dateLabel: string;
  registered: number;
  pendingCheckout: number;
  attendedLastPct: number | null;
}

export interface FailedBrief {
  name: string;
  amount: number;
  item: string;
  when: string;
  reason: string | null;
  recovered: boolean;
}

export interface OutstandingBrief {
  overdueCount: number;
  overdueAmount: number;
  due7dAmount: number;
}

export interface BriefInput {
  dateLabel: string;
  timeLabel: string;
  people: PeopleMetrics | null;
  login: LoginTrendBrief | null;
  today: CollectionMetrics | null;
  yesterday: CollectionMetrics | null;
  mtd: CollectionMetrics | null;
  todayAdmissions: AdmissionMetrics | null;
  sms: SmsDeliveryMetrics | null;
  webinar: WebinarBrief | null;
  courses: CourseBrief[];
  outstanding: OutstandingBrief | null;
  failed: FailedBrief[];
  morningNote: string | null;
  manualValidation?: boolean;
}

/** Display only. Does not change the stored course title. */
export function shortCourseTitle(title: string): string {
  let t = String(title || "").trim();
  t = t.replace(/^naman\s+ias\s*[-–—:|]?\s*/i, "");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > 42) t = `${t.slice(0, 40).trimEnd()}…`;
  return t || "Course";
}

export function digestSnapshotSlot(slotKey: string, manual: boolean, nonce: number): string {
  return manual ? `${slotKey}:manual:${nonce}` : slotKey;
}

function heading(emoji: string, title: string): string {
  return `${emoji} <b>${title}</b>`;
}

function pushMajor(lines: string[], opened: { value: boolean }, emoji: string, title: string, body: string[]): void {
  const rows = body.filter((row) => row !== "");
  if (!rows.length) return;
  if (opened.value) {
    lines.push("");
    lines.push(RULE);
    lines.push("");
  }
  opened.value = true;
  lines.push(heading(emoji, title));
  for (const row of rows) lines.push(row);
}

function paymentWord(n: number): string {
  return `${n} payment${n === 1 ? "" : "s"}`;
}

function sourceLine(c: CollectionMetrics): string {
  const bits = (["online", "manual"] as CollectionSource[]).map((key) => {
    const row = c.sources.find((s) => s.key === key);
    return `${SOURCE_LABEL[key]} ${inrExact(row?.amount || 0)}`;
  });
  const other = c.sources.find((s) => s.key === "other");
  if (other && other.amount !== 0) bits.push(`${SOURCE_LABEL.other} ${inrExact(other.amount)}`);
  return bits.join(" · ");
}

function purposeLines(c: CollectionMetrics): string[] {
  const lines: string[] = [];
  for (const key of CATEGORY_DISPLAY) {
    const cat = c.categories.find((x) => x.key === key);
    if (!cat || (cat.payments === 0 && cat.amount === 0)) continue;
    lines.push(`${CATEGORY_LABEL[key]}  ${inrExact(cat.amount)}`);
  }
  return lines;
}

function trackedSince(ymd: string | null): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "Since tracking began";
  const [y, m, d] = ymd.split("-").map(Number);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  if (!month) return "Since tracking began";
  return `Since ${d} ${month} ${y}`;
}

function collectionBody(input: Pick<BriefInput, "today" | "yesterday" | "mtd">): string[] {
  const body: string[] = [];
  if (!input.today && !input.yesterday && !input.mtd) return body;
  body.push("<i>Collected is money received on a paid receipt, not the course fee or what is still owed.</i>");

  if (input.today) {
    body.push("");
    body.push(`<b>Today</b>  <b>${inrExact(input.today.netCollection)}</b>`);
    body.push(sourceLine(input.today));
    body.push(`${paymentWord(input.today.successfulPayments)} · ${input.today.payingStudents} students`);
    if (input.today.refundAmount > 0) {
      body.push(`Gross ${inrExact(input.today.grossCollection)} · Refunds ${inrExact(input.today.refundAmount)}`);
    }
    if (input.today.paymentsWithoutPhone > 0) {
      body.push(`<i>${input.today.paymentsWithoutPhone} payments have no mobile, so they are not in the student count.</i>`);
    }
  }

  if (input.yesterday) {
    body.push("");
    body.push(
      `<b>Yesterday</b>  ${inrExact(input.yesterday.netCollection)} · ${paymentWord(input.yesterday.successfulPayments)}`,
    );
  }

  if (input.mtd) {
    body.push("");
    body.push(`<b>Month to date</b>  <b>${inrExact(input.mtd.netCollection)}</b>`);
    body.push(sourceLine(input.mtd));
    body.push(`${paymentWord(input.mtd.successfulPayments)} · ${input.mtd.payingStudents} students`);
    if (input.mtd.refundAmount > 0) {
      body.push(`Gross ${inrExact(input.mtd.grossCollection)} · Refunds ${inrExact(input.mtd.refundAmount)}`);
      body.push("<i>Online, staff and purpose figures are before refunds.</i>");
    }
    body.push("<i>Staff recorded is cash, UPI or bank entered by the team. It is already inside the total.</i>");
    body.push("<i>Paying students counts a person once, even if they paid more than once.</i>");
    const purposes = purposeLines(input.mtd);
    if (purposes.length) {
      body.push("");
      body.push("<i>What this month's receipts were for</i>");
      for (const row of purposes) body.push(row);
    }
  }
  return body;
}

function studentBody(people: PeopleMetrics | null, login: LoginTrendBrief | null): string[] {
  const body: string[] = [];
  const unique = people?.uniqueLoginUsers ?? login?.todayFallback ?? null;
  if (people?.newAccounts != null) body.push(`New accounts  ${people.newAccounts}`);
  if (unique != null) {
    body.push(`Unique logins  <b>${unique}</b>`);
    body.push("<i>Students who signed in. A second sign-in does not add another.</i>");
  }
  if (people?.loginEvents != null) {
    body.push(`Login events  ${people.loginEvents}`);
    body.push("<i>Every sign-in. One student can add more than one.</i>");
  }
  if (people?.activeUsers != null) {
    body.push(`Active students  <b>${people.activeUsers}</b>`);
    body.push("<i>Signed in, or opened the portal, a class or a course.</i>");
  }
  if (people?.returningActiveUsers != null) {
    body.push(`Returning  ${people.returningActiveUsers}`);
    body.push("<i>Active today, and not a new account.</i>");
  }

  const trend: string[] = [];
  if (unique != null) trend.push(`Today  <b>${unique}</b>`);
  if (login?.yesterday != null) trend.push(`Yesterday  ${login.yesterday}`);
  if (login?.avg30 != null) {
    trend.push(`30-day average  ${login.avg30}`);
    trend.push("<i>Last 30 complete days, including quiet days.</i>");
  }
  if (login?.historicalAvg != null) {
    trend.push(`${trackedSince(login.firstTrackedYmd)}  ${login.historicalAvg}`);
    trend.push("<i>Average of complete days that had a sign-in. Today is not included.</i>");
  } else if (login && login.historicalAvg == null && login.avg30 == null && login.yesterday == null) {
    /* nothing else known */
  }
  if (trend.length) {
    body.push("");
    body.push("<b>Login trend</b>");
    body.push("<i>Today matches unique logins above.</i>");
    for (const row of trend) body.push(row);
  }
  return body;
}

function admissionBody(admissions: AdmissionMetrics | null): string[] {
  if (!admissions) return [];
  const body = [`New admissions  <b>${admissions.admissions}</b>`];
  for (const course of admissions.byCourse) {
    body.push(`${escapeHtml(shortCourseTitle(course.title))}  ${course.admissions}`);
  }
  return body;
}

function smsBody(sms: SmsDeliveryMetrics | null): string[] {
  if (!sms) return ["<i>Unavailable for this run.</i>"];
  const body = [
    "<i>Sent means the provider accepted it. Delivered means the phone confirmed it. A retry counts again. A delivery receipt does not.</i>",
    `Sent  <b>${sms.sent}</b>`,
    `Delivered  <b>${sms.delivered}</b>`,
    `Failed  ${sms.failed}`,
    `Pending  ${sms.pending}`,
  ];
  if (sms.queued > 0) body.push(`Still queued  ${sms.queued}`);
  for (const t of sms.templates) {
    const bits = [`Sent ${t.sent}`, `Delivered ${t.delivered}`, `Failed ${t.failed}`];
    if (t.pending > 0) bits.push(`Pending ${t.pending}`);
    if (t.queued > 0) bits.push(`Queued ${t.queued}`);
    body.push(`${escapeHtml(t.name)}  ${bits.join(" · ")}`);
  }
  return body;
}

function webinarBody(webinar: WebinarBrief | null): string[] {
  if (!webinar) return [];
  if (webinar.registered <= 0 && webinar.pendingCheckout <= 0) return [];
  const body = [`<b>${escapeHtml(webinar.title)}</b>`];
  if (webinar.dateLabel) body.push(`<i>${escapeHtml(webinar.dateLabel)}</i>`);
  body.push(`Paid registrations  <b>${webinar.registered}</b>`);
  if (webinar.pendingCheckout > 0) body.push(`Pending checkout  ${webinar.pendingCheckout}`);
  if (webinar.attendedLastPct != null) body.push(`Last attendance  ${webinar.attendedLastPct}%`);
  return body;
}

function courseBody(courses: CourseBrief[]): string[] {
  const body: string[] = [];
  for (const c of courses.filter((x) => x.total > 0)) {
    if (body.length) body.push("");
    const seats =
      c.capacity != null && c.capacity > 0 ? `${c.total} of ${c.capacity}` : `${c.total}`;
    body.push(`<b>${escapeHtml(shortCourseTitle(c.title))}</b>  ${seats}`);
    if (c.modeOk) body.push(`Online ${c.online} · Offline ${c.offline}`);
    else if (!c.modeEmpty) {
      body.push(`Online ${c.online} · Offline ${c.offline} · Unmapped ${c.total - c.online - c.offline}`);
    }
    if (c.timingOk) body.push(`Morning ${c.morning} · Evening ${c.evening}`);
    else if (!c.timingEmpty) {
      body.push(`Morning ${c.morning} · Evening ${c.evening} · Unmapped ${c.total - c.morning - c.evening}`);
    }
    const pay = [`Full paid ${c.fullPaid}`, `Partial ${c.partial}`];
    if (c.unpaid > 0) pay.push(`Unpaid ${c.unpaid}`);
    body.push(pay.join(" · "));
  }
  return body;
}

function outstandingBody(o: OutstandingBrief | null): string[] {
  if (!o || (o.overdueCount <= 0 && o.due7dAmount <= 0)) return [];
  const body = ["<i>Still owed. This is not money received.</i>"];
  if (o.overdueCount > 0) body.push(`Overdue  <b>${inrExact(o.overdueAmount)}</b> · ${o.overdueCount} students`);
  if (o.due7dAmount > 0) body.push(`Due this week  <b>${inrExact(o.due7dAmount)}</b>`);
  return body;
}

function failedBody(failed: FailedBrief[]): string[] {
  if (!failed.length) return [];
  const body = [`<b>${failed.length} failed attempt${failed.length === 1 ? "" : "s"} today</b>`];
  failed.slice(0, 6).forEach((p, idx) => {
    body.push(`${idx + 1}. ${escapeHtml(p.name)}  ${inrExact(p.amount)}`);
    const status = p.recovered ? "Later paid" : "Still failed";
    body.push(`${escapeHtml(p.item)} · ${escapeHtml(p.when)} · ${status}`);
    if (p.reason) body.push(escapeHtml(p.reason));
  });
  if (failed.length > 6) body.push(`…and ${failed.length - 6} more`);
  return body;
}

export function executiveBriefLines(input: BriefInput): string[] {
  const lines: string[] = [];
  lines.push("<b>NAMAN IAS | EXECUTIVE BRIEF</b>");
  lines.push(`${escapeHtml(input.dateLabel)} | ${escapeHtml(input.timeLabel)} IST`);
  lines.push(`<i>Live figures through ${escapeHtml(input.timeLabel)}</i>`);

  const opened = { value: false };
  pushMajor(lines, opened, "💰", "COLLECTIONS", collectionBody(input));
  pushMajor(lines, opened, "👥", "STUDENTS &amp; ACTIVITY", studentBody(input.people, input.login));
  pushMajor(lines, opened, "🎓", "ADMISSIONS TODAY", admissionBody(input.todayAdmissions));
  pushMajor(lines, opened, "📱", "SMS DELIVERY", smsBody(input.sms));
  pushMajor(lines, opened, "📣", "WEBINAR", webinarBody(input.webinar));
  pushMajor(lines, opened, "📚", "COURSE ADMISSIONS", courseBody(input.courses));
  pushMajor(lines, opened, "📋", "OUTSTANDING FEES", outstandingBody(input.outstanding));

  const failed = failedBody(input.failed);
  if (failed.length) {
    lines.push("");
    lines.push(RULE);
    lines.push("");
    for (const row of failed) lines.push(row);
  }
  if (input.morningNote) {
    lines.push("");
    lines.push(input.morningNote);
  }
  if (input.manualValidation) {
    lines.push("");
    lines.push("<i>Manually triggered live-data validation.</i>");
  }
  return lines;
}

const CONTINUED = "<b>NAMAN IAS | EXECUTIVE BRIEF</b>\n<i>Continued</i>";

/** One message when it fits. Otherwise two, split on a section heading. */
export function packTelegramMessages(lines: string[], limit = 3900): string[] {
  const joined = lines.join("\n").trim();
  if (joined.length <= limit) return [joined];

  const heads = lines
    .map((line, index) => ({ index, line }))
    .filter(({ line }) => /^(💰|👥|🎓|📱|📣|📚|📋) /u.test(line));

  let fallback: [string, string] | null = null;
  for (const head of heads) {
    if (head.index <= 0) continue;
    const first = lines.slice(0, head.index).join("\n").trim();
    const second = `${CONTINUED}\n\n${lines.slice(head.index).join("\n").trim()}`;
    if (first.length <= limit && second.length <= limit) {
      if (head.line.startsWith("📣") || head.line.startsWith("📚")) return [first, second];
      if (!fallback) fallback = [first, second];
    }
  }
  if (fallback) return [fallback[0], fallback[1]];

  const midpoint = Math.ceil(lines.length / 2);
  const first = lines.slice(0, midpoint).join("\n").trim();
  const second = `${CONTINUED}\n\n${lines.slice(midpoint).join("\n").trim()}`;
  return [first, second];
}

export function monthlyBusinessHtml(input: {
  label: string;
  people: PeopleMetrics | null;
  money: CollectionMetrics;
  admissions: AdmissionMetrics;
  sms?: SmsDeliveryMetrics | null;
}): string {
  const lines: string[] = [];
  lines.push("<b>NAMAN IAS | MONTHLY BRIEF</b>");
  lines.push(`<b>${escapeHtml(input.label)}</b>`);
  const opened = { value: false };
  const monthBody = [
    "<i>Collected is money received on a paid receipt, not the course fee or what is still owed.</i>",
    "",
    `<b>Collected</b>  <b>${inrExact(input.money.netCollection)}</b>`,
    sourceLine(input.money),
    `${paymentWord(input.money.successfulPayments)} · ${input.money.payingStudents} students`,
  ];
  if (input.money.refundAmount > 0) {
    monthBody.push(`Gross ${inrExact(input.money.grossCollection)} · Refunds ${inrExact(input.money.refundAmount)}`);
    monthBody.push("<i>Online, staff and purpose figures are before refunds.</i>");
  }
  monthBody.push("<i>Staff recorded is cash, UPI or bank entered by the team. It is already inside the total.</i>");
  monthBody.push("<i>Paying students counts a person once, even if they paid more than once.</i>");
  const purposes = purposeLines(input.money);
  if (purposes.length) {
    monthBody.push("");
    monthBody.push("<i>What the month's receipts were for</i>");
    for (const row of purposes) monthBody.push(row);
  }
  pushMajor(lines, opened, "💰", "COLLECTIONS", monthBody);
  pushMajor(lines, opened, "👥", "STUDENTS &amp; ACTIVITY", studentBody(input.people, null));
  const adm = [
    `New admissions  <b>${input.admissions.admissions}</b>`,
    `Students  ${input.admissions.students}`,
  ];
  for (const course of input.admissions.byCourse) {
    adm.push(`${escapeHtml(shortCourseTitle(course.title))}  ${course.admissions}`);
  }
  pushMajor(lines, opened, "🎓", "ADMISSIONS", adm);
  if (input.sms) pushMajor(lines, opened, "📱", "SMS DELIVERY", smsBody(input.sms));
  if (input.money.payingStudents > 0) {
    lines.push("");
    lines.push(RULE);
    lines.push("");
    lines.push(
      `Average per paying student  ${inrExact(input.money.netCollection / input.money.payingStudents)}`,
    );
  }
  return lines.join("\n");
}

/** @deprecated Use executiveBriefLines. Kept so older imports still build a brief body. */
export function dailyBusinessLines(input: {
  people: PeopleMetrics | null;
  today: CollectionMetrics | null;
  todayAdmissions: AdmissionMetrics | null;
  yesterday: CollectionMetrics | null;
  mtd: CollectionMetrics | null;
}): string[] {
  return executiveBriefLines({
    dateLabel: "Report",
    timeLabel: "now",
    people: input.people,
    login: null,
    today: input.today,
    yesterday: input.yesterday,
    mtd: input.mtd,
    todayAdmissions: input.todayAdmissions,
    sms: null,
    webinar: null,
    courses: [],
    outstanding: null,
    failed: [],
    morningNote: null,
  });
}
