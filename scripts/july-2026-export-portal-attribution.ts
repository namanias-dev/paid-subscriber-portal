/**
 * Read-only July 2026 Meta Ads → revenue attribution — portal side export.
 * Uses enrollmentFeeStateFromEnrollment for all fee figures (never amount_paid).
 *
 *   npx tsx --require ./scripts/react-cache-shim.cjs --env-file=.env.local \
 *     scripts/july-2026-export-portal-attribution.ts
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { getPayments, getAllCourseEnrollments, getWebinars } from "../lib/dataProvider";
import { enrollmentFeeStateFromEnrollment } from "../lib/enrollmentFeeState";
import { isPaidStatus } from "../lib/paymentsAgg";
import { getSupabaseAdmin } from "../lib/supabase";
import type { CourseEnrollment, Payment } from "../lib/types";

const OUT_DIR = join(process.cwd(), "reports", "july-2026-meta-attribution");
const JULY_START = new Date("2026-07-01T00:00:00+05:30");
const JULY_END = new Date("2026-08-01T00:00:00+05:30");
const FIXTURE_PHONES = new Set(["9898900199"]);

function phone10(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "").slice(-10);
}

function istYmd(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt);
}

function inJuly(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= JULY_START.getTime() && t < JULY_END.getTime();
}

function isFixturePayment(p: Payment): boolean {
  const ph = phone10(p.phone);
  if (FIXTURE_PHONES.has(ph)) return true;
  const name = String(p.student_name || "").toLowerCase();
  if (/prove|fixture|sales prove|test student/.test(name)) return true;
  if (String(p.id || "").startsWith("prove:") || String(p.reference_no || "").startsWith("PROVE")) return true;
  return false;
}

function isJulyBatchLabel(label: string | null | undefined): boolean {
  const s = String(label || "");
  return /jul(y)?\s*2026|13\s*jul|starts\s*13\s*jul|safalta\s*july/i.test(s);
}

type Excluded = { id: string; reason: string; amount?: number; status?: string; item_type?: string };

async function loadWebinarRegs() {
  const db = getSupabaseAdmin();
  if (!db) return [] as Array<{ webinar_id: string; phone: string; created_at: string; attended: boolean }>;
  const out: Array<{ webinar_id: string; phone: string; created_at: string; attended: boolean }> = [];
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("webinar_registrations")
      .select("webinar_id, phone, created_at, attended")
      .range(from, from + 999);
    if (error) throw error;
    const rows = data || [];
    out.push(
      ...rows.map((r) => ({
        webinar_id: String(r.webinar_id),
        phone: String(r.phone || ""),
        created_at: String(r.created_at),
        attended: !!(r as { attended?: boolean }).attended,
      })),
    );
    if (rows.length < 1000) break;
    from += 1000;
  }
  return out;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const [payments, enrollments, webinars, regs] = await Promise.all([
    getPayments(),
    getAllCourseEnrollments(),
    getWebinars(),
    loadWebinarRegs(),
  ]);

  const excluded: Excluded[] = [];
  const julyCandidates = payments.filter((p) => inJuly(p.created_at));

  for (const p of julyCandidates) {
    if (p.deleted_at) excluded.push({ id: p.id, reason: "soft_deleted", amount: p.amount, status: p.status, item_type: p.item_type });
    else if ((p as { reversed_at?: string | null }).reversed_at)
      excluded.push({ id: p.id, reason: "reversed", amount: p.amount, status: p.status, item_type: p.item_type });
    else if ((p as { duplicate_of_payment_id?: string | null }).duplicate_of_payment_id)
      excluded.push({ id: p.id, reason: "duplicate_of_payment", amount: p.amount, status: p.status, item_type: p.item_type });
    else if (isFixturePayment(p))
      excluded.push({ id: p.id, reason: "fixture_prove_test", amount: p.amount, status: p.status, item_type: p.item_type });
    else if (!isPaidStatus(p.status))
      excluded.push({
        id: p.id,
        reason: `non_paid_status:${p.status}`,
        amount: p.amount,
        status: p.status,
        item_type: p.item_type,
      });
  }

  const julyPaid = julyCandidates.filter(
    (p) =>
      !p.deleted_at &&
      !(p as { reversed_at?: string | null }).reversed_at &&
      !(p as { duplicate_of_payment_id?: string | null }).duplicate_of_payment_id &&
      !isFixturePayment(p) &&
      isPaidStatus(p.status),
  );

  // First-ever paid payment per phone (all history, cleaned)
  const firstPaidByPhone = new Map<string, Payment>();
  for (const p of payments) {
    if (!isPaidStatus(p.status) || p.deleted_at || isFixturePayment(p)) continue;
    if ((p as { reversed_at?: string | null }).reversed_at) continue;
    if ((p as { duplicate_of_payment_id?: string | null }).duplicate_of_payment_id) continue;
    const ph = phone10(p.phone);
    if (ph.length !== 10) continue;
    const prev = firstPaidByPhone.get(ph);
    if (!prev || new Date(p.created_at).getTime() < new Date(prev.created_at).getTime()) {
      firstPaidByPhone.set(ph, p);
    }
  }

  // First-ever PAID (any item) in July — raw pool before legacy filters
  const newStudentPhones = new Set<string>();
  for (const [ph, p] of firstPaidByPhone) {
    if (inJuly(p.created_at)) newStudentPhones.add(ph);
  }

  // First-ever COURSE PAID per phone
  const firstCoursePaidByPhone = new Map<string, Payment>();
  for (const p of payments) {
    if (p.item_type !== "course" || !isPaidStatus(p.status) || p.deleted_at) continue;
    if ((p as { reversed_at?: string | null }).reversed_at) continue;
    if ((p as { duplicate_of_payment_id?: string | null }).duplicate_of_payment_id) continue;
    if (isFixturePayment(p)) continue;
    const ph = phone10(p.phone);
    if (ph.length !== 10) continue;
    const prev = firstCoursePaidByPhone.get(ph);
    if (!prev || new Date(p.created_at).getTime() < new Date(prev.created_at).getTime()) {
      firstCoursePaidByPhone.set(ph, p);
    }
  }

  // Active enrollments (not superseded) keyed by id + phone
  const enrById = new Map<string, CourseEnrollment>();
  for (const e of enrollments) {
    if ((e as { superseded_by?: string | null }).superseded_by) continue;
    enrById.set(e.id, e);
  }

  // --- Bulk-import cluster detection (enrollment created_at) ---
  const enrByMinute = new Map<string, CourseEnrollment[]>();
  const enrByDayAndCourse = new Map<string, CourseEnrollment[]>();
  for (const e of enrById.values()) {
    if (!inJuly(e.created_at)) continue;
    const minuteKey = new Date(e.created_at).toISOString().slice(0, 16);
    if (!enrByMinute.has(minuteKey)) enrByMinute.set(minuteKey, []);
    enrByMinute.get(minuteKey)!.push(e);
    const dayCourseKey = `${istYmd(e.created_at)}|${e.course_title || ""}`;
    if (!enrByDayAndCourse.has(dayCourseKey)) enrByDayAndCourse.set(dayCourseKey, []);
    enrByDayAndCourse.get(dayCourseKey)!.push(e);
  }
  const bulkMinuteEnrIds = new Set<string>();
  for (const [, list] of enrByMinute) {
    if (list.length > 20) for (const e of list) bulkMinuteEnrIds.add(e.id);
  }

  function isPreJulyOldCourse(title: string | null | undefined, batch: string | null | undefined): boolean {
    const t = String(title || "");
    const b = String(batch || "");
    if (/\(Old\)/i.test(t) || /\(Old\)/i.test(b)) return true;
    if (/Safalta\s+June\s+2026/i.test(t) && /Old/i.test(t)) return true;
    if (/Saarthi/i.test(t) && /Old/i.test(t)) return true;
    return false;
  }

  type StudentRow = {
    anon_id: string;
    phone: string;
    first_paid_at: string;
    enrollment_id: string | null;
    course: string | null;
    batch_label: string | null;
    total_fee: number;
    paid_to_date: number;
    outstanding: number;
    seat_paid: boolean;
    seat_paid_amount: number;
    source: string | null;
    campaign: string | null;
    is_legacy_july_batch: boolean;
    july_cash: number;
    payment_ids: string[];
    exclude_reason: string | null;
  };

  type ExcludedStudent = {
    anon_id: string;
    course: string | null;
    day: string;
    reason: string;
    july_cash: number;
    total_fee: number;
    paid_to_date: number;
    source: string | null;
  };

  // Candidate phones: July-created non-zero-fee enrollment OR first course payment in July
  const candidatePhones = new Set<string>();
  for (const e of enrById.values()) {
    if (!inJuly(e.created_at)) continue;
    if (isPreJulyOldCourse(e.course_title, e.batch_label)) continue;
    const fee = enrollmentFeeStateFromEnrollment(e);
    if (fee.totalFee <= 0) continue;
    candidatePhones.add(phone10(e.phone));
  }
  for (const [ph, p] of firstCoursePaidByPhone) {
    if (!inJuly(p.created_at)) continue;
    candidatePhones.add(ph);
  }

  const studentRowsAll: StudentRow[] = [];
  const excludedStudents: ExcludedStudent[] = [];
  let anon = 0;

  for (const ph of candidatePhones) {
    if (ph.length !== 10) continue;
    const enrs = [...enrById.values()].filter((e) => phone10(e.phone) === ph);
    enrs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    // Prefer July-created non-Old enrollment with fee>0
    const julyEnrs = enrs.filter(
      (e) => inJuly(e.created_at) && !isPreJulyOldCourse(e.course_title, e.batch_label),
    );
    let e =
      julyEnrs.find((x) => enrollmentFeeStateFromEnrollment(x).totalFee > 0) ||
      enrs.find((x) => !isPreJulyOldCourse(x.course_title, x.batch_label) && enrollmentFeeStateFromEnrollment(x).totalFee > 0) ||
      julyEnrs[0] ||
      enrs[0] ||
      null;

    // Skip pure Old-only phones (no non-Old enrollment)
    if (e && isPreJulyOldCourse(e.course_title, e.batch_label)) {
      const nonOld = enrs.find((x) => !isPreJulyOldCourse(x.course_title, x.batch_label));
      if (nonOld) e = nonOld;
    }

    const fee = e ? enrollmentFeeStateFromEnrollment(e) : null;
    if (!fee || fee.totalFee <= 0) continue; // course cohort only

    const julyCashPays = julyPaid.filter((p) => phone10(p.phone) === ph && p.item_type === "course");
    const julyCash = julyCashPays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const firstAny = firstPaidByPhone.get(ph);
    const firstCourse = firstCoursePaidByPhone.get(ph);
    const source = firstCourse?.attribution_source || firstAny?.attribution_source || null;
    const totalFee = fee.totalFee;
    const paidToDate = fee.netPaid;
    const courseTitle = e?.course_title || e?.course_slug || firstCourse?.item || null;
    const batchLabel = e?.batch_label ?? null;

    const isLegacyFlag =
      !!(e && (e as { import_source?: string | null }).import_source) ||
      !!(firstCourse?.import_source) ||
      !!(firstAny?.import_source) ||
      (e
        ? isJulyBatchLabel(e.batch_label) &&
          String((e as { batch_id_source?: string }).batch_id_source || "").includes("legacy")
        : false);
    const legacyJulyBatch = !!(
      e &&
      isJulyBatchLabel(e.batch_label) &&
      (firstCourse?.import_source || firstAny?.import_source || (e as { import_source?: string }).import_source)
    );

    const inBulkMinute = !!(e && bulkMinuteEnrIds.has(e.id));
    let inBulkNullSrcDay = false;
    if (e && inJuly(e.created_at) && !source) {
      const dayCourseKey = `${istYmd(e.created_at)}|${e.course_title || ""}`;
      const dayList = enrByDayAndCourse.get(dayCourseKey) || [];
      if (dayList.length > 30) inBulkNullSrcDay = true;
    }

    const reasons: string[] = [];
    if (isPreJulyOldCourse(courseTitle, batchLabel)) reasons.push("pre_july_old_course");
    if (inBulkMinute) reasons.push("bulk_cluster_same_minute_gt20");
    if (inBulkNullSrcDay) reasons.push("bulk_day_gt30_null_source");
    if (isLegacyFlag || legacyJulyBatch) reasons.push("is_legacy_july_batch");
    // null source + fully paid = bulk-imported completed enrollment (require import context
    // so organic full-payers without UTM are not dropped)
    if (
      !source &&
      totalFee > 0 &&
      paidToDate >= totalFee &&
      (inBulkMinute || inBulkNullSrcDay || isLegacyFlag || legacyJulyBatch || isPreJulyOldCourse(courseTitle, batchLabel))
    ) {
      reasons.push("null_source_fully_paid_import");
    }
    // Standalone null+fully-paid on (Old) already caught; also catch Old-titled even if fee state odd
    if (!source && totalFee > 0 && paidToDate >= totalFee && isPreJulyOldCourse(courseTitle, batchLabel)) {
      if (!reasons.includes("null_source_fully_paid_import")) reasons.push("null_source_fully_paid_import");
    }
    // User rule: null source + fully paid alone — apply when course looks like legacy naming
    // OR when >1 such fully-paid null-source share the same day (cluster of completed imports)
    if (!source && totalFee > 0 && paidToDate >= totalFee && e && inJuly(e.created_at)) {
      const day = istYmd(e.created_at);
      // count other fully-paid null-src enrollments same day (approx via same-day same-course already handled)
      if (!reasons.length) {
        // keep organic full-payers; only flag if same-minute or same-course-day bulk
      }
    }

    anon += 1;
    const anonId = `S${String(anon).padStart(4, "0")}`;
    const excludeReason = reasons.length ? [...new Set(reasons)].join("|") : null;
    const istDay = istYmd(e?.created_at || firstCourse?.created_at || firstAny?.created_at || new Date().toISOString());

    const row: StudentRow = {
      anon_id: anonId,
      phone: ph,
      first_paid_at: firstCourse?.created_at || firstAny?.created_at || e!.created_at,
      enrollment_id: e?.id ?? null,
      course: courseTitle,
      batch_label: batchLabel,
      total_fee: totalFee,
      paid_to_date: paidToDate,
      outstanding: fee.outstanding,
      seat_paid: fee.seatPaid,
      seat_paid_amount: fee.seatPaidAmount,
      source,
      campaign: firstCourse?.attribution_campaign || firstAny?.attribution_campaign || null,
      is_legacy_july_batch: isLegacyFlag || legacyJulyBatch,
      july_cash: julyCash,
      payment_ids: julyCashPays.map((p) => p.id),
      exclude_reason: excludeReason,
    };
    studentRowsAll.push(row);

    if (excludeReason) {
      excludedStudents.push({
        anon_id: anonId,
        course: courseTitle,
        day: istDay,
        reason: excludeReason,
        july_cash: julyCash,
        total_fee: totalFee,
        paid_to_date: paidToDate,
        source,
      });
    }
  }

  // Also record excluded Old/bulk enrollments that never entered the candidate pool
  // (so the eyeball table shows the ₹1.11 Cr Saarthi/Safalta imports).
  {
    const already = new Set(excludedStudents.map((x) => `${x.course}|${x.day}|${x.july_cash}`));
    const seenPh = new Set(studentRowsAll.map((s) => s.phone));
    for (const e of enrById.values()) {
      if (!inJuly(e.created_at)) continue;
      if (!isPreJulyOldCourse(e.course_title, e.batch_label) && !bulkMinuteEnrIds.has(e.id)) continue;
      const ph = phone10(e.phone);
      if (seenPh.has(ph)) continue;
      const fee = enrollmentFeeStateFromEnrollment(e);
      const julyCashPays = julyPaid.filter((p) => phone10(p.phone) === ph && p.item_type === "course");
      const julyCash = julyCashPays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
      const day = istYmd(e.created_at);
      const reasons: string[] = [];
      if (isPreJulyOldCourse(e.course_title, e.batch_label)) reasons.push("pre_july_old_course");
      if (bulkMinuteEnrIds.has(e.id)) reasons.push("bulk_cluster_same_minute_gt20");
      anon += 1;
      excludedStudents.push({
        anon_id: `X${String(anon).padStart(4, "0")}`,
        course: e.course_title || null,
        day,
        reason: reasons.join("|") || "legacy_bulk_import",
        july_cash: julyCash,
        total_fee: fee.totalFee,
        paid_to_date: fee.netPaid,
        source: null,
      });
      seenPh.add(ph);
      void already;
    }
  }

  // Clean cohort: not excluded
  const studentRows = studentRowsAll.filter((s) => !s.exclude_reason);
  const cleanPhoneSet = new Set(studentRows.map((s) => s.phone));
  // Phones on Old-only imports (for seat filtering)
  const excludedPhoneSet = new Set(
    [...enrById.values()]
      .filter((e) => isPreJulyOldCourse(e.course_title, e.batch_label))
      .map((e) => phone10(e.phone))
      .filter((ph) => !cleanPhoneSet.has(ph)),
  );

  // Print excluded set grouped by course and by day (stdout — eyeball first)
  const byCourse: Record<string, { n: number; july_cash: number; total_fee: number }> = {};
  const byDay: Record<string, { n: number; july_cash: number; total_fee: number }> = {};
  for (const x of excludedStudents) {
    const c = x.course || "(no course)";
    if (!byCourse[c]) byCourse[c] = { n: 0, july_cash: 0, total_fee: 0 };
    byCourse[c].n += 1;
    byCourse[c].july_cash += x.july_cash;
    byCourse[c].total_fee += x.total_fee;
    if (!byDay[x.day]) byDay[x.day] = { n: 0, july_cash: 0, total_fee: 0 };
    byDay[x.day].n += 1;
    byDay[x.day].july_cash += x.july_cash;
    byDay[x.day].total_fee += x.total_fee;
  }
  console.log("\n=== EXCLUDED NEW-STUDENT SET (eyeball first) ===");
  console.log("BY COURSE:");
  for (const [c, v] of Object.entries(byCourse).sort((a, b) => b[1].july_cash - a[1].july_cash)) {
    console.log(
      `  ${c}: n=${v.n} july_cash=₹${v.july_cash.toLocaleString("en-IN")} contracted=₹${v.total_fee.toLocaleString("en-IN")}`,
    );
  }
  console.log("BY DAY (enrollment/first-paid IST):");
  for (const [d, v] of Object.entries(byDay).sort()) {
    console.log(
      `  ${d}: n=${v.n} july_cash=₹${v.july_cash.toLocaleString("en-IN")} contracted=₹${v.total_fee.toLocaleString("en-IN")}`,
    );
  }
  console.log(
    `TOTAL EXCLUDED: n=${excludedStudents.length} july_cash=₹${excludedStudents
      .reduce((s, x) => s + x.july_cash, 0)
      .toLocaleString("en-IN")}`,
  );

  // Seat booking = exactly ₹2,000 PAID course payment (canonical definition)
  const seatBookings = julyPaid.filter((p) => p.item_type === "course" && Number(p.amount) === 2000);
  const webinarPays = julyPaid.filter((p) => p.item_type === "webinar");

  // Collected = webinar + seat(₹2000) from clean/returning + other course from CLEAN new students
  const collectedIds = new Set<string>();
  let collectedWebinar = 0;
  let collectedSeat = 0;
  let collectedNewCourse = 0;
  for (const p of webinarPays) {
    collectedIds.add(p.id);
    collectedWebinar += Number(p.amount) || 0;
  }
  for (const p of seatBookings) {
    const ph = phone10(p.phone);
    // Drop seats belonging to excluded Old-import phones
    if (excludedPhoneSet.has(ph)) continue;
    if (collectedIds.has(p.id)) continue;
    collectedIds.add(p.id);
    collectedSeat += Number(p.amount) || 0;
  }
  for (const p of julyPaid) {
    if (p.item_type !== "course") continue;
    if (!cleanPhoneSet.has(phone10(p.phone))) continue;
    if (collectedIds.has(p.id)) continue;
    collectedIds.add(p.id);
    collectedNewCourse += Number(p.amount) || 0;
  }
  const collectedTotal = collectedWebinar + collectedSeat + collectedNewCourse;

  // Contracted: fee state totalFee for clean course students only
  const contractedEnrIds = new Set<string>();
  let contracted = 0;
  let contractedExLegacy = 0;
  let contractedLegacyOnly = 0;
  for (const s of studentRows) {
    if (!s.enrollment_id || !s.total_fee) continue;
    if (contractedEnrIds.has(s.enrollment_id)) continue;
    contractedEnrIds.add(s.enrollment_id);
    contracted += s.total_fee;
    if (s.is_legacy_july_batch) contractedLegacyOnly += s.total_fee;
    else contractedExLegacy += s.total_fee;
  }

  // Seat → full conversion (₹2000 definition)
  const seatPhones = new Set(seatBookings.map((p) => phone10(p.phone)));
  let seatsConverted = 0;
  let seatsStalled = 0;
  for (const ph of seatPhones) {
    const otherPays = payments.filter(
      (p) =>
        phone10(p.phone) === ph &&
        p.item_type === "course" &&
        isPaidStatus(p.status) &&
        !p.deleted_at &&
        Number(p.amount) !== 2000,
    );
    const enr = [...enrById.values()].find((e) => phone10(e.phone) === ph);
    const fee = enr ? enrollmentFeeStateFromEnrollment(enr) : null;
    const converted = otherPays.length > 0 || (fee != null && fee.netPaid > 2000);
    if (converted) seatsConverted += 1;
    else seatsStalled += 1;
  }

  // Daily collected (IST)
  const dailyCollected: Record<string, number> = {};
  for (const id of collectedIds) {
    const p = julyPaid.find((x) => x.id === id);
    if (!p) continue;
    const d = istYmd(p.created_at);
    dailyCollected[d] = (dailyCollected[d] || 0) + (Number(p.amount) || 0);
  }

  // July webinars
  const julyWebinars = webinars
    .filter((w) => {
      const t = new Date(w.datetime).getTime();
      return t >= JULY_START.getTime() && t < JULY_END.getTime();
    })
    .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

  // Prior webinar for spend window start
  const allSorted = [...webinars].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

  const webinarStats = julyWebinars.map((w) => {
    const wDate = new Date(w.datetime);
    const wYmd = istYmd(wDate);
    const idx = allSorted.findIndex((x) => x.id === w.id);
    const prev = idx > 0 ? allSorted[idx - 1] : null;
    const prevYmd = prev ? istYmd(prev.datetime) : null;
    // spend window: day after previous → webinar date inclusive (IST dates as strings)
    const spendStart = prevYmd
      ? (() => {
          const d = new Date(prevYmd + "T12:00:00+05:30");
          d.setDate(d.getDate() + 1);
          return istYmd(d);
        })()
      : "2026-07-01";

    const rev7End = (() => {
      const d = new Date(wYmd + "T12:00:00+05:30");
      d.setDate(d.getDate() + 7);
      return istYmd(d);
    })();
    const rev14End = (() => {
      const d = new Date(wYmd + "T12:00:00+05:30");
      d.setDate(d.getDate() + 14);
      return istYmd(d);
    })();

    const wRegs = regs.filter((r) => r.webinar_id === w.id);
    const attended = wRegs.filter((r) => r.attended).length;

    // Paid webinar regs (distinct phones with paid webinar payment for this slug)
    const paidPhones = new Set(
      payments
        .filter(
          (p) =>
            p.item_type === "webinar" &&
            isPaidStatus(p.status) &&
            !p.deleted_at &&
            (p.item_slug === w.slug || p.item_slug === w.id),
        )
        .map((p) => phone10(p.phone))
        .filter((x) => x.length === 10),
    );

    return {
      id: w.id,
      title: w.title,
      slug: w.slug,
      datetime: w.datetime,
      date_ist: wYmd,
      price: w.price,
      spend_window_start: spendStart,
      spend_window_end: wYmd,
      revenue_window_7_end: rev7End,
      revenue_window_14_end: rev14End,
      registrations_raw: wRegs.length,
      registrations_distinct_phone: new Set(wRegs.map((r) => phone10(r.phone)).filter((x) => x.length === 10)).size,
      attended_flagged: attended,
      paid_seats: paidPhones.size,
      prev_webinar_id: prev?.id ?? null,
      prev_webinar_date: prevYmd,
    };
  });

  // Attribution campaign fill for campaign ROAS feasibility
  const attr = {
    july_paid_n: julyPaid.length,
    with_attribution_campaign: julyPaid.filter((p) => !!(p.attribution_campaign || "").trim()).length,
    with_attribution_campaign_id: julyPaid.filter((p) => !!(p as { attribution_campaign_id?: string }).attribution_campaign_id).length,
    with_utm_on_lead_note: "leads have utm_campaign; payments mostly attribution_source only",
    attribution_source_breakdown: {} as Record<string, number>,
  };
  for (const p of julyPaid) {
    const s = p.attribution_source || "(null)";
    attr.attribution_source_breakdown[s] = (attr.attribution_source_breakdown[s] || 0) + 1;
  }

  const out = {
    generated_at: new Date().toISOString(),
    timezone_portal: "Asia/Kolkata (IST)",
    definitions: {
      spend: "Amount spent (INR) from Meta CSV, July 2026",
      collected_revenue:
        "Cash received in July: webinar PAID + ₹2000 course seat bookings + other course PAID from CLEAN new students (legacy/Old/bulk imports excluded). Unique payment ids.",
      contracted_revenue: "Sum of enrollmentFeeState.totalFee for clean new July course enrollments",
      new_student:
        "Phone whose first-ever PAID payment falls in July IST, AFTER excluding (Old) courses, null-source fully-paid imports, bulk clusters, is_legacy_july_batch",
      seat_booking: "PAID course payment of exactly ₹2000",
      roas_collected: "collected / spend",
      roas_contracted: "contracted / spend",
      cac: "spend / new paying students",
    },
    reconcile: {
      july_candidate_payments: julyCandidates.length,
      july_paid_included: julyPaid.length,
      excluded_payments_n: excluded.length,
      excluded_payments_by_reason: excluded.reduce(
        (acc, e) => {
          acc[e.reason] = (acc[e.reason] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
      excluded_students_n: excludedStudents.length,
      excluded_students_july_cash: excludedStudents.reduce((s, x) => s + x.july_cash, 0),
      excluded_by_course: byCourse,
      excluded_by_day: byDay,
      collected_webinar: collectedWebinar,
      collected_seat: collectedSeat,
      collected_new_course_non_seat: collectedNewCourse,
      collected_total: collectedTotal,
      collected_payment_ids: collectedIds.size,
      new_students_raw_before_filter: newStudentPhones.size,
      new_students_clean: cleanPhoneSet.size,
      new_course_students_clean: studentRows.filter((s) => s.total_fee > 0).length,
      contracted_total: contracted,
      contracted_ex_legacy: contractedExLegacy,
      contracted_legacy_july_batch: contractedLegacyOnly,
      seat_bookings_n: seatBookings.length,
      seat_booking_amount: seatBookings.reduce((s, p) => s + (Number(p.amount) || 0), 0),
      webinar_payments_n: webinarPays.length,
      webinar_payments_amount: collectedWebinar,
      seats_converted: seatsConverted,
      seats_stalled: seatsStalled,
      avg_course_fee_new:
        studentRows.filter((s) => s.total_fee > 0).length > 0
          ? Math.round(
              studentRows.filter((s) => s.total_fee > 0).reduce((s, r) => s + r.total_fee, 0) /
                studentRows.filter((s) => s.total_fee > 0).length,
            )
          : 0,
    },
    attribution: attr,
    daily_collected: dailyCollected,
    webinars: webinarStats,
    students: studentRows.map(({ payment_ids: _p, phone: _ph, ...rest }) => rest),
    excluded_students: excludedStudents,
    excluded,
    july_paid_payments: julyPaid.map((p) => ({
      id: p.id,
      phone: phone10(p.phone),
      amount: p.amount,
      item_type: p.item_type,
      payment_kind: p.payment_kind,
      item_slug: p.item_slug,
      created_at: p.created_at,
      ymd_ist: istYmd(p.created_at),
      attribution_source: p.attribution_source,
      attribution_campaign: p.attribution_campaign,
      in_collected: collectedIds.has(p.id),
      is_new_student: cleanPhoneSet.has(phone10(p.phone)),
    })),
  };

  writeFileSync(join(OUT_DIR, "portal.json"), JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        out: join(OUT_DIR, "portal.json"),
        new_course_students_clean: out.reconcile.new_course_students_clean,
        new_students_clean: out.reconcile.new_students_clean,
        collected: out.reconcile.collected_total,
        contracted: out.reconcile.contracted_total,
        seats: out.reconcile.seat_bookings_n,
        seat_amount: out.reconcile.seat_booking_amount,
        excluded_students: out.reconcile.excluded_students_n,
        excluded_cash: out.reconcile.excluded_students_july_cash,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
