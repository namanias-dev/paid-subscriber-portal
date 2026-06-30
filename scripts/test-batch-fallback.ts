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

process.exit(fail === 0 && p3fail === 0 ? 0 : 1);
