/**
 * Telegram HTML for the daily executive brief and the month-end report.
 * Parse mode is HTML. Dynamic text is escaped. Metric definitions live in the
 * channel description and the pinned Reporting Definitions message.
 */
import type {
  AdmissionMetrics,
  CollectionCategory,
  CollectionMetrics,
  CollectionSource,
  PeopleMetrics,
} from "../../analytics/businessMetrics";
import type { SmsDeliveryMetrics } from "../../analytics/smsDelivery";
import type { NotesStoreReport } from "../../store/reporting";
import { escapeHtml, inrExact } from "./format";

const RULE = "━━━━━━━━━━━━━━━━━━";

const CATEGORY_LABEL: Record<CollectionCategory, string> = {
  admission: "Course full payments",
  installment: "Installments",
  seat: "Seat bookings",
  webinar: "Webinars",
  plan: "Plans",
  other: "Other",
};

const CATEGORY_DISPLAY: CollectionCategory[] = [
  "admission",
  "installment",
  "seat",
  "webinar",
  "plan",
  "other",
];

const MONTHS: Record<string, string> = {
  january: "Jan",
  february: "Feb",
  march: "Mar",
  april: "Apr",
  may: "May",
  june: "Jun",
  july: "Jul",
  august: "Aug",
  september: "Sep",
  sept: "Sep",
  october: "Oct",
  november: "Nov",
  december: "Dec",
  jan: "Jan",
  feb: "Feb",
  mar: "Mar",
  apr: "Apr",
  jun: "Jun",
  jul: "Jul",
  aug: "Aug",
  sep: "Sep",
  oct: "Oct",
  nov: "Nov",
  dec: "Dec",
};

export interface LoginTrendBrief {
  /** Shown only when unique logins could not be loaded with the student block. */
  todayFallback: number | null;
  yesterday: number | null;
  avg30: number | null;
  /** Mean unique logins over the previous 90 complete IST days, zeros included. */
  avg90: number | null;
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

export interface WebinarSourceBrief {
  label: string;
  count: number;
}

export interface WebinarBrief {
  title: string;
  dateLabel: string;
  registered: number;
  /** Paid seats whose first receipt was created today (IST). */
  newToday: number | null;
  pendingCheckout: number;
  attendedLastPct: number | null;
  /** Null when no attribution stamp exists. Empty array is not used for that. */
  sources: WebinarSourceBrief[] | null;
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
  notes: NotesStoreReport | null;
  morningNote: string | null;
}

/** Fold Notes Store receipts into academy cash once: online source and the headline total. */
export function withNotesCash(metrics: CollectionMetrics, rupees: number): CollectionMetrics {
  if (!rupees) return metrics;
  const add = Math.round(rupees * 100) / 100;
  return {
    ...metrics,
    grossCollection: Math.round((metrics.grossCollection + add) * 100) / 100,
    netCollection: Math.round((metrics.netCollection + add) * 100) / 100,
    sources: metrics.sources.map((source) =>
      source.key === "online"
        ? { ...source, amount: Math.round((source.amount + add) * 100) / 100 }
        : source,
    ),
  };
}

/** Display only. Does not change the stored course title. Never ends in an ellipsis. */
export function shortCourseTitle(title: string): string {
  let raw = String(title || "").replace(/\s+/g, " ").trim();
  raw = raw.replace(/^naman\s+ias\s*[-–—:|]?\s*/i, "").trim();
  if (!raw) return "Course";

  if (/safalta/i.test(raw) && /foundation/i.test(raw)) {
    const month = raw.match(
      /\b(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(20\d{2})\b/i,
    );
    const range = raw.match(/\b(20\d{2})\s*\/\s*(\d{2,4})\b/);
    let suffix = "";
    if (month) suffix = ` ${MONTHS[month[1].toLowerCase()] || month[1]} ${month[2]}`;
    else if (range) suffix = ` ${range[1]}/${range[2]}`;
    return `GS Foundation — SAFALTA${suffix}`;
  }

  let t = raw.replace(/\s+by\s+naman\s+sir\b/gi, "");
  t = t.replace(/^upsc\s+/i, "");
  t = t.replace(/\bcomplete\s+course\b/gi, "");
  t = t.replace(/\s+for\s+upsc\b.*$/i, "");
  t = t.replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/[\s–—-]+$/g, "").trim();
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

function sourceAmount(c: CollectionMetrics, key: CollectionSource): number {
  return c.sources.find((s) => s.key === key)?.amount || 0;
}

function sourceBullets(c: CollectionMetrics): string[] {
  const lines = [
    `• Online — ${inrExact(sourceAmount(c, "online"))}`,
    `• Staff recorded — ${inrExact(sourceAmount(c, "manual"))}`,
  ];
  const other = sourceAmount(c, "other");
  if (other !== 0) lines.push(`• Other — ${inrExact(other)}`);
  return lines;
}

function purposeLines(c: CollectionMetrics, notesRupees = 0): string[] {
  const lines: string[] = [];
  for (const key of CATEGORY_DISPLAY) {
    const cat = c.categories.find((x) => x.key === key);
    if (!cat || (cat.payments === 0 && cat.amount === 0)) continue;
    lines.push(`• ${CATEGORY_LABEL[key]} — ${inrExact(cat.amount)}`);
  }
  if (notesRupees) lines.push(`• Notes Store — ${inrExact(notesRupees)}`);
  return lines;
}

function highlightSources(c: CollectionMetrics): string {
  const bits = [`Online ${inrExact(sourceAmount(c, "online"))}`, `Staff ${inrExact(sourceAmount(c, "manual"))}`];
  const other = sourceAmount(c, "other");
  if (other !== 0) bits.push(`Other ${inrExact(other)}`);
  return bits.join(" · ");
}

function sourceSummary(sources: WebinarSourceBrief[] | null, limit?: number): string | null {
  if (sources == null) return null;
  const rows = sources.filter((s) => s.count > 0);
  const shown = limit ? rows.slice(0, limit) : rows;
  if (!shown.length) return null;
  return shown.map((s) => `${escapeHtml(s.label)} ${s.count}`).join(" · ");
}

function attentionItem(item: string): string {
  const raw = String(item || "").trim();
  if (/^webinar/i.test(raw)) return "Webinar";
  if (/seat/i.test(raw)) return "Seat booking";
  if (/installment/i.test(raw)) return "Installment";
  if (/full/i.test(raw)) return "Full payment";
  const head = raw.split("—")[0].trim();
  return head || "Payment";
}

function collectionBody(input: Pick<BriefInput, "today" | "yesterday" | "mtd" | "notes">): string[] {
  const body: string[] = [];
  if (!input.today && !input.yesterday && !input.mtd) return body;

  if (input.today) {
    body.push(`<b>Today</b> — <b>${inrExact(input.today.netCollection)}</b>`);
    body.push(...sourceBullets(input.today));
    body.push(`• ${paymentWord(input.today.successfulPayments)} · ${input.today.payingStudents} students`);
    if (input.today.refundAmount > 0) {
      body.push(`• Gross ${inrExact(input.today.grossCollection)} · Refunds ${inrExact(input.today.refundAmount)}`);
    }
  }

  if (input.yesterday) {
    if (body.length) body.push("");
    body.push(`<b>Yesterday</b> — ${inrExact(input.yesterday.netCollection)}`);
    body.push(`• ${paymentWord(input.yesterday.successfulPayments)}`);
  }

  if (input.mtd) {
    if (body.length) body.push("");
    body.push(`<b>Month to Date</b> — <b>${inrExact(input.mtd.netCollection)}</b>`);
    body.push(...sourceBullets(input.mtd));
    body.push(`• ${paymentWord(input.mtd.successfulPayments)} · ${input.mtd.payingStudents} students`);
    if (input.mtd.refundAmount > 0) {
      body.push(`• Gross ${inrExact(input.mtd.grossCollection)} · Refunds ${inrExact(input.mtd.refundAmount)}`);
    }
    const purposes = purposeLines(input.mtd, input.notes?.mtd.cashRupees || 0);
    if (purposes.length) {
      body.push("");
      body.push("<b>Receipt Mix</b>");
      body.push(...purposes);
    }
  }
  return body;
}

function studentBody(people: PeopleMetrics | null, login: LoginTrendBrief | null): string[] {
  const body: string[] = [];
  const unique = people?.uniqueLoginUsers ?? login?.todayFallback ?? null;
  if (people?.newAccounts != null) body.push(`• New accounts — ${people.newAccounts}`);
  if (unique != null) body.push(`• Unique logins — <b>${unique}</b>`);
  if (people?.loginEvents != null) body.push(`• Login events — ${people.loginEvents}`);
  if (people?.activeUsers != null) body.push(`• Active students — <b>${people.activeUsers}</b>`);
  if (people?.returningActiveUsers != null) body.push(`• Returning active — ${people.returningActiveUsers}`);

  const trend: string[] = [];
  if (login?.yesterday != null) trend.push(`Yesterday ${login.yesterday}`);
  if (login?.avg30 != null) trend.push(`30-day avg ${login.avg30}`);
  if (login?.avg90 != null) trend.push(`90-day avg ${login.avg90}`);
  if (trend.length) {
    body.push("");
    body.push("<b>Login Trend</b>");
    body.push(trend.join(" · "));
  }
  return body;
}

function admissionBody(admissions: AdmissionMetrics | null): string[] {
  if (!admissions) return [];
  if (admissions.admissions <= 0) return ["No new admissions today"];
  const body = [`<b>${admissions.admissions} new admission${admissions.admissions === 1 ? "" : "s"}</b>`];
  for (const course of admissions.byCourse) {
    if (course.admissions <= 0) continue;
    body.push(`• ${escapeHtml(shortCourseTitle(course.title))} — ${course.admissions}`);
  }
  return body;
}

function smsBits(row: { sent: number; delivered: number; failed: number; pending: number; queued: number }, withSent: boolean): string {
  const bits: string[] = [];
  if (withSent) bits.push(`${row.sent} sent`);
  bits.push(`${row.delivered} delivered`);
  if (row.failed > 0) bits.push(`${row.failed} failed`);
  if (row.pending > 0) bits.push(`${row.pending} pending`);
  if (row.queued > 0) bits.push(`${row.queued} queued`);
  return bits.join(" · ");
}

function smsBody(sms: SmsDeliveryMetrics | null): string[] {
  if (!sms) return ["Unavailable for this run."];
  if (sms.sent === 0 && sms.queued === 0 && sms.pending === 0) return ["No SMS sent today"];
  const body = [`Sent ${sms.sent} · Delivered ${sms.delivered} · Failed ${sms.failed}${sms.queued > 0 ? ` · Queued ${sms.queued}` : ""}${sms.pending > 0 ? ` · Pending ${sms.pending}` : ""}`];
  const terminal = sms.delivered + sms.failed;
  if (sms.failed > 0 && terminal > 0) {
    body.push(`Delivery rate ${Math.round((sms.delivered / terminal) * 100)}%`);
  }
  if (sms.templates.length) {
    body.push("");
    body.push("<b>By Template</b>");
    for (const t of sms.templates) {
      body.push(`• ${escapeHtml(t.name)} — ${smsBits(t, true)}`);
    }
  }
  return body;
}

function webinarBody(webinar: WebinarBrief | null): string[] {
  if (!webinar) return [];
  const quiet = webinar.registered <= 0 && webinar.pendingCheckout <= 0 && !(webinar.newToday && webinar.newToday > 0);
  if (quiet) return [];
  const body = [`<b>${escapeHtml(webinar.title)}</b>`];
  if (webinar.dateLabel) body.push(escapeHtml(webinar.dateLabel));
  body.push(`• Paid registrations — <b>${webinar.registered}</b>`);
  if (webinar.newToday != null) body.push(`• New today — <b>${webinar.newToday}</b>`);
  if (webinar.pendingCheckout > 0) body.push(`• Pending checkout — ${webinar.pendingCheckout}`);
  if (webinar.attendedLastPct != null) body.push(`• Last attendance — ${webinar.attendedLastPct}%`);
  body.push("");
  body.push("<b>Sources</b>");
  const sources = sourceSummary(webinar.sources);
  body.push(sources || "Source attribution unavailable");
  return body;
}

function courseBody(courses: CourseBrief[]): string[] {
  const body: string[] = [];
  for (const c of courses.filter((x) => x.total > 0)) {
    if (body.length) body.push("");
    const seats = c.capacity != null && c.capacity > 0 ? `${c.total}/${c.capacity}` : `${c.total}`;
    body.push(`<b>${escapeHtml(shortCourseTitle(c.title))}</b> — ${seats}`);
    if (c.modeOk) body.push(`Online ${c.online} · Offline ${c.offline}`);
    else if (!c.modeEmpty) {
      body.push(`Online ${c.online} · Offline ${c.offline} · Unmapped ${c.total - c.online - c.offline}`);
    }
    if (c.timingOk) body.push(`Morning ${c.morning} · Evening ${c.evening}`);
    else if (!c.timingEmpty) {
      body.push(`Morning ${c.morning} · Evening ${c.evening} · Unmapped ${c.total - c.morning - c.evening}`);
    }
    const pay = [`Full ${c.fullPaid}`, `Partial ${c.partial}`];
    if (c.unpaid > 0) pay.push(`Unpaid ${c.unpaid}`);
    body.push(pay.join(" · "));
  }
  return body;
}

function outstandingBody(o: OutstandingBrief | null): string[] {
  if (!o || (o.overdueCount <= 0 && o.due7dAmount <= 0)) return [];
  const body: string[] = [];
  if (o.overdueCount > 0) body.push(`• Overdue — <b>${inrExact(o.overdueAmount)}</b> · ${o.overdueCount} students`);
  if (o.due7dAmount > 0) body.push(`• Due this week — <b>${inrExact(o.due7dAmount)}</b>`);
  return body;
}

function failedBody(failed: FailedBrief[]): string[] {
  if (!failed.length) return ["No unresolved payment failures"];
  const unresolved = failed.filter((p) => !p.recovered).length;
  const body = [
    `<b>${failed.length} failed attempt${failed.length === 1 ? "" : "s"}</b> · ${unresolved} unresolved`,
  ];
  failed.slice(0, 6).forEach((p) => {
    const mark = p.recovered ? "🟢" : "🔴";
    const status = p.recovered ? "<i>Later paid</i>" : "<i>Still failed</i>";
    body.push("");
    body.push(`${mark} ${escapeHtml(p.name)} — ${inrExact(p.amount)}`);
    body.push(`${escapeHtml(attentionItem(p.item))} · ${escapeHtml(p.when)} · ${status}`);
  });
  if (failed.length > 6) body.push(`• ${failed.length - 6} more`);
  return body;
}

function subjectBits(lines: { label: string; units: number }[], limit = 3): string {
  return lines
    .slice(0, limit)
    .map((row) => `${escapeHtml(row.label)} ${row.units}`)
    .join(" · ");
}

function notesHighlight(notes: NotesStoreReport): string | null {
  if (notes.allTimeOrders <= 0 && notes.fulfillment.open <= 0 && notes.attention.length <= 0) return null;
  if (notes.today.orders <= 0 && notes.attention.length > 0) {
    return `📦 Notes Store: No new orders · ${notes.attention.length} need attention`;
  }
  if (notes.today.orders <= 0) {
    return `📦 Notes Store: No new orders · ${notes.fulfillment.open} open`;
  }
  const tail = notes.attention.length
    ? ` · ${notes.attention.length} need attention`
    : notes.fulfillment.open
      ? ` · ${notes.fulfillment.open} open`
      : "";
  return `📦 Notes Store: ${notes.today.orders} orders · ${inrExact(notes.today.cashRupees)} today${tail}`;
}

function notesBody(notes: NotesStoreReport | null): string[] {
  if (!notes || (notes.allTimeOrders <= 0 && notes.fulfillment.open <= 0)) return [];
  const body: string[] = [];
  body.push(`<b>Today</b> — <b>${notes.today.orders} orders</b> · ${inrExact(notes.today.cashRupees)}`);
  body.push(`• ${notes.today.units} units · ${notes.today.customers} customers`);
  const todaySubjects = subjectBits(notes.today.subjects);
  if (todaySubjects) body.push(`• ${todaySubjects}`);
  if (notes.today.shipped > 0) body.push(`• Shipped today — ${notes.today.shipped}`);
  if (notes.today.delivered > 0) body.push(`• Delivered today — ${notes.today.delivered}`);
  body.push(`• Yesterday — ${notes.yesterday.orders} orders · ${inrExact(notes.yesterday.cashRupees)}`);

  body.push("");
  body.push(`<b>Month to Date</b> — <b>${notes.mtd.orders} orders</b> · ${inrExact(notes.mtd.cashRupees)}`);
  const aov = notes.mtd.orders > 0 ? notes.mtd.cashRupees / notes.mtd.orders : 0;
  body.push(`• ${notes.mtd.units} units · ${notes.mtd.customers} customers${aov ? ` · AOV ${inrExact(aov)}` : ""}`);
  const mtdSubjects = subjectBits(notes.mtd.subjects, 6);
  if (mtdSubjects) body.push(`• ${mtdSubjects}`);

  const fulfill: string[] = [];
  if (notes.fulfillment.toPack) fulfill.push(`To pack — ${notes.fulfillment.toPack}`);
  if (notes.fulfillment.packed) fulfill.push(`Packed — ${notes.fulfillment.packed}`);
  if (notes.fulfillment.shipmentCreated) fulfill.push(`Shipment created — ${notes.fulfillment.shipmentCreated}`);
  if (notes.fulfillment.inTransit) fulfill.push(`In transit — ${notes.fulfillment.inTransit}`);
  if (notes.fulfillment.outForDelivery) fulfill.push(`Out for delivery — ${notes.fulfillment.outForDelivery}`);
  if (notes.fulfillment.delivered) fulfill.push(`Delivered — ${notes.fulfillment.delivered}`);
  if (notes.fulfillment.rto) fulfill.push(`RTO — ${notes.fulfillment.rto}`);
  if (notes.fulfillment.returns) fulfill.push(`Returns — ${notes.fulfillment.returns}`);
  if (notes.fulfillment.issues) fulfill.push(`Issues — <b>${notes.fulfillment.issues}</b>`);
  if (fulfill.length) {
    body.push("");
    body.push("<b>Fulfillment</b>");
    for (const row of fulfill) body.push(`• ${row}`);
  }
  if (notes.providers.length > 1) {
    body.push(notes.providers.map((row) => `${escapeHtml(row.label)} ${row.count}`).join(" · "));
  }

  if (notes.openOrders.length) {
    body.push("");
    body.push("<b>Open Orders</b>");
    for (const order of notes.openOrders) {
      const age = order.age ? ` · ${order.age}` : "";
      body.push(`• ${escapeHtml(order.orderNo)} — ${escapeHtml(order.subjects)} — <b>${escapeHtml(order.label)}</b>${age}`);
    }
    if (notes.openOrdersTruncated) body.push("• Older open orders are in the status totals above");
  }

  if (notes.attention.length) {
    body.push("");
    body.push(`<b>Needs Attention — ${notes.attention.length}</b>`);
    for (const row of notes.attention.slice(0, 8)) {
      body.push(`• ${escapeHtml(row.orderNo)} — ${escapeHtml(row.subjects)} — <b>${escapeHtml(row.reason)}</b>`);
    }
  }

  body.push("");
  body.push(`<b>All time</b>`);
  body.push(`${notes.allTimeOrders} orders · ${notes.allTimeDelivered} delivered`);
  return body;
}

function highlightsBody(input: BriefInput): string[] {
  const body: string[] = [];
  const unique = input.people?.uniqueLoginUsers ?? input.login?.todayFallback ?? null;

  if (input.today) {
    body.push(`💰 <b>${inrExact(input.today.netCollection)}</b> collected today`);
    body.push(highlightSources(input.today));
  }

  if (input.webinar && (input.webinar.registered > 0 || (input.webinar.newToday || 0) > 0 || input.webinar.pendingCheckout > 0)) {
    if (body.length) body.push("");
    const today = input.webinar.newToday != null ? `+${input.webinar.newToday} today · ` : "";
    const pending = input.webinar.pendingCheckout > 0 ? ` · ${input.webinar.pendingCheckout} pending` : "";
    body.push(`📣 Webinar: ${today}<b>${input.webinar.registered}</b> paid total${pending}`);
    const sources = sourceSummary(input.webinar.sources, 4);
    body.push(sources || "Source attribution unavailable");
  }

  const activity: string[] = [];
  if (input.people?.newAccounts != null) activity.push(`${input.people.newAccounts} new`);
  if (unique != null) activity.push(`${unique} logged in`);
  if (input.people?.activeUsers != null) activity.push(`${input.people.activeUsers} active`);

  if (input.notes) {
    const line = notesHighlight(input.notes);
    if (line) {
      if (body.length) body.push("");
      body.push(line);
    }
  }

  if (activity.length) {
    if (body.length) body.push("");
    body.push(`👥 Activity: ${activity.join(" · ")}`);
  }

  if (input.sms) {
    if (body.length) body.push("");
    body.push(`📱 SMS: ${input.sms.sent} sent · ${input.sms.delivered} delivered · ${input.sms.failed} failed`);
  }

  const unresolved = input.failed.filter((p) => !p.recovered).length;
  const notesIssues = input.notes?.attention.length || 0;
  const alerts: string[] = [];
  if (unresolved > 0) alerts.push(`${unresolved} unresolved payment${unresolved === 1 ? "" : "s"}`);
  if (notesIssues > 0) alerts.push(`${notesIssues} Notes order issue${notesIssues === 1 ? "" : "s"}`);
  if (alerts.length) {
    if (body.length) body.push("");
    body.push(`⚠️ Attention: <b>${alerts.join(" · ")}</b>`);
  }
  return body;
}

export function executiveBriefLines(input: BriefInput): string[] {
  const lines: string[] = [];
  lines.push(RULE);
  lines.push("<b>NAMAN IAS — EXECUTIVE BRIEF</b>");
  lines.push(`${escapeHtml(input.dateLabel)} · ${escapeHtml(input.timeLabel)} IST`);
  lines.push(RULE);

  const opened = { value: false };
  const highlights = highlightsBody(input);
  if (highlights.length) {
    lines.push("");
    lines.push(heading("⚡", "KEY HIGHLIGHTS"));
    for (const row of highlights) lines.push(row);
    opened.value = true;
  }

  pushMajor(lines, opened, "💰", "COLLECTIONS", collectionBody(input));
  pushMajor(lines, opened, "📦", "NOTES STORE", notesBody(input.notes));
  pushMajor(lines, opened, "👥", "STUDENTS &amp; ACTIVITY", studentBody(input.people, input.login));
  pushMajor(lines, opened, "📱", "SMS DELIVERY", smsBody(input.sms));
  pushMajor(lines, opened, "📣", "WEBINAR", webinarBody(input.webinar));
  pushMajor(lines, opened, "🎓", "ADMISSIONS TODAY", admissionBody(input.todayAdmissions));
  pushMajor(lines, opened, "📚", "COURSE ADMISSIONS", courseBody(input.courses));
  pushMajor(lines, opened, "📋", "OUTSTANDING FEES", outstandingBody(input.outstanding));
  pushMajor(lines, opened, "⚠️", "PAYMENT ATTENTION", failedBody(input.failed));

  if (input.morningNote) {
    lines.push("");
    lines.push(input.morningNote);
  }
  return lines;
}

const CONTINUED = "<b>NAMAN IAS — EXECUTIVE BRIEF</b>\n<i>Continued</i>";

/** One message when it fits. Otherwise two, split on a section heading. */
export function packTelegramMessages(lines: string[], limit = 3900): string[] {
  const joined = lines.join("\n").trim();
  if (joined.length <= limit) return [joined];

  const heads = lines
    .map((line, index) => ({ index, line }))
    .filter(({ line }) => /^(💰|📦|👥|🎓|📱|📣|📚|📋|⚠️) /u.test(line));

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
  lines.push(RULE);
  lines.push("<b>NAMAN IAS — MONTHLY BRIEF</b>");
  lines.push(`<b>${escapeHtml(input.label)}</b>`);
  lines.push(RULE);
  const opened = { value: false };
  const monthBody = [
    `<b>Collected</b> — <b>${inrExact(input.money.netCollection)}</b>`,
    ...sourceBullets(input.money),
    `• ${paymentWord(input.money.successfulPayments)} · ${input.money.payingStudents} students`,
  ];
  if (input.money.refundAmount > 0) {
    monthBody.push(`• Gross ${inrExact(input.money.grossCollection)} · Refunds ${inrExact(input.money.refundAmount)}`);
  }
  const purposes = purposeLines(input.money);
  if (purposes.length) {
    monthBody.push("");
    monthBody.push("<b>Receipt Mix</b>");
    monthBody.push(...purposes);
  }
  pushMajor(lines, opened, "💰", "COLLECTIONS", monthBody);
  pushMajor(lines, opened, "👥", "STUDENTS &amp; ACTIVITY", studentBody(input.people, null));
  const adm =
    input.admissions.admissions <= 0
      ? ["No new admissions"]
      : [
          `<b>${input.admissions.admissions} new admission${input.admissions.admissions === 1 ? "" : "s"}</b>`,
          `• Students — ${input.admissions.students}`,
          ...input.admissions.byCourse
            .filter((course) => course.admissions > 0)
            .map((course) => `• ${escapeHtml(shortCourseTitle(course.title))} — ${course.admissions}`),
        ];
  pushMajor(lines, opened, "🎓", "ADMISSIONS", adm);
  if (input.sms) pushMajor(lines, opened, "📱", "SMS DELIVERY", smsBody(input.sms));
  if (input.money.payingStudents > 0) {
    lines.push("");
    lines.push(RULE);
    lines.push("");
    lines.push(`Average per paying student — ${inrExact(input.money.netCollection / input.money.payingStudents)}`);
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
    notes: null,
    morningNote: null,
  });
}
