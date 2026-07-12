import {
  fetchPayments,
  fetchCourseEnrollments,
  fetchWebinarRegistrations,
  fetchWebinars,
  fetchCoursesLite,
  fetchSmsForPhones,
  fetchStudentIdsByPhone,
  fetchStudentsSearch,
} from "@/lib/data";
import { isPaidStatus, dedupePaidRows } from "@portal/lib/paymentsAgg";
import { deriveEnrollment, isActiveEnrollment, isLineOutstanding } from "@portal/lib/installments";
import { getRevenueTowerCached } from "@/lib/revenue/tower";
import { getAttention } from "@/lib/insights/attention";
import { getDrill, summarizeSms, type DrillRow } from "@/lib/insights/drill";
import { normPhone, pct, trend, dailySeries, ratePerDay, etaDays, daysAgo } from "@/lib/insights/calc";
import { inr } from "@/lib/revenue/dailyBrief";
import { maskPhone } from "@/lib/mask";
import { recordLinks, paymentsLink, webinarLink, type PortalLink } from "@/lib/portal/links";
import type { ToolResult, DrillRef } from "./types";
import type { Payment, CourseEnrollment, WebinarRegistration, InstallmentItem } from "@portal/lib/types";

/**
 * The whitelisted, read-only DATA TOOL LAYER — the assistant's only way to touch the DB.
 * Every tool wraps the SAME vetted primitives the portal reconciles on (isPaidStatus /
 * dedupePaidRows / deriveEnrollment / isActiveEnrollment) and returns a uniform ToolResult:
 * the headline figure(s) + the evidence rows behind them + a provenance note. NO tool writes.
 */

const DAY = 86_400_000;

type EnrRow = CourseEnrollment & { batch_id?: string | null };
type RegRow = WebinarRegistration & { matched_enrollment_id?: string | null; match_method?: string | null };

/** Pull the evidence page + total for a drill metric so a tool's numbers link to real records. */
async function evidence(domain: string, metric: string, label: string): Promise<{ rows: DrillRow[]; total: number; drill: DrillRef; note?: string }> {
  const d = await getDrill(domain, metric, "", 1);
  if (!d) return { rows: [], total: 0, drill: { domain, metric, label } };
  return { rows: d.rows, total: d.total, drill: { domain, metric, label }, note: d.note };
}

function windowLabel(period: string): { days: number; word: string; prevWord: string } {
  if (period === "month" || period === "30d") return { days: 30, word: "last 30 days", prevWord: "prior 30 days" };
  if (period === "quarter" || period === "90d") return { days: 90, word: "last 90 days", prevWord: "prior 90 days" };
  return { days: 7, word: "this week", prevWord: "last week" };
}

// ---------------------------------------------------------------------------
// TOOL 1 — Collections summary (period vs previous)
// ---------------------------------------------------------------------------
export async function getCollectionsSummary(period = "week", comparePrevious = true): Promise<ToolResult> {
  const now = Date.now();
  const { days, word, prevWord } = windowLabel(period);
  const [tower, payments] = await Promise.all([getRevenueTowerCached(), fetchPayments()]);
  const deduped = dedupePaidRows(payments.filter((p) => isPaidStatus(p.status)));
  const ts = (iso: string) => Date.parse(iso) || 0;
  const curFrom = now - days * DAY;
  const prevFrom = now - 2 * days * DAY;
  let current = 0;
  let previous = 0;
  for (const p of deduped) {
    const t = ts(p.created_at);
    if (t >= curFrom) current += p.amount;
    else if (t >= prevFrom && t < curFrom) previous += p.amount;
  }
  const tr = trend(current, previous);
  const spark = dailySeries(deduped.map((p) => ({ date: p.created_at, amount: p.amount })), Math.min(days, 30), now);
  const dir = tr.direction === "up" ? "up" : tr.direction === "down" ? "down" : "flat";
  const ev = await evidence("revenue", "recentpaid", "Payments collected (last 30 days)");

  const headline = comparePrevious
    ? `${inr(current)} collected ${word} — ${dir}${tr.direction !== "flat" ? ` ${Math.abs(tr.deltaPct)}%` : ""} vs ${prevWord} (${inr(previous)}).`
    : `${inr(current)} collected ${word}.`;

  const figures = [
    { label: `Collected (${word})`, value: inr(current) },
    ...(comparePrevious ? [{ label: `Collected (${prevWord})`, value: inr(previous) }] : []),
    ...(comparePrevious ? [{ label: "Change", value: `${tr.deltaPct >= 0 ? "+" : ""}${tr.deltaPct}%`, hint: dir }] : []),
    { label: "All-time collected", value: inr(tower.collected), hint: "reconciles to Payments tab" },
    { label: "Collection rate", value: `${pct(tower.collected, tower.expected)}%`, hint: `of ${inr(tower.expected)} expected` },
  ];

  return {
    tool: "getCollectionsSummary",
    ok: true,
    headline,
    figures,
    rows: ev.rows,
    rowsTotal: ev.total,
    drill: ev.drill,
    links: [paymentsLink()],
    provenance: "dedupePaidRows(isPaidStatus) on payments — the SAME rows as the portal Payments tab; windows are rolling from today. All-time total from getRevenueTower.",
    notes: ["Windows are rolling (last N days), not calendar week/month.", ...(spark.length ? [] : [])],
  };
}

// ---------------------------------------------------------------------------
// TOOL 2 — Overdue students (min days overdue)
// ---------------------------------------------------------------------------
export async function getOverdueStudents(minDaysOverdue = 1): Promise<ToolResult> {
  const now = Date.now();
  const min = Math.max(0, Math.floor(minDaysOverdue) || 0);
  const enrollments = await fetchCourseEnrollments();
  let count = 0;
  let amount = 0;
  for (const e of enrollments) {
    if (!isActiveEnrollment(e)) continue;
    const schedule: InstallmentItem[] = Array.isArray(e.schedule) ? e.schedule : [];
    for (const line of schedule) {
      if (!isLineOutstanding(line)) continue;
      const od = line.due ? Math.floor((now - (Date.parse(line.due) || now)) / DAY) : 0;
      if (od >= min && od >= 0) {
        count += 1;
        amount += Math.max(0, (Number(line.amount) || 0) - (Number(line.paid_amount) || 0));
      }
    }
  }
  const metric = min >= 15 ? "overdue15" : "overdue";
  const evLabel = min >= 15 ? "Overdue 15+ days" : "Overdue installments";
  const ev = await evidence("revenue", metric, evLabel);
  const nonStandard = min !== 1 && min !== 15;

  return {
    tool: "getOverdueStudents",
    ok: true,
    headline:
      count === 0
        ? `No installments are overdue by ${min}+ day(s) right now.`
        : `${count} installment line(s) overdue ${min}+ day(s), totalling ${inr(amount)} unpaid.`,
    figures: [
      { label: `Overdue ${min}+ days`, value: String(count), hint: "installment lines" },
      { label: "Amount unpaid", value: inr(amount) },
    ],
    rows: ev.rows,
    rowsTotal: ev.total,
    drill: ev.drill,
    links: [paymentsLink()],
    provenance: "Active enrollments (isActiveEnrollment) → outstanding schedule lines (isLineOutstanding) whose due date is minDaysOverdue+ before today.",
    notes: nonStandard
      ? [`Headline count uses exactly ${min}+ days; the evidence list shows the nearest standard bucket (${evLabel.toLowerCase()}).`]
      : [],
  };
}

// ---------------------------------------------------------------------------
// TOOL 3 — Webinar performance (per-webinar convert/paid, best/worst)
// ---------------------------------------------------------------------------
export async function getWebinarPerformance(): Promise<ToolResult> {
  const [regs, enrollments, webinars] = await Promise.all([
    fetchWebinarRegistrations(),
    fetchCourseEnrollments(),
    fetchWebinars(),
  ]);
  const enrById = new Map(enrollments.map((e) => [e.id, e]));
  const webById = new Map(webinars.map((w) => [w.id, w]));

  type Agg = { title: string; regs: Set<string>; converted: Set<string>; paid: Set<string> };
  const byWeb = new Map<string, Agg>();
  for (const r of regs as RegRow[]) {
    const ph = normPhone(r.phone);
    if (ph.length !== 10) continue;
    const wid = r.webinar_id || "unknown";
    const a = byWeb.get(wid) || { title: webById.get(wid)?.title || "Unknown webinar", regs: new Set(), converted: new Set(), paid: new Set() };
    a.regs.add(ph);
    if (r.match_method === "phone") {
      a.converted.add(ph);
      const e = r.matched_enrollment_id ? enrById.get(r.matched_enrollment_id) : null;
      if (e && deriveEnrollment(e).paid > 0) a.paid.add(ph);
    }
    byWeb.set(wid, a);
  }

  const rowsAgg = [...byWeb.values()]
    .map((a) => ({ title: a.title, registrants: a.regs.size, converted: a.converted.size, paid: a.paid.size, conv: pct(a.converted.size, a.regs.size) }))
    .filter((a) => a.registrants > 0)
    .sort((a, b) => b.conv - a.conv);

  const best = rowsAgg[0];
  const worst = rowsAgg[rowsAgg.length - 1];
  const totalReg = rowsAgg.reduce((s, a) => s + a.registrants, 0);
  const totalConv = rowsAgg.reduce((s, a) => s + a.converted, 0);
  const ev = await evidence("analytics", "webinar:converted", "Converted — phone-confirmed");

  const figures = [
    { label: "Webinars with row-level data", value: String(rowsAgg.length) },
    { label: "Total registrants", value: String(totalReg) },
    { label: "Overall conversion", value: `${pct(totalConv, totalReg)}%`, hint: `${totalConv} converted` },
    ...(best ? [{ label: "Best", value: best.title, hint: `${best.conv}% (${best.converted}/${best.registrants})` }] : []),
    ...(worst && worst !== best ? [{ label: "Worst", value: worst.title, hint: `${worst.conv}% (${worst.converted}/${worst.registrants})` }] : []),
  ];

  return {
    tool: "getWebinarPerformance",
    ok: true,
    headline:
      rowsAgg.length === 0
        ? "No webinars have row-level registration data to measure conversion yet."
        : `${best.title} converted best at ${best.conv}% (${best.converted}/${best.registrants})${worst && worst !== best ? `; ${worst.title} worst at ${worst.conv}%` : ""}. Overall ${pct(totalConv, totalReg)}% of ${totalReg} row-level registrants converted (phone-confirmed).`,
    figures,
    rows: ev.rows,
    rowsTotal: ev.total,
    drill: ev.drill,
    links: [webinarLink()],
    provenance: "webinar_registrations grouped by webinar_id; converted = match_method='phone'; paid = converted with deriveEnrollment().paid>0. Distinct by last-10 phone.",
    notes: ["Only counts webinars that have per-registrant rows. Aggregate-only webinars (manual counts, no rows) are excluded — not faked.", "Name-probable matches are NOT counted as converted."],
  };
}

// ---------------------------------------------------------------------------
// TOOL 4 — Batch fill (seat-fill, pace, projected ESTIMATE, slowest)
// ---------------------------------------------------------------------------
export async function getBatchFill(): Promise<ToolResult> {
  const now = Date.now();
  const [enrollments, courses] = await Promise.all([fetchCourseEnrollments(), fetchCoursesLite()]);
  const active = (enrollments as EnrRow[]).filter(isActiveEnrollment);

  type Row = { course: string; label: string; batchId: string | null; enrolled: number; capacity: number | null; startDate: string | null; daysTo: number | null; perDay: number; etaDays: number | null; pctFill: number | null };
  const rows: Row[] = [];
  for (const c of courses) {
    for (const b of c.batches || []) {
      if (!b.id) continue;
      const enrolled = active.filter((e) => e.batch_id === b.id).length;
      if (enrolled === 0 && !b.start_date) continue;
      const capRaw = b.capacity == null || b.capacity === "" ? (c.capacity ?? null) : Number(b.capacity);
      const capacity = capRaw != null && Number.isFinite(Number(capRaw)) ? Number(capRaw) : null;
      const startMs = b.start_date ? Date.parse(b.start_date) : NaN;
      const last14 = active.filter((e) => e.batch_id === b.id && (Date.parse(e.created_at) || 0) >= daysAgo(now, 14)).length;
      const perDay = ratePerDay(last14, 14);
      rows.push({
        course: c.title || c.slug || c.id,
        label: b.label || b.id,
        batchId: b.id,
        enrolled,
        capacity,
        startDate: b.start_date || null,
        daysTo: Number.isFinite(startMs) ? Math.ceil((startMs - now) / DAY) : null,
        perDay,
        etaDays: capacity ? etaDays(capacity - enrolled, perDay) : null,
        pctFill: capacity ? pct(enrolled, capacity) : null,
      });
    }
  }

  const upcoming = rows.filter((r) => r.daysTo != null && (r.daysTo as number) > 0);
  // "Slowest": lowest fill %, then longest ETA, among upcoming (fallback to all).
  const rank = (upcoming.length ? upcoming : rows).slice().sort((a, b) => {
    const fa = a.pctFill ?? 999;
    const fb = b.pctFill ?? 999;
    if (fa !== fb) return fa - fb;
    return (b.etaDays ?? 0) - (a.etaDays ?? 0);
  });
  const slowest = rank[0];

  const ev = slowest?.batchId
    ? await evidence("admissions", `batch:${slowest.batchId}`, `Batch — ${slowest.label}`)
    : await evidence("admissions", "active", "Active enrollments");

  const figures = rows
    .slice()
    .sort((a, b) => (a.daysTo ?? 1e9) - (b.daysTo ?? 1e9))
    .slice(0, 6)
    .map((r) => ({
      label: `${r.course} · ${r.label}`,
      value: r.capacity ? `${r.enrolled}/${r.capacity} (${r.pctFill}%)` : `${r.enrolled} booked`,
      hint: r.daysTo != null ? `starts in ${r.daysTo}d · ${r.perDay.toFixed(1)}/day${r.etaDays != null ? ` · ~${r.etaDays}d to fill (est)` : ""}` : "no start date set",
    }));

  return {
    tool: "getBatchFill",
    ok: true,
    headline:
      rows.length === 0
        ? "No batches with mapped enrollments or start dates to report on yet."
        : slowest
          ? `Slowest-filling: "${slowest.label}" (${slowest.course}) — ${slowest.capacity ? `${slowest.enrolled}/${slowest.capacity} seats (${slowest.pctFill}%)` : `${slowest.enrolled} booked, capacity not set`}${slowest.daysTo != null ? `, starts in ${slowest.daysTo}d` : ""}${slowest.etaDays != null ? `; ~${slowest.etaDays}d to fill at ${slowest.perDay.toFixed(1)}/day (ESTIMATE)` : ""}.`
          : `${rows.length} batches tracked.`,
    figures,
    rows: ev.rows,
    rowsTotal: ev.total,
    drill: ev.drill,
    links: [],
    provenance: "Active enrollments grouped by batch_id vs courses.batches[] capacity/start_date; pace = enrollments in last 14 days; ETA = (capacity − enrolled) / pace.",
    notes: ["Projected fill / ETA is an ESTIMATE from recent pace.", "Batches without a capacity show booked counts only; batches without a start_date can't show a countdown."],
  };
}

// ---------------------------------------------------------------------------
// TOOL 5 — Enrollments trend (this vs prior period, cohort split)
// ---------------------------------------------------------------------------
export async function getEnrollmentsTrend(period = "month"): Promise<ToolResult> {
  const now = Date.now();
  const { days, word, prevWord } = windowLabel(period === "week" ? "week" : "month");
  const [enrollments, regs] = await Promise.all([fetchCourseEnrollments(), fetchWebinarRegistrations()]);
  const regPhones = new Set<string>();
  for (const r of regs) {
    const ph = normPhone(r.phone);
    if (ph.length === 10) regPhones.add(ph);
  }
  const ts = (e: CourseEnrollment) => Date.parse(e.created_at) || 0;
  const curFrom = now - days * DAY;
  const prevFrom = now - 2 * days * DAY;
  let current = 0;
  let previous = 0;
  let webinarCohort = 0;
  let direct = 0;
  for (const e of enrollments) {
    const t = ts(e);
    if (t >= curFrom) {
      current += 1;
      if (regPhones.has(normPhone(e.phone))) webinarCohort += 1;
      else direct += 1;
    } else if (t >= prevFrom && t < curFrom) {
      previous += 1;
    }
  }
  const tr = trend(current, previous);
  const dir = tr.direction === "up" ? "up" : tr.direction === "down" ? "down" : "flat";
  const ev = await evidence("admissions", "active", "Active enrollments");

  return {
    tool: "getEnrollmentsTrend",
    ok: true,
    headline: `${current} new enrollment(s) ${word} — ${dir}${tr.direction !== "flat" ? ` ${Math.abs(tr.deltaPct)}%` : ""} vs ${prevWord} (${previous}). ${webinarCohort} came from webinar registrants, ${direct} direct.`,
    figures: [
      { label: `New (${word})`, value: String(current) },
      { label: `New (${prevWord})`, value: String(previous) },
      { label: "Change", value: `${tr.deltaPct >= 0 ? "+" : ""}${tr.deltaPct}%`, hint: dir },
      { label: "Webinar cohort", value: String(webinarCohort) },
      { label: "Direct", value: String(direct) },
    ],
    rows: ev.rows,
    rowsTotal: ev.total,
    drill: ev.drill,
    links: [],
    provenance: "course_enrollments counted by created_at window; cohort split = enrollment phone present in webinar_registrations (last-10 key) → webinar, else direct.",
    notes: ["Counts NEW enrollments in each rolling window (not the active-vs-total lifetime figure).", "Windows are rolling, not calendar month."],
  };
}

// ---------------------------------------------------------------------------
// TOOL 6 — Zero-contact enrolled students
// ---------------------------------------------------------------------------
export async function getZeroContactStudents(): Promise<ToolResult> {
  const enrollments = await fetchCourseEnrollments();
  const active = enrollments.filter((e) => isActiveEnrollment(e));
  const ev = await evidence("admissions", "nosms", "Active enrollments with zero SMS contact");
  return {
    tool: "getZeroContactStudents",
    ok: true,
    headline:
      ev.total === 0
        ? "Every active enrolled student has at least one SMS on record."
        : `${ev.total} of ${active.length} active enrolled student(s) have never received an SMS.`,
    figures: [
      { label: "Never contacted", value: String(ev.total) },
      { label: "Active enrollments", value: String(active.length) },
      { label: "Share", value: `${pct(ev.total, active.length)}%` },
    ],
    rows: ev.rows,
    rowsTotal: ev.total,
    drill: ev.drill,
    links: [],
    provenance: "Active enrollments (isActiveEnrollment) whose normalized phone has 0 rows in sms_logs.",
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// TOOL 7 — Attention items (ranked flags)
// ---------------------------------------------------------------------------
export async function getAttentionItems(): Promise<ToolResult> {
  const { flags } = await getAttention();
  const top = flags[0];
  const links: PortalLink[] = [];
  for (const f of flags) for (const l of f.links) if (!links.find((x) => x.href === l.href)) links.push(l);

  let ev: { rows: DrillRow[]; total: number; drill: DrillRef | null } = { rows: [], total: 0, drill: null };
  if (top?.drill) {
    // Attention flags author the drill metric WITH the domain prefix (e.g. "revenue:overdue15");
    // getDrill keys are domain + unprefixed metric, so strip the leading "<domain>:".
    const metric = top.drill.startsWith(`${top.domain}:`) ? top.drill.slice(top.domain.length + 1) : top.drill;
    const e = await evidence(top.domain, metric, top.title);
    ev = { rows: e.rows, total: e.total, drill: e.drill };
  }

  return {
    tool: "getAttentionItems",
    ok: true,
    headline:
      !top || top.id === "all-clear"
        ? "Nothing urgent right now — no deep-overdue installments, access anomalies, or collapse in collections."
        : `Top priority: ${top.title}. ${top.why}`,
    figures: flags.filter((f) => f.id !== "all-clear").map((f) => ({ label: f.title, value: f.severity.toUpperCase(), hint: f.calc })),
    rows: ev.rows,
    rowsTotal: ev.total,
    drill: ev.drill,
    links,
    provenance: "getAttention() — ranked flags from the same reconciliation truth (overdue 15+/8+, paid-without-enrollment, collections trend, abandoned, zero-SMS, proof backlog).",
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// TOOL 8 — Student 360 (one student's stitched timeline)
// ---------------------------------------------------------------------------
export async function getStudent360(query: string): Promise<ToolResult> {
  const q = String(query || "").trim();
  const prov = "students (search) → payments/course_enrollments/webinar_registrations/sms_logs joined by last-10 phone; amounts via deriveEnrollment + dedupePaidRows.";
  const base: Omit<ToolResult, "headline" | "figures" | "rows" | "rowsTotal" | "drill" | "links" | "notes" | "provenance"> = { tool: "getStudent360", ok: true };
  if (q.length < 2) {
    return { ...base, ok: false, headline: "Give me a student name or phone (last 4+ digits) to look up.", figures: [], rows: [], rowsTotal: 0, drill: null, links: [], notes: [], provenance: prov };
  }

  const [candidates, payments, enrollments, regs, webinars] = await Promise.all([
    fetchStudentsSearch(q, 8),
    fetchPayments(),
    fetchCourseEnrollments(),
    fetchWebinarRegistrations(),
    fetchWebinars(),
  ]);

  if (candidates.length === 0) {
    return { ...base, headline: `No student found matching "${q}".`, figures: [], rows: [], rowsTotal: 0, drill: null, links: [], notes: ["Search matches students.name (substring) or students.phone (last digits)."], provenance: prov };
  }
  if (candidates.length > 1) {
    return {
      ...base,
      headline: `${candidates.length} students match "${q}" — narrow it down (add a surname or the last 4 phone digits):`,
      figures: candidates.slice(0, 8).map((c) => ({ label: c.name || "—", value: maskPhone(c.phone) })),
      rows: [],
      rowsTotal: candidates.length,
      drill: null,
      links: [],
      notes: [],
      provenance: prov,
    };
  }

  const s = candidates[0];
  const ph = normPhone(s.phone);
  const webById = new Map(webinars.map((w) => [w.id, w]));
  const [smsRows, studentIds] = await Promise.all([fetchSmsForPhones([ph]), fetchStudentIdsByPhone([ph])]);
  const sms = summarizeSms(smsRows.filter((l) => normPhone(l.normalized_mobile || l.mobile) === ph));

  const myEnr = (enrollments as EnrRow[]).filter((e) => normPhone(e.phone) === ph);
  const der = myEnr.map((e) => deriveEnrollment(e));
  const paidTotal = der.reduce((a, d) => a + d.paid, 0);
  const outstanding = der.reduce((a, d) => a + d.remaining, 0);
  const activeEnr = myEnr.find((e) => isActiveEnrollment(e)) || myEnr[0] || null;
  const myReg = (regs as RegRow[]).filter((r) => normPhone(r.phone) === ph).sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0))[0];
  const w = myReg?.webinar_id ? webById.get(myReg.webinar_id) : null;

  const paidRows = dedupePaidRows(payments.filter((p) => isPaidStatus(p.status) && normPhone(p.phone) === ph));
  const firstPaid = paidRows.map((p) => Date.parse(p.created_at) || 0).filter(Boolean).sort((a, b) => a - b)[0] || null;

  const timeline: { label: string; date: string | null; done: boolean }[] = [];
  if (myReg) timeline.push({ label: "Registered", date: myReg.created_at, done: true });
  if (myReg && myReg.attended != null) timeline.push({ label: myReg.attended ? "Attended" : "No-show", date: w?.datetime || null, done: !!myReg.attended });
  if (activeEnr) timeline.push({ label: "Enrolled", date: activeEnr.created_at, done: true });
  if (paidTotal > 0) timeline.push({ label: "Paid", date: firstPaid ? new Date(firstPaid).toISOString() : null, done: true });

  const row: DrillRow = {
    id: ph || s.id,
    name: s.name || "—",
    phoneMasked: maskPhone(s.phone),
    webinar: w ? { title: w.title, date: w.datetime, attended: myReg?.attended ?? null } : null,
    batch: activeEnr ? { id: activeEnr.batch_id ?? null, label: activeEnr.batch_label ?? null } : null,
    enrollment: activeEnr ? { status: String(activeEnr.status), amountPaid: paidTotal, outstanding } : null,
    amount: null,
    amountLabel: null,
    reminderSent: null,
    matchConfidence: null,
    sms,
    timeline,
    links: recordLinks({ studentId: studentIds.get(ph) || s.id, webinarId: myReg?.webinar_id || null, courseId: activeEnr?.course_id || null, showPayments: true }),
  };

  return {
    ...base,
    headline: `${s.name || "This student"} — ${activeEnr ? `${String(activeEnr.status)} enrollment` : "no active enrollment"}, ${inr(paidTotal)} paid${outstanding > 0 ? `, ${inr(outstanding)} outstanding` : ""}${myReg ? `; registered for ${w?.title || "a webinar"}` : ""}. ${sms.count > 0 ? `${sms.count} SMS on record (last "${sms.lastType}").` : "No SMS on record."}`,
    figures: [
      { label: "Paid", value: inr(paidTotal) },
      { label: "Outstanding", value: inr(outstanding) },
      { label: "Enrollment", value: activeEnr ? String(activeEnr.status) : "none" },
      { label: "SMS on record", value: String(sms.count) },
    ],
    rows: [row],
    rowsTotal: 1,
    drill: null,
    links: row.links,
    provenance: "students (search) → payments/course_enrollments/webinar_registrations/sms_logs joined by last-10 phone; amounts via deriveEnrollment + dedupePaidRows.",
    notes: [],
  };
}

// ---------------------------------------------------------------------------
// TOOL 9 — Revenue aging (buckets + record lists)
// ---------------------------------------------------------------------------
export async function getRevenueAging(): Promise<ToolResult> {
  const tower = await getRevenueTowerCached();
  const ev = await evidence("revenue", "overdue", "Overdue installments");
  const b = (x: { count: number; amount: number }) => `${x.count} · ${inr(x.amount)}`;
  return {
    tool: "getRevenueAging",
    ok: true,
    headline: `${tower.overdueTotal.count} overdue installment line(s) worth ${inr(tower.overdueTotal.amount)}; plus ${tower.abandoned.count} abandoned checkout(s) worth ${inr(tower.abandoned.amount)}. ${inr(tower.atRiskRevenue)} at risk in total.`,
    figures: [
      { label: "Due today", value: b(tower.dueToday) },
      { label: "Overdue 1–3d", value: b(tower.overdue1_3) },
      { label: "Overdue 4–7d", value: b(tower.overdue4_7) },
      { label: "Overdue 8+d", value: b(tower.overdue8plus) },
      { label: "Abandoned", value: b(tower.abandoned) },
      { label: "At-risk total", value: inr(tower.atRiskRevenue) },
    ],
    rows: ev.rows,
    rowsTotal: ev.total,
    drill: ev.drill,
    links: [paymentsLink()],
    provenance: "getRevenueTower aging buckets from active-enrollment schedules (isLineOutstanding + days overdue) + ABANDONED payments. Reconciles to Payments tab.",
    notes: [],
  };
}
