/**
 * Telegram HTML for the daily business block and the month-end report.
 * Parse mode is HTML, matching the existing digest. Course titles are escaped.
 */
import type {
  AdmissionMetrics,
  CategoryLine,
  CollectionCategory,
  CollectionMetrics,
  PeopleMetrics,
} from "../../analytics/businessMetrics";
import { escapeHtml, inrExact } from "./format";

const CATEGORY_LABEL: Record<CollectionCategory, string> = {
  admission: "New admissions",
  installment: "Installments",
  seat: "Seat bookings",
  webinar: "Webinars",
  plan: "Plans",
  other: "Other",
};

function pushSection(lines: string[], header: string, body: string[]): void {
  if (!body.length) return;
  if (lines.length && lines[lines.length - 1] !== "") lines.push("");
  lines.push(header);
  for (const row of body) lines.push(row);
}

function peopleLines(p: PeopleMetrics): string[] {
  const body: string[] = [];
  if (p.newAccounts != null) body.push(`🆕 New accounts <b>${p.newAccounts}</b>`);
  if (p.uniqueLoginUsers != null) {
    const events = p.loginEvents != null ? ` · Events <b>${p.loginEvents}</b>` : "";
    body.push(`🔐 Unique logins <b>${p.uniqueLoginUsers}</b>${events}`);
  }
  if (p.activeUsers != null) body.push(`👥 Active students <b>${p.activeUsers}</b>`);
  if (p.returningActiveUsers != null) body.push(`🔁 Returning active <b>${p.returningActiveUsers}</b>`);
  return body;
}

function moneyLines(c: CollectionMetrics, admissions: AdmissionMetrics | null): string[] {
  const body: string[] = [
    `Net <b>${inrExact(c.netCollection)}</b> · Payments <b>${c.successfulPayments}</b> · Students <b>${c.payingStudents}</b>`,
  ];
  if (c.refundAmount > 0) {
    body.push(`Gross <b>${inrExact(c.grossCollection)}</b> · Refunds <b>${inrExact(c.refundAmount)}</b>`);
  }
  const cats = c.categories.filter((x) => x.payments > 0 || x.amount !== 0);
  for (const cat of cats) body.push(categoryRow(cat));
  if (admissions) {
    body.push(`🎓 New admissions <b>${admissions.admissions}</b>`);
    for (const course of admissions.byCourse.slice(0, 6)) {
      body.push(`${escapeHtml(course.title)} <b>${course.admissions}</b>`);
    }
    if (admissions.byCourse.length > 6) {
      body.push(`…and <b>${admissions.byCourse.length - 6}</b> more courses`);
    }
  }
  return body;
}

function categoryRow(cat: CategoryLine): string {
  const who = cat.key === "other" ? `${cat.payments} payments` : `${cat.students} students`;
  return `• ${CATEGORY_LABEL[cat.key]} — <b>${inrExact(cat.amount)}</b> · ${who}`;
}

export function dailyBusinessLines(input: {
  people: PeopleMetrics | null;
  today: CollectionMetrics | null;
  todayAdmissions: AdmissionMetrics | null;
  mtd: CollectionMetrics | null;
  mtdAdmissions: AdmissionMetrics | null;
}): string[] {
  const lines: string[] = [];
  if (input.people) {
    const body = peopleLines(input.people);
    if (body.length) pushSection(lines, `👥 <b>STUDENTS</b>`, body);
  }
  if (input.today) {
    pushSection(lines, `💰 <b>COLLECTED TODAY</b>`, moneyLines(input.today, input.todayAdmissions));
  }
  if (input.mtd) {
    const mtdBody = [
      `Net <b>${inrExact(input.mtd.netCollection)}</b> · Payments <b>${input.mtd.successfulPayments}</b> · Students <b>${input.mtd.payingStudents}</b>`,
    ];
    if (input.mtdAdmissions) mtdBody.push(`Admissions <b>${input.mtdAdmissions.admissions}</b>`);
    const inst = input.mtd.categories.find((c) => c.key === "installment");
    const seat = input.mtd.categories.find((c) => c.key === "seat");
    const bits = [
      inst && (inst.amount !== 0 || inst.payments > 0) ? `Installments <b>${inrExact(inst.amount)}</b>` : null,
      seat && (seat.amount !== 0 || seat.payments > 0) ? `Seat bookings <b>${inrExact(seat.amount)}</b>` : null,
    ].filter(Boolean);
    if (bits.length) mtdBody.push(bits.join(" · "));
    pushSection(lines, `📈 <b>MONTH TO DATE</b>`, mtdBody);
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
  lines.push(`🏆 <b>NAMAN IAS — MONTHLY BUSINESS REPORT</b>`);
  lines.push(`📅 <b>${escapeHtml(input.label)}</b>`);

  const moneyBody = [
    `Net collection <b>${inrExact(input.money.netCollection)}</b>`,
    `Gross <b>${inrExact(input.money.grossCollection)}</b> · Refunds <b>${inrExact(input.money.refundAmount)}</b>`,
    `Payments <b>${input.money.successfulPayments}</b> · Students who paid <b>${input.money.payingStudents}</b>`,
  ];
  pushSection(lines, `💰 <b>COLLECTION</b>`, moneyBody);

  const cats = input.money.categories.filter((c) => c.payments > 0 || c.amount !== 0);
  if (cats.length) {
    pushSection(
      lines,
      `🎓 <b>COLLECTION BREAKDOWN</b>`,
      cats.map((c) => {
        const who = c.key === "other" ? `${c.payments} payments` : `${c.students} students`;
        return `${CATEGORY_LABEL[c.key]}\n<b>${inrExact(c.amount)}</b> · ${who}`;
      }),
    );
  }

  const admBody = [`New admissions <b>${input.admissions.admissions}</b> · Students <b>${input.admissions.students}</b>`];
  for (const course of input.admissions.byCourse.slice(0, 8)) {
    admBody.push(`${escapeHtml(course.title)} <b>${course.admissions}</b>`);
  }
  pushSection(lines, `🎓 <b>ADMISSIONS</b>`, admBody);

  if (input.people) {
    const body = peopleLines(input.people);
    if (body.length) pushSection(lines, `👥 <b>PORTAL</b>`, body);
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
  if (insights.length) pushSection(lines, `📊 <b>INSIGHTS</b>`, insights);

  return lines.join("\n");
}
