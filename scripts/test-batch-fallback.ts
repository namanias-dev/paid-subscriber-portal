/**
 * Phase-1 proof: planCourseEnrollment with NO batchId produces byte-for-byte the
 * same plan as before, and the backfilled default batch reproduces it exactly.
 *
 * Run: npx tsx scripts/test-batch-fallback.ts
 *
 * Uses the REAL planCourseEnrollment (single source of truth for pricing), not a
 * mirrored copy. Courses below are shaped from the actual production rows.
 */
import { planCourseEnrollment } from "../lib/installments";
import type { Course, CourseBatch } from "../lib/types";

function makeCourse(partial: Partial<Course>): Course {
  // Only the pricing/date/mode fields are read by planCourseEnrollment; the rest
  // are filled with harmless defaults so this is a valid Course at runtime.
  return {
    id: "x", slug: "x", title: "x", category: "Foundation", description: "",
    long_description: null, image: null, modes: [], language: "", target_years: "",
    batch_start: null, duration: null, price: 0, original_price: null,
    pay_in_full_price: null, gst: false, emi_amount: null, emi_months: null,
    faculty: "", capacity: null, seats_left: null, status: "published",
    brochure_link: null, demo_video: null, razorpay_link: null, included: [],
    not_included: [], curriculum: [], schedule: null, featured: false,
    created_at: "", ...partial,
  } as Course;
}

/** Build the default batch exactly as the SQL backfill does (mirror of fields). */
function defaultBatch(c: Course): CourseBatch {
  return {
    id: `${c.id}-b1`,
    label: null,
    mode: c.modes,
    timing: c.batch_timings ?? [],
    start_date: c.batch_start,
    end_date: null,
    price: c.price,
    original_price: c.original_price,
    pay_in_full_price: c.pay_in_full_price,
    emi_config: c.emi_config ?? {},
    capacity: c.capacity,
    seats_left: c.seats_left,
  };
}

const COURSES: Course[] = [
  makeCourse({ id: "co-ncert", slug: "ncert-foundation", title: "NCERT Foundation", price: 7500, modes: ["Online", "Hybrid"] }),
  makeCourse({ id: "co-psir", slug: "psir-optional", title: "PSIR Optional", price: 40000, original_price: 60000, modes: ["Online"] }),
  makeCourse({
    id: "co-safalta", slug: "safalta-online-foundation", title: "Safalta Online", price: 45000,
    original_price: 50000, pay_in_full_price: 40000, batch_start: "2026-07-12T18:30:00.000Z",
    batch_timings: ["Morning"], modes: ["Online"],
    emi_config: { enabled: true, seat_amount: 2000, best_value_note: "Save More", interval_months: 2, installment_counts: [3] },
  }),
  makeCourse({
    id: "co-saarthi-off", slug: "saarthi-gs-foundation-offline", title: "Safalta Offline", price: 75000,
    original_price: 100000, pay_in_full_price: 65000, batch_start: "2026-07-12T18:30:00.000Z",
    batch_timings: ["Morning", "Evening"], modes: ["Offline"],
    emi_config: { enabled: true, seat_amount: 2000, interval_months: 2, installment_counts: [3], first_interval_days: 7 },
  }),
];

interface Combo { plan: "full" | "emi"; bookSeat: boolean; installmentCount?: number | null; }
const COMBOS: Combo[] = [
  { plan: "full", bookSeat: false },
  { plan: "full", bookSeat: true },
  { plan: "emi", bookSeat: false, installmentCount: 3 },
  { plan: "emi", bookSeat: true, installmentCount: 3 },
];

// Fixed booking time so schedules (due dates) are deterministic & comparable.
const bookingISO = "2026-06-30T06:00:00.000Z";

let pass = 0;
let fail = 0;

for (const base of COURSES) {
  const course: Course = { ...base, batches: [defaultBatch(base)], default_batch_id: `${base.id}-b1` };
  for (const combo of COMBOS) {
    const noBatch = planCourseEnrollment({ course, ...combo, bookingISO });
    const withDefault = planCourseEnrollment({ course, ...combo, batchId: course.default_batch_id, bookingISO });

    const a = JSON.stringify(noBatch);
    const b = JSON.stringify(withDefault);
    const same = a === b;
    if (same) pass++; else fail++;

    const tag = `${base.slug} · ${combo.plan}${combo.bookSeat ? "+seat" : ""}${combo.installmentCount ? ` x${combo.installmentCount}` : ""}`;
    if (noBatch.ok) {
      console.log(`${same ? "PASS" : "FAIL"}  ${tag}  →  total=${noBatch.plan.totalFee} first=${noBatch.plan.firstKind}:${noBatch.plan.firstAmount} lines=${noBatch.plan.schedule.length} label=${JSON.stringify(noBatch.plan.batchLabel)}`);
    } else {
      console.log(`${same ? "PASS" : "FAIL"}  ${tag}  →  (not payable: ${noBatch.error})`);
    }
    if (!same) {
      console.log("   no-batch :", a);
      console.log("   w/default:", b);
    }
  }
}

console.log(`\n${fail === 0 ? "ALL IDENTICAL" : "MISMATCH"} — ${pass} identical, ${fail} different.`);

// ---------------------------------------------------------------------------
// Phase 3: multi-batch course — a chosen batch prices/labels from THAT batch;
// null/unknown batchId falls back to the course-level default (never throws).
// ---------------------------------------------------------------------------
console.log("\n--- Phase 3: multi-batch selection ---");
let p3pass = 0;
let p3fail = 0;
const assert = (name: string, cond: boolean) => { if (cond) p3pass++; else p3fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); };

const multi = makeCourse({
  id: "co-multi", slug: "multi-batch-demo", title: "Multi Batch Demo",
  price: 20000, original_price: 30000, pay_in_full_price: 18000, batch_start: "2026-07-15T00:00:00.000Z",
  batch_timings: ["Morning"], modes: ["Online"],
});
const morning: CourseBatch = { ...defaultBatch(multi), id: "co-multi-b1", label: "Online · Morning" };
const evening: CourseBatch = {
  id: "co-multi-b2", label: "Evening · Offline", mode: ["Offline"], timing: ["Evening"],
  start_date: "2026-07-26T18:30:00.000Z", end_date: null, price: 22000, original_price: 35000,
  pay_in_full_price: 20000, emi_config: {}, capacity: 40, seats_left: 40,
};
const multiCourse: Course = { ...multi, batches: [morning, evening], default_batch_id: "co-multi-b1" };

const planFull = (batchId?: string | null) => planCourseEnrollment({ course: multiCourse, plan: "full", bookSeat: false, batchId, bookingISO });

const rDefault = planFull(null);
const rMorning = planFull("co-multi-b1");
const rEvening = planFull("co-multi-b2");
const rUnknown = planFull("does-not-exist");

if (rDefault.ok && rMorning.ok && rEvening.ok && rUnknown.ok) {
  // Default batch mirrors course-level → null and default id and course-level identical.
  assert("null batchId === course-level (pay-in-full 18000)", rDefault.plan.totalFee === 18000);
  assert("default-batch id === null (both 18000)", rMorning.plan.totalFee === rDefault.plan.totalFee);
  assert("Evening batch prices from its own fields (pay-in-full 20000)", rEvening.plan.totalFee === 20000);
  assert("Evening batch label reflects its start/timing", rEvening.plan.batchLabel === "Starts 27 Jul 2026 · Evening");
  assert("Evening first charge = 20000", rEvening.plan.firstAmount === 20000);
  assert("unknown batchId falls back to default (18000, no throw)", rUnknown.plan.totalFee === 18000);
  assert("Morning label reflects its start/timing", rMorning.plan.batchLabel === "Starts 15 Jul 2026 · Morning");
} else {
  assert("all multi-batch plans payable", false);
}
console.log(`\n${p3fail === 0 ? "PHASE3 OK" : "PHASE3 FAIL"} — ${p3pass} pass, ${p3fail} fail.`);

// ---------------------------------------------------------------------------
// Phase 4: single-VALUED batches (new model: one mode + one timing per batch).
// Four real offerings (Online/Offline × Morning/Evening). Proves each batch
// prices/labels from ITS OWN fields, mode/timing render via the helpers, and an
// unknown/null batchId still falls back to the course-level default.
// ---------------------------------------------------------------------------
console.log("\n--- Phase 4: single-valued 4-offering course ---");
let p4pass = 0;
let p4fail = 0;
const assert4 = (name: string, cond: boolean) => { if (cond) p4pass++; else p4fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); };

const sv = makeCourse({
  id: "co-sv", slug: "single-valued-demo", title: "Single Valued Demo",
  price: 45000, original_price: 50000, pay_in_full_price: 40000, batch_start: "2026-08-04T18:30:00.000Z",
  batch_timings: ["Morning"], modes: ["Online"],
});
// Note: mode/timing are SINGLE strings here (the new model), not arrays.
const mk = (id: string, mode: string, timing: string, price: number, orig: number, pif: number): CourseBatch => ({
  id, label: `${mode} · ${timing}`, mode: mode as never, timing: timing as never,
  start_date: "2026-08-04T18:30:00.000Z", end_date: null, price, original_price: orig, pay_in_full_price: pif,
  emi_config: { enabled: true, seat_amount: 2000, interval_months: 2, installment_counts: [3] }, capacity: null, seats_left: null,
});
const svCourse: Course = {
  ...sv,
  default_batch_id: "co-sv-onm",
  batches: [
    mk("co-sv-onm", "Online", "Morning", 45000, 50000, 40000),
    mk("co-sv-one", "Online", "Evening", 47000, 52000, 42000),
    mk("co-sv-ofm", "Offline", "Morning", 55000, 60000, 50000),
    mk("co-sv-ofe", "Offline", "Evening", 57000, 62000, 52000),
  ],
};
const planSv = (batchId?: string | null) => planCourseEnrollment({ course: svCourse, plan: "full", bookSeat: false, batchId, bookingISO });
const rOnM = planSv("co-sv-onm");
const rOnE = planSv("co-sv-one");
const rOfM = planSv("co-sv-ofm");
const rOfE = planSv("co-sv-ofe");
const rNull = planSv(null);
const rBad = planSv("nope");
if (rOnM.ok && rOnE.ok && rOfM.ok && rOfE.ok && rNull.ok && rBad.ok) {
  assert4("Online·Morning pays its pay-in-full 40000", rOnM.plan.totalFee === 40000);
  assert4("Online·Evening pays its pay-in-full 42000", rOnE.plan.totalFee === 42000);
  assert4("Offline·Morning pays its pay-in-full 50000", rOfM.plan.totalFee === 50000);
  assert4("Offline·Evening pays its pay-in-full 52000", rOfE.plan.totalFee === 52000);
  assert4("Offline·Evening first charge = 52000 (not Online's 40000)", rOfE.plan.firstAmount === 52000);
  assert4("single-valued timing renders in label", rOfM.plan.batchLabel === "Starts 5 Aug 2026 · Morning");
  assert4("null batchId falls back to course-level default (40000)", rNull.plan.totalFee === 40000);
  assert4("unknown batchId falls back to default (40000, no throw)", rBad.plan.totalFee === 40000);
} else {
  assert4("all single-valued plans payable", false);
}
console.log(`\n${p4fail === 0 ? "PHASE4 OK" : "PHASE4 FAIL"} — ${p4pass} pass, ${p4fail} fail.`);

process.exit(fail === 0 && p3fail === 0 && p4fail === 0 ? 0 : 1);
