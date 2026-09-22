/**
 * Telegram HTML for the daily business block and the month-end report.
 * Parse mode is HTML, matching the existing digest. Course titles are escaped.
 */
import type {
  AdmissionMetrics,
  CollectionCategory,
  CollectionMetrics,
  PeopleMetrics,
} from "../../analytics/businessMetrics";
import { escapeHtml, inrExact } from "./format";

const CATEGORY_LABEL: Record<CollectionCategory, string> = {
  admission: "Full payments",
  installment: "Installments",
  seat: "Seat bookings",
  webinar: "Webinars",
  plan: "Plans",
  other: "Other payments",
};

/** Order used in the daily breakdown. Amounts are a partition of gross collected. */
const CATEGORY_DISPLAY: CollectionCategory[] = [
  "installment",
  "seat",
  "admission",
  "webinar",
  "plan",
  "other",
];

function pushSection(lines: string[], header: string, body: string[]): void {
  if (!body.length) return;
  if (lines.length && lines[lines.length - 1] !== "") lines.push("");
  lines.push(header);
  for (const row of body) lines.push(row);
}

function peopleLines(p: PeopleMetrics): string[] {
  const body: string[] = [];
  if (p.newAccounts != null) body.push(`New accounts: <b>${p.newAccounts}</b>`);
  if (p.uniqueLoginUsers != null) body.push(`Unique logins: <b>${p.uniqueLoginUsers}</b>`);
  if (p.loginEvents != null) body.push(`Login events: <b>${p.loginEvents}</b>`);
  if (p.activeUsers != null) body.push(`Active students: <b>${p.activeUsers}</b>`);
  if (p.returningActiveUsers != null) body.push(`Returning active: <b>${p.returningActiveUsers}</b>`);
  return body;
}

function cashLines(c: CollectionMetrics, primaryLabel: string): string[] {
  const body = [
    `${primaryLabel}: <b>${inrExact(c.netCollection)}</b>`,
    `Payments: <b>${c.successfulPayments}</b>`,
    `Students who paid: <b>${c.payingStudents}</b>`,
  ];
  if (c.refundAmount > 0) {
    body.push(`Gross collected: <b>${inrExact(c.grossCollection)}</b>`);
    body.push(`Refunds: <b>${inrExact(c.refundAmount)}</b>`);
  }
  return body;
}

function categoryLines(c: CollectionMetrics): string[] {
  const lines: string[] = [];
  const present = CATEGORY_DISPLAY.filter((key) => {
    const cat = c.categories.find((x) => x.key === key);
    return !!cat && (cat.payments > 0 || cat.amount !== 0);
  });
  if (!present.length) return lines;
  if (c.refundAmount > 0) lines.push("Breakdown is gross collected, before refunds.");
  for (const key of present) {
    const cat = c.categories.find((x) => x.key === key)!;
    lines.push(`${CATEGORY_LABEL[key]}: <b>${inrExact(cat.amount)}</b>`);
  }
  return lines;
}

function admissionLines(admissions: AdmissionMetrics): string[] {
  const body = [`New admissions: <b>${admissions.admissions}</b>`];
  for (const course of admissions.byCourse.slice(0, 6)) {
    body.push(`${escapeHtml(course.title)}: <b>${course.admissions}</b>`);
  }
  if (admissions.byCourse.length > 6) {
    body.push(`…and <b>${admissions.byCourse.length - 6}</b> more courses`);
  }
  return body;
}

export function dailyBusinessLines(input: {
  people: PeopleMetrics | null;
  today: CollectionMetrics | null;
  todayAdmissions: AdmissionMetrics | null;
  yesterday: CollectionMetrics | null;
  mtd: CollectionMetrics | null;
}): string[] {
  const lines: string[] = [];
  if (input.people) {
    const body = peopleLines(input.people);
    if (body.length) pushSection(lines, `<b>STUDENTS</b>`, body);
  }
  if (input.today) {
    pushSection(lines, `<b>COLLECTED TODAY</b>`, [
      ...cashLines(input.today, "Actual collected"),
      ...categoryLines(input.today),
    ]);
  }
  if (input.yesterday) {
    pushSection(lines, `<b>YESTERDAY</b>`, cashLines(input.yesterday, "Collected"));
  }
  if (input.mtd) {
    pushSection(lines, `<b>MONTH TO DATE</b>`, [
      ...cashLines(input.mtd, "Actual collected"),
      ...categoryLines(input.mtd),
    ]);
  }
  if (input.todayAdmissions) {
    pushSection(lines, `<b>ADMISSIONS TODAY</b>`, admissionLines(input.todayAdmissions));
  }
  return lines;
}

export function monthlyBusinessHtml(input: {
  label: string;
  people: PeopleMetrics | null;
  money: CollectionMetrics;
  admissions: AdmissionMetrics;
}): string {
  const lines: string[] = [];
  lines.push(`<b>NAMAN IAS — MONTHLY BUSINESS REPORT</b>`);
  lines.push(`<b>${escapeHtml(input.label)}</b>`);

  const moneyBody = [
    ...cashLines(input.money, "Actual collected"),
    ...categoryLines(input.money),
  ];
  pushSection(lines, `<b>COLLECTION</b>`, moneyBody);

  const admBody = [`New admissions: <b>${input.admissions.admissions}</b>`, `Students: <b>${input.admissions.students}</b>`];
  for (const course of input.admissions.byCourse.slice(0, 8)) {
    admBody.push(`${escapeHtml(course.title)}: <b>${course.admissions}</b>`);
  }
  pushSection(lines, `<b>ADMISSIONS</b>`, admBody);

  if (input.people) {
    const body = peopleLines(input.people);
    if (body.length) pushSection(lines, `<b>PORTAL</b>`, body);
  }

  const insights: string[] = [];
  if (input.money.payingStudents > 0) {
    insights.push(
      `Average per paying student <b>${inrExact(input.money.netCollection / input.money.payingStudents)}</b>`,
    );
  }
  if (input.money.successfulPayments > 0) {
    insights.push(
      `Average per payment <b>${inrExact(input.money.netCollection / input.money.successfulPayments)}</b>`,
    );
  }
  if (insights.length) pushSection(lines, `<b>INSIGHTS</b>`, insights);

  return lines.join("\n");
}
