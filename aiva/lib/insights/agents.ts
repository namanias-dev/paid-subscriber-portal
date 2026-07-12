import {
  fetchPayments,
  fetchCourseEnrollments,
  fetchWebinarRegistrations,
  fetchWebinars,
  fetchCoursesLite,
  type CourseLite,
} from "../data";
import { isPaidStatus, dedupePaidRows } from "@portal/lib/paymentsAgg";
import { deriveEnrollment, isActiveEnrollment } from "@portal/lib/installments";
import { getRevenueTower, type RevenueTower } from "../revenue/tower";
import { inr } from "../revenue/dailyBrief";
import {
  normPhone,
  pct,
  ratePerDay,
  etaDays,
  trend,
  funnelStages,
  daysAgo,
  attendeeConversion,
  dailySeries,
  type FunnelStage,
} from "./calc";
import type { CourseEnrollment, WebinarRegistration, Webinar } from "@portal/lib/types";

/**
 * DB-facing insight builders. Each REASONS over verified read primitives (isPaidStatus,
 * dedupePaidRows, deriveEnrollment, isActiveEnrollment) so numbers tie out with the portal's
 * Payments/Finance truth. Read-only: no writes, no side effects.
 *
 * As of the Phase B/C data-plumbing fix these consume the NEW additive columns:
 *   - webinar_registrations.matched_enrollment_id / match_method  (phone-confirmed vs name-probable)
 *   - webinars.registrations_source  (row_level vs aggregate_manual/vanity)
 *   - course_enrollments.batch_id     (mapped from batch_label; enables per-batch + seat-fill)
 * Where an insight still can't be honestly computed, the builder returns a `caveats[]` string
 * naming the exact missing field — it never fakes it.
 */

const DAY = 86_400_000;

export type FunnelBar = { label: string; value: number; sub?: string; drill?: string };

export type AgentIntel = {
  headline: string;
  metrics: { label: string; value: string; hint?: string; drill?: string }[];
  funnelTitle?: string;
  funnel?: FunnelBar[];
  caveats?: string[];
  /** Optional trend series (oldest→newest) for a small sparkline. */
  sparkline?: number[];
  sparklineLabel?: string;
};

type RegRow = WebinarRegistration & { matched_enrollment_id?: string | null; match_method?: string | null };
type EnrRow = CourseEnrollment & { batch_id?: string | null };
type WebRow = Webinar & { registrations_source?: string | null };

function funnelBars(stages: FunnelStage[]): FunnelBar[] {
  return stages.map((s, i) => ({
    label: s.label,
    value: s.value,
    sub: i === 0 ? "top of funnel" : `${s.ofPrev}% of prev · ${s.ofTop}% of top`,
  }));
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * THE webinar funnel on the CORRECTED link: registrants → phone-confirmed converts → paid,
 * with a separate probable (name-match) tier and honest handling of aggregate-only webinars.
 */
export async function webinarFunnel(now = Date.now()): Promise<AgentIntel> {
  const [regs, enrollments, webinars] = await Promise.all([
    fetchWebinarRegistrations(),
    fetchCourseEnrollments(),
    fetchWebinars(),
  ]);
  const enrById = new Map(enrollments.map((e) => [e.id, e]));

  // Distinct registrant phones (row-level), carrying the DB-computed match tier + timing.
  const byPhone = new Map<
    string,
    { method: "phone" | "name_probable" | null; enrId: string | null; firstReg: number; attended: boolean }
  >();
  for (const r of regs as RegRow[]) {
    const ph = normPhone(r.phone);
    if (ph.length !== 10) continue;
    const method = r.match_method === "phone" ? "phone" : r.match_method === "name_probable" ? "name_probable" : null;
    const t = Date.parse(r.created_at) || now;
    const cur = byPhone.get(ph);
    if (!cur) {
      byPhone.set(ph, { method, enrId: r.matched_enrollment_id ?? null, firstReg: t, attended: !!r.attended });
    } else {
      if (method === "phone" || (method === "name_probable" && cur.method == null)) {
        cur.method = method;
        cur.enrId = r.matched_enrollment_id ?? cur.enrId;
      }
      cur.firstReg = Math.min(cur.firstReg, t);
      cur.attended = cur.attended || !!r.attended;
    }
  }

  const regPhones = byPhone.size;
  let confirmed = 0;
  let probable = 0;
  let paidConfirmed = 0;
  let collectedConfirmed = 0;
  let owingConfirmed = 0;
  let bookedBefore = 0;
  let bookedAfter = 0;
  for (const v of byPhone.values()) {
    if (v.method === "phone") {
      confirmed += 1;
      const e = v.enrId ? enrById.get(v.enrId) : null;
      if (e) {
        const d = deriveEnrollment(e);
        collectedConfirmed += d.paid;
        if (d.paid > 0) paidConfirmed += 1;
        if (d.remaining > 0) owingConfirmed += 1;
        const fe = Date.parse(e.created_at) || now;
        if (fe < v.firstReg) bookedBefore += 1;
        else bookedAfter += 1;
      }
    } else if (v.method === "name_probable") {
      probable += 1;
    }
  }

  const convPct = pct(confirmed, regPhones);
  const agg = (webinars as WebRow[]).filter((w) => w.registrations_source === "aggregate_manual");
  const aggCount = agg.reduce((a, w) => a + (Number(w.registrations) || 0), 0);
  const attendedKnown = [...byPhone.values()].some((v) => v.attended);

  // BUILD 3 — attendee-vs-no-show conversion (auto-computes the moment attendance is uploaded).
  const att = attendeeConversion([...byPhone.values()].map((v) => ({ attended: v.attended, converted: v.method === "phone" })));

  const stages = funnelStages([
    { label: "Registrants (row-level)", value: regPhones },
    { label: "Converted — phone-confirmed", value: confirmed },
    { label: "Paid ≥ 1 installment", value: paidConfirmed },
  ]);
  const bars = funnelBars(stages);
  bars[0].drill = "webinar:registrants";
  bars[1].drill = "webinar:converted";
  bars[bars.length - 1].drill = "webinar:paid";
  if (probable > 0) bars.splice(2, 0, { label: "+ Probable (name-match)", value: probable, sub: "needs review — not in rate", drill: "webinar:probable" });

  const headline =
    regPhones === 0
      ? "No row-level webinar registrations to link yet."
      : `${confirmed} of ${regPhones} row-level registrants (${convPct}%) converted to admission — phone-confirmed; +${probable} probable via name-match. ${inr(collectedConfirmed)} collected from the confirmed cohort${att.known ? `. Attendees convert at ${att.attendeeConvPct}% vs ${att.noShowConvPct}% for no-shows` : ""}${aggCount > 0 ? `. ${aggCount.toLocaleString("en-IN")} more registrants exist only as aggregate counts and can't be linked` : ""}.`;

  const caveats: string[] = [];
  if (agg.length > 0) {
    caveats.push(
      `${agg.length} webinar(s) hold only an aggregate registration count (${agg.map((w) => `${w.title}: ${w.registrations}`).join("; ")}) with NO per-registrant rows — checked import_jobs + webinar_audit_log, unrecoverable. They are excluded from conversion, not faked. Use the CSV import tool to recover them if you find the original lists.`,
    );
  }
  if (probable > 0) {
    caveats.push(
      `${probable} probable convert(s) matched by name with a DIFFERENT phone than they registered with — shown separately and NOT merged into the confirmed rate. Review them at /aiva/probable-matches.`,
    );
  }
  if (!att.known) {
    caveats.push(
      "Attendee-vs-no-show conversion: attendance not yet uploaded (webinar_registrations.attended all unset). Upload an attendee phone list via POST /api/admin/webinars/:id/attendance and this computes automatically.",
    );
  }

  const metrics = [
    { label: "Registrants (row-level)", value: String(regPhones), drill: "webinar:registrants" },
    { label: "Converted (confirmed)", value: String(confirmed), hint: `${convPct}% · +${probable} probable`, drill: "webinar:converted" },
    { label: "Probable (review)", value: String(probable), hint: "unconfirmed", drill: "webinar:probable" },
    { label: "Paid cohort", value: String(paidConfirmed), hint: `${owingConfirmed} still owing`, drill: "webinar:paid" },
    { label: "Cohort collected", value: inr(collectedConfirmed) },
    { label: "Booked after webinar", value: String(bookedAfter), hint: `${bookedBefore} before` },
    {
      label: "Attendee vs no-show",
      value: att.known ? `${att.attendeeConvPct}% / ${att.noShowConvPct}%` : "Not uploaded",
      hint: att.known ? `${att.attendees} attended · ${att.noShows} no-show` : "upload attendee list to unlock",
    },
    { label: "Aggregate-only (unlinkable)", value: aggCount.toLocaleString("en-IN") },
  ];

  return {
    headline,
    metrics,
    funnelTitle: "Webinar → Admission funnel (corrected link)",
    funnel: bars,
    caveats,
  };
}

/** Nearest-first upcoming-batch timeline built from the newly usable batch_id + batches[] dates. */
function buildBatchTimeline(courses: CourseLite[], active: EnrRow[], now: number) {
  const out: { course: string; label: string; daysTo: number; booked: number; capacity: number | null; pctFill: number | null; eta: number | null }[] = [];
  for (const c of courses) {
    for (const b of c.batches || []) {
      const startMs = b.start_date ? Date.parse(b.start_date) : NaN;
      if (!Number.isFinite(startMs) || startMs <= now) continue;
      const booked = active.filter((e) => e.batch_id === b.id).length;
      const capacity = numOrNull(b.capacity) ?? c.capacity ?? null;
      const last14 = active.filter((e) => e.batch_id === b.id && (Date.parse(e.created_at) || 0) >= daysAgo(now, 14)).length;
      const perDay = ratePerDay(last14, 14);
      out.push({
        course: c.title || c.slug || c.id,
        label: b.label || b.id || "Batch",
        daysTo: Math.ceil((startMs - now) / DAY),
        booked,
        capacity,
        pctFill: capacity ? pct(booked, capacity) : null,
        eta: capacity ? etaDays(capacity - booked, perDay) : null,
      });
    }
  }
  return out.sort((a, b) => a.daysTo - b.daysTo);
}

/** Admissions intelligence: per-BATCH breakdown (via batch_id), booking pace, and upcoming-batch timeline. */
export async function admissionsIntel(now = Date.now()): Promise<AgentIntel> {
  const [enrollments, courses] = await Promise.all([fetchCourseEnrollments(), fetchCoursesLite()]);
  const active = (enrollments as EnrRow[]).filter(isActiveEnrollment);

  // batch_id → "Course · Batch label" for readable grouping.
  const batchLabelById = new Map<string, string>();
  for (const c of courses) for (const b of c.batches || []) if (b.id) batchLabelById.set(b.id, `${c.title || "Course"} · ${b.label || b.id}`);

  const byBatch = new Map<string, { count: number; collected: number; batchId: string | null }>();
  let mapped = 0;
  for (const e of active) {
    if (e.batch_id) mapped += 1;
    const key = e.batch_id ? batchLabelById.get(e.batch_id) || `${e.course_title} · ${e.batch_id}` : `${e.course_title || "Course"} · ${e.batch_label || "Unmapped"}`;
    const b = byBatch.get(key) || { count: 0, collected: 0, batchId: e.batch_id ?? null };
    b.count += 1;
    b.collected += deriveEnrollment(e).paid;
    byBatch.set(key, b);
  }
  const batches = [...byBatch.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.count - a.count);

  const ts = (e: EnrRow) => Date.parse(e.created_at) || 0;
  const last14 = active.filter((e) => ts(e) >= daysAgo(now, 14)).length;
  const perDay14 = ratePerDay(last14, 14);

  const timeline = buildBatchTimeline(courses, active, now);
  const next = timeline[0];

  const headline =
    active.length === 0
      ? "No active enrollments yet."
      : next
        ? `Next batch "${next.label.split(" · ").pop()}" (${next.course}) starts in ${next.daysTo} day${next.daysTo === 1 ? "" : "s"}; ${next.booked}${next.capacity ? `/${next.capacity} seats (${next.pctFill}%)` : " booked (capacity not set)"}${next.eta != null ? ` · ~${next.eta}d to fill at current pace` : ""}. ${active.length} active enrollments overall, ~${perDay14.toFixed(1)}/day.`
        : `${active.length} active enrollments across ${batches.length} batches; booking ~${perDay14.toFixed(1)}/day (14d). No dated upcoming batch configured.`;

  const unmapped = active.length - mapped;
  const caveats: string[] = [
    `${mapped}/${active.length} active enrollments now carry a batch_id (exact-label + sole-batch mapping); ${unmapped} remain unmapped where a course has multiple batches sharing one date-only label (e.g. Public Administration, Safalta GS 2027) — those can't be split by mode/timing from batch_label alone.`,
  ];
  const capGaps = timeline.filter((t) => t.capacity == null).map((t) => t.course);
  if (capGaps.length) {
    caveats.push(
      `Seat-fill % is shown only where a batch has capacity set; upcoming batches without capacity (${[...new Set(capGaps)].join(", ")}) show booked counts only.`,
    );
  }

  return {
    headline,
    metrics: [
      { label: "Active enrollments", value: String(active.length), drill: "admissions:active" },
      { label: "Distinct batches", value: String(batches.length) },
      { label: "Batch-mapped", value: `${mapped}/${active.length}`, hint: `${unmapped} unmapped`, drill: unmapped > 0 ? "admissions:batch:unmapped" : undefined },
      { label: "Pace (14d)", value: `${perDay14.toFixed(1)}/day` },
      ...(next ? [{ label: "Next batch in", value: `${next.daysTo}d`, hint: next.label.split(" · ").pop() }] : []),
    ],
    funnelTitle: "Active enrollments by batch",
    funnel: batches.slice(0, 6).map((b) => ({ label: b.label, value: b.count, sub: `${inr(b.collected)} collected`, drill: b.batchId ? `batch:${b.batchId}` : "admissions:batch:unmapped" })),
    caveats,
  };
}

export type RevenueIntel = AgentIntel & { tower: RevenueTower };

/**
 * Revenue intelligence: 30-day trend, collection rate, overdue aging, at-risk, and a
 * webinar-cohort vs direct split on the SAME deduped rows as the Payments tab.
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
  const spark = dailySeries(deduped.map((p) => ({ date: p.created_at, amount: p.amount })), 14, now);

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
    sparkline: spark,
    sparklineLabel: "Collected · last 14 days",
    metrics: [
      { label: "Collected (30d)", value: inr(last30), hint: `prior 30d ${inr(prev30)}`, drill: "revenue:recentpaid" },
      { label: "Trend", value: `${tr.deltaPct >= 0 ? "+" : ""}${tr.deltaPct}%`, hint: dirWord },
      { label: "Collection rate", value: `${collectionRate}%`, hint: `of ${inr(tower.expected)} expected` },
      { label: "At-risk", value: inr(tower.atRiskRevenue), hint: "overdue + abandoned", drill: "revenue:atrisk" },
      { label: "Abandoned", value: inr(tower.abandoned.amount), hint: `${tower.abandoned.count} checkout(s)`, drill: "revenue:abandoned" },
      { label: "Overdue", value: inr(tower.overdueTotal.amount), hint: `${tower.overdueTotal.count} installment(s)`, drill: "revenue:overdue" },
      { label: "Webinar cohort", value: inr(webinarCohort) },
      { label: "Direct", value: inr(direct) },
    ],
    funnelTitle: "Overdue aging",
    funnel: [
      { label: "Due today", value: tower.dueToday.count, sub: inr(tower.dueToday.amount), drill: "revenue:aging:today" },
      { label: "1–3 days", value: tower.overdue1_3.count, sub: inr(tower.overdue1_3.amount), drill: "revenue:aging:1_3" },
      { label: "4–7 days", value: tower.overdue4_7.count, sub: inr(tower.overdue4_7.amount), drill: "revenue:aging:4_7" },
      { label: "8+ days", value: tower.overdue8plus.count, sub: inr(tower.overdue8plus.amount), drill: "revenue:aging:8plus" },
    ],
    caveats: [
      "Cohort split uses the same deduped PAID rows as the Payments tab; webinar-cohort = paid rows whose phone matches a webinar registrant (last-10-digit key), everything else counts as direct.",
    ],
  };
}
