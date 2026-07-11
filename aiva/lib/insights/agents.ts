import {
  fetchPayments,
  fetchCourseEnrollments,
  fetchWebinarRegistrations,
  fetchWebinars,
} from "../data";
import { isPaidStatus, dedupePaidRows } from "@portal/lib/paymentsAgg";
import { deriveEnrollment, isActiveEnrollment } from "@portal/lib/installments";
import { getRevenueTower, type RevenueTower } from "../revenue/tower";
import { inr } from "../revenue/dailyBrief";
import {
  normPhone,
  pct,
  ratePerDay,
  trend,
  funnelStages,
  daysAgo,
  type FunnelStage,
} from "./calc";
import type { CourseEnrollment } from "@portal/lib/types";

/**
 * DB-facing insight builders. Each REASONS over already-verified read primitives
 * (isPaidStatus, dedupePaidRows, deriveEnrollment, isActiveEnrollment) so every number
 * ties out with the portal's Payments/Finance truth. Read-only: no writes, no side effects.
 *
 * Where a requested insight can't be honestly computed from the current schema, the builder
 * returns a `caveats[]` string naming the exact missing field/relationship — it never fakes it.
 */

export type FunnelBar = { label: string; value: number; sub?: string };

export type AgentIntel = {
  headline: string;
  metrics: { label: string; value: string; hint?: string }[];
  funnelTitle?: string;
  funnel?: FunnelBar[];
  caveats?: string[];
};

/** Index active enrollments by normalized phone (first-enrolled kept for timing). */
function activeByPhone(enrollments: CourseEnrollment[]): Map<string, CourseEnrollment[]> {
  const m = new Map<string, CourseEnrollment[]>();
  for (const e of enrollments) {
    if (!isActiveEnrollment(e)) continue;
    const ph = normPhone(e.phone);
    if (ph.length !== 10) continue;
    const arr = m.get(ph);
    if (arr) arr.push(e);
    else m.set(ph, [e]);
  }
  return m;
}

function funnelBars(stages: FunnelStage[]): FunnelBar[] {
  return stages.map((s, i) => ({
    label: s.label,
    value: s.value,
    sub: i === 0 ? "top of funnel" : `${s.ofPrev}% of prev · ${s.ofTop}% of top`,
  }));
}

/**
 * THE webinar funnel: registrants → converted to admission → paid, linked by normalized phone
 * (the portal's identity key). Also splits converts booked before vs after their first webinar.
 */
export async function webinarFunnel(now = Date.now()): Promise<AgentIntel> {
  const [regs, enrollments, webinars] = await Promise.all([
    fetchWebinarRegistrations(),
    fetchCourseEnrollments(),
    fetchWebinars(),
  ]);

  // Registrant phones: first registration time + whether ever marked attended.
  const regByPhone = new Map<string, { firstReg: number; attended: boolean }>();
  for (const r of regs) {
    const ph = normPhone(r.phone);
    if (ph.length !== 10) continue;
    const t = Date.parse(r.created_at) || now;
    const prev = regByPhone.get(ph);
    if (!prev) regByPhone.set(ph, { firstReg: t, attended: !!r.attended });
    else {
      prev.firstReg = Math.min(prev.firstReg, t);
      prev.attended = prev.attended || !!r.attended;
    }
  }

  const enrByPhone = activeByPhone(enrollments);
  const regPhones = regByPhone.size;
  const convertedPhones = [...regByPhone.keys()].filter((ph) => enrByPhone.has(ph));
  const converted = convertedPhones.length;

  let convertedPaid = 0;
  let collectedFromCohort = 0;
  let stillOwing = 0;
  let bookedBefore = 0;
  let bookedAfter = 0;
  for (const ph of convertedPhones) {
    const es = enrByPhone.get(ph)!;
    const paidSum = es.reduce((a, e) => a + deriveEnrollment(e).paid, 0);
    collectedFromCohort += paidSum;
    if (paidSum > 0) convertedPaid += 1;
    if (es.some((e) => deriveEnrollment(e).remaining > 0)) stillOwing += 1;
    const firstEnr = Math.min(...es.map((e) => Date.parse(e.created_at) || now));
    if (firstEnr < regByPhone.get(ph)!.firstReg) bookedBefore += 1;
    else bookedAfter += 1;
  }

  const convPct = pct(converted, regPhones);
  const stages = funnelStages([
    { label: "Registrants (phone-linked)", value: regPhones },
    { label: "Converted to admission", value: converted },
    { label: "Paid ≥ 1 installment", value: convertedPaid },
  ]);

  // Attendance quality + registration-source reconciliation → honest caveats.
  const attendedTrue = [...regByPhone.values()].filter((v) => v.attended).length;
  const denormReg = webinars.reduce((a, w) => a + (Number(w.registrations) || 0), 0);
  const rowReg = regs.length;
  const caveats: string[] = [
    "Registrant→admission link is by normalized phone (last 10 digits) — the same identity key the portal reconciles on. A registrant who enrolls under a different number is not matched.",
  ];
  if (attendedTrue === 0) {
    caveats.push(
      "Attendance→conversion is NOT shown: webinar_registrations.attended is false/unset for every row. Populate it (post-webinar attendee sync) to unlock attendee-vs-no-show conversion.",
    );
  }
  if (denormReg !== rowReg && denormReg > 0) {
    caveats.push(
      `Two registration sources disagree: webinars.registrations totals ${denormReg} (aggregate counter) vs ${rowReg} per-registration rows carrying a phone. Conversion is computed only on the ${rowReg} phone-bearing rows; webinars stored as an aggregate count can't be phone-linked.`,
    );
  }

  const headline =
    regPhones === 0
      ? "No phone-linked webinar registrations yet — funnel activates once registrations carry a phone."
      : `${converted} of ${regPhones} webinar registrants (${convPct}%) converted to admission; ${convertedPaid} have paid, ${inr(collectedFromCohort)} collected from this cohort${bookedAfter > 0 ? ` — ${bookedAfter} booked after their webinar` : ""}.`;

  return {
    headline,
    metrics: [
      { label: "Registrants (linked)", value: String(regPhones), hint: `${rowReg} rows` },
      { label: "Converted", value: `${converted}`, hint: `${convPct}% of registrants` },
      { label: "Paid cohort", value: `${convertedPaid}`, hint: `${stillOwing} still owing` },
      { label: "Cohort collected", value: inr(collectedFromCohort) },
      { label: "Booked after webinar", value: String(bookedAfter) },
      { label: "Booked before webinar", value: String(bookedBefore) },
    ],
    funnelTitle: "Webinar → Admission funnel",
    funnel: funnelBars(stages),
    caveats,
  };
}

/**
 * Admissions intelligence: enrollments broken down BY BATCH (not one total), booking pace,
 * and how many admissions came through a tracked webinar.
 */
export async function admissionsIntel(now = Date.now()): Promise<AgentIntel> {
  const [enrollments, regs] = await Promise.all([
    fetchCourseEnrollments(),
    fetchWebinarRegistrations(),
  ]);
  const active = enrollments.filter(isActiveEnrollment);

  // Per-batch breakdown (course + batch label). batch_label is a freeform display string.
  const byBatch = new Map<string, { count: number; collected: number }>();
  for (const e of active) {
    const key = `${e.course_title || "Course"} · ${e.batch_label || "No batch set"}`;
    const b = byBatch.get(key) || { count: 0, collected: 0 };
    b.count += 1;
    b.collected += deriveEnrollment(e).paid;
    byBatch.set(key, b);
  }
  const batches = [...byBatch.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.count - a.count);

  // Booking pace over rolling windows.
  const ts = (e: CourseEnrollment) => Date.parse(e.created_at) || 0;
  const last14 = active.filter((e) => ts(e) >= daysAgo(now, 14)).length;
  const last30 = active.filter((e) => ts(e) >= daysAgo(now, 30)).length;
  const perDay14 = ratePerDay(last14, 14);

  // Webinar-sourced admissions (phone-linked).
  const regByPhone = new Map<string, number>();
  for (const r of regs) {
    const ph = normPhone(r.phone);
    if (ph.length !== 10) continue;
    const t = Date.parse(r.created_at) || now;
    regByPhone.set(ph, Math.min(regByPhone.get(ph) ?? Infinity, t));
  }
  let viaWebinar = 0;
  let afterWebinar = 0;
  for (const e of active) {
    const ph = normPhone(e.phone);
    const reg = regByPhone.get(ph);
    if (reg == null) continue;
    viaWebinar += 1;
    if ((ts(e) || now) >= reg) afterWebinar += 1;
  }

  const topBatch = batches[0];
  const headline =
    active.length === 0
      ? "No active enrollments yet."
      : `${active.length} active enrollments across ${batches.length} batch${batches.length === 1 ? "" : "es"}; booking ~${perDay14.toFixed(1)}/day (last 14d)${topBatch ? `. Biggest batch: ${topBatch.label.split(" · ").pop()} (${topBatch.count})` : ""}. ${viaWebinar} came via a tracked webinar.`;

  const caveats = [
    "Next-batch timeline & seat-fill (\"fills in ~N days\", \"% of seats booked\") can't be computed: courses.batches[].start_date, .capacity and .seats_left are all null, and course_enrollments has no batch_id FK (only a freeform batch_label). To unlock this, populate start_date + capacity per batch in courses.batches and stamp a batch_id on course_enrollments so admissions attach to a specific dated batch.",
  ];

  return {
    headline,
    metrics: [
      { label: "Active enrollments", value: String(active.length) },
      { label: "Distinct batches", value: String(batches.length) },
      { label: "Pace (last 14d)", value: `${perDay14.toFixed(1)}/day`, hint: `${last14} in 14d · ${last30} in 30d` },
      { label: "Via webinar", value: String(viaWebinar), hint: `${afterWebinar} after registering` },
    ],
    funnelTitle: "Active enrollments by batch",
    funnel: batches.slice(0, 6).map((b) => ({
      label: b.label,
      value: b.count,
      sub: `${inr(b.collected)} collected`,
    })),
    caveats,
  };
}

export type RevenueIntel = AgentIntel & { tower: RevenueTower };

/**
 * Revenue intelligence: not just a collected total — 30-day trend, collection rate,
 * overdue aging, at-risk revenue, and a webinar-cohort vs direct split. Reuses the Revenue
 * Control Tower verbatim so headline numbers match the Payments tab.
 */
export async function revenueIntel(now = Date.now()): Promise<RevenueIntel> {
  const [tower, payments, regs] = await Promise.all([
    getRevenueTower(now),
    fetchPayments(),
    fetchWebinarRegistrations(),
  ]);

  const deduped = dedupePaidRows(payments.filter((p) => isPaidStatus(p.status)));
  const ts = (iso: string) => Date.parse(iso) || 0;
  const cut30 = daysAgo(now, 30);
  const cut60 = daysAgo(now, 60);
  let last30 = 0;
  let prev30 = 0;
  for (const p of deduped) {
    const t = ts(p.created_at);
    if (t >= cut30) last30 += p.amount;
    else if (t >= cut60 && t < cut30) prev30 += p.amount;
  }
  const tr = trend(last30, prev30);
  const collectionRate = pct(tower.collected, tower.expected);

  // Cohort split on the SAME deduped rows → reconciles exactly with tower.collected.
  const regPhones = new Set<string>();
  for (const r of regs) {
    const ph = normPhone(r.phone);
    if (ph.length === 10) regPhones.add(ph);
  }
  let webinarCohort = 0;
  for (const p of deduped) if (regPhones.has(normPhone(p.phone))) webinarCohort += p.amount;
  const direct = Math.max(0, tower.collected - webinarCohort);

  const dirWord = tr.direction === "up" ? "up" : tr.direction === "down" ? "down" : "flat";
  const headline = `${inr(last30)} collected in the last 30d (${dirWord}${tr.direction !== "flat" ? ` ${Math.abs(tr.deltaPct)}%` : ""} vs prior 30d); collection rate ${collectionRate}% with ${inr(tower.outstanding)} outstanding and ${inr(tower.atRiskRevenue)} at risk.`;

  return {
    tower,
    headline,
    metrics: [
      { label: "Collected (30d)", value: inr(last30), hint: `prior 30d ${inr(prev30)}` },
      { label: "Trend", value: `${tr.deltaPct >= 0 ? "+" : ""}${tr.deltaPct}%`, hint: dirWord },
      { label: "Collection rate", value: `${collectionRate}%`, hint: `of ${inr(tower.expected)} expected` },
      { label: "At-risk", value: inr(tower.atRiskRevenue), hint: "overdue + abandoned" },
      { label: "Webinar cohort", value: inr(webinarCohort) },
      { label: "Direct", value: inr(direct) },
    ],
    funnelTitle: "Overdue aging",
    funnel: [
      { label: "Due today", value: tower.dueToday.count, sub: inr(tower.dueToday.amount) },
      { label: "1–3 days", value: tower.overdue1_3.count, sub: inr(tower.overdue1_3.amount) },
      { label: "4–7 days", value: tower.overdue4_7.count, sub: inr(tower.overdue4_7.amount) },
      { label: "8+ days", value: tower.overdue8plus.count, sub: inr(tower.overdue8plus.amount) },
    ],
    caveats: [
      "Cohort split uses the same deduped PAID rows as the Payments tab; webinar-cohort = paid rows whose phone matches a webinar registrant (last-10-digit key), everything else is counted as direct.",
    ],
  };
}
