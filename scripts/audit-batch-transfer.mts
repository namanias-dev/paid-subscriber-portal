/**
 * PHASE 0 — interconnection audit for batch/course transfer. READ-ONLY.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/_react-cache-shim.mjs \
 *     scripts/audit-batch-transfer.mts
 */
import { getSupabaseAdmin } from "../lib/supabase";

const db = getSupabaseAdmin();
if (!db) throw new Error("no service-role client");

const SHIPRA = "f7d9c348-689f-4e89-bddb-1dae22087261";
const rule = (n = 100) => console.log("─".repeat(n));
const head = (t: string) => { console.log("\n" + "═".repeat(100)); console.log(t); console.log("═".repeat(100)); };

// ───────────────────────────── 1. does a batch entity exist? ─────────────────────────────
head("1 · DOES A BATCH ENTITY EXIST?  (the brief assumed no)");

for (const t of ["batches", "course_batches", "cohorts", "sections"]) {
  const { error } = await db.from(t).select("*").limit(1);
  console.log(`  standalone table ${t.padEnd(16)} ${error ? "ABSENT" : "EXISTS"}`);
}

const { data: courses } = await db.from("courses").select("id, slug, title, batches, default_batch_id, batch_start");
const withBatches = (courses ?? []).filter((c) => Array.isArray(c.batches) && c.batches.length);
const totalBatches = withBatches.reduce((a, c) => a + c.batches.length, 0);
console.log(`\n  courses.batches (JSONB array)     EXISTS — ${withBatches.length}/${courses?.length} courses, ${totalBatches} batches total`);
console.log(`  courses.default_batch_id          populated on ${(courses ?? []).filter((c) => c.default_batch_id).length} courses`);
const withStart = withBatches.flatMap((c) => c.batches).filter((b: { start_date?: string | null }) => b.start_date);
console.log(`  batches carrying a STRUCTURED start_date: ${withStart.length} of ${totalBatches}`);
const withCap = withBatches.flatMap((c) => c.batches).filter((b: { capacity?: number | null }) => b.capacity != null);
console.log(`  batches carrying capacity              : ${withCap.length} of ${totalBatches}`);
console.log("\n  VERDICT: a batch entity DOES exist — nested in courses.batches, with stable ids,");
console.log("           structured start_date, price, capacity, seats_left and emi_config.");

// ───────────────────────────── 2. is it linked to enrollments? ─────────────────────────────
head("2 · IS IT LINKED TO ENROLLMENTS?  (the load-bearing question)");

const { data: enr } = await db.from("course_enrollments").select("id, course_id, course_title, batch_label, batch_id, batch_id_source, status");
const rows = enr ?? [];
console.log(`  course_enrollments rows                : ${rows.length}`);
const linked = rows.filter((e) => e.batch_id).length;
console.log(`  with batch_id populated                : ${linked} of ${rows.length}  (${rows.length - linked} unlinked)`);
const unlinkedCourses = [...new Set(rows.filter((e) => !e.batch_id).map((e) => e.course_title))];
console.log(`  courses where NO row is linked         : ${unlinkedCourses.slice(0, 4).join(" · ")}`);
console.log(`  with batch_id_source populated         : ${rows.filter((e) => e.batch_id_source).length}`);
console.log(`  distinct free-text batch_label values  : ${new Set(rows.map((e) => e.batch_label)).size}`);

const catalogLabels = new Map<string, Set<string>>();
for (const c of withBatches) catalogLabels.set(c.id, new Set(c.batches.map((b: { label: string }) => b.label)));
let matched = 0, unmatched = 0;
for (const e of rows) {
  if (!e.batch_label) continue;
  (catalogLabels.get(e.course_id)?.has(e.batch_label) ? (matched++, matched) : (unmatched++, unmatched));
}
console.log(`\n  enrollment labels that MATCH a catalog batch label on the same course: ${matched}`);
console.log(`  enrollment labels with NO catalog counterpart                        : ${unmatched}`);
console.log("\n  VERDICT: the catalog and the enrollments are two disconnected naming worlds.");
console.log("           A transfer must therefore target a CATALOG batch (authoritative id +");
console.log("           start_date) and write both batch_id and batch_label, repairing the link.");

// ───────────────────────────── 3. the primary case ─────────────────────────────
head("3 · THE PRIMARY CASE — is the requested transfer what the brief says it is?");

const { data: sh } = await db.from("course_enrollments").select("*").eq("id", SHIPRA).single();
const { data: srcCourse } = await db.from("courses").select("id, slug, title, batches").eq("id", sh.course_id).single();

console.log(`  SOURCE  course : ${srcCourse.title}`);
console.log(`          id     : ${srcCourse.id}`);
console.log(`          batch_label : ${JSON.stringify(sh.batch_label)}   batch_id: ${sh.batch_id}`);
console.log(`          status ${sh.status} · plan ${sh.plan_type} · total ${sh.total_fee} · paid ${sh.amount_paid}`);
console.log(`          catalog batches on this course:`);
for (const b of srcCourse.batches) console.log(`            ${b.id}  ${JSON.stringify(b.label)}  start=${b.start_date}  price=${b.price}`);

const TARGET_LABEL = "Starts 5 Aug 2026 · Morning";
const holders = rows.filter((e) => e.batch_label === TARGET_LABEL);
const targetCourseIds = [...new Set(holders.map((e) => e.course_id))];
console.log(`\n  TARGET  requested label : ${JSON.stringify(TARGET_LABEL)}  (${holders.length} existing enrollments)`);
console.log(`          those enrollments live on course id(s): ${targetCourseIds.join(", ")}`);
for (const cid of targetCourseIds) {
  const c = courses!.find((x) => x.id === cid)!;
  console.log(`            ${cid} = ${c.title}`);
}
const sameCourse = targetCourseIds.length === 1 && targetCourseIds[0] === sh.course_id;
console.log(`\n  Is the target on the SAME course as the student?  ${sameCourse ? "YES" : "NO  <-- this is a COURSE change, not a batch change"}`);

if (!sameCourse) {
  const tc = courses!.find((x) => x.id === targetCourseIds[0])!;
  console.log(`\n  TARGET COURSE catalog batches (${tc.title}):`);
  for (const b of tc.batches) {
    console.log(`     ${b.id}  ${String(JSON.stringify(b.label)).padEnd(22)} start=${b.start_date}  price=${b.price}  payInFull=${b.pay_in_full_price}  cap=${b.capacity}  left=${b.seats_left}`);
  }
  const anyAug5 = tc.batches.some((b: { start_date?: string | null }) => b.start_date?.startsWith("2026-08-04") || b.start_date?.startsWith("2026-08-05"));
  console.log(`\n  Does ANY catalog batch on the target course start on 5 Aug?  ${anyAug5 ? "yes" : "NO"}`);
  console.log(`  Catalog says the Morning batches start: ${tc.batches.find((b: { label: string }) => /Morning/i.test(b.label))?.start_date}`);
  console.log(`  i.e. 10 Aug 2026 IST — the label ${JSON.stringify(TARGET_LABEL)} disagrees with the catalog.`);
}

console.log(`\n  fees carried by the ${holders.length} enrollments already on that label:`);
const feeMix: Record<string, number> = {};
for (const h of holders) {
  const full = rows.find((r) => r.id === h.id);
  void full;
}
const { data: holderRows } = await db.from("course_enrollments").select("total_fee, plan_type, status").eq("batch_label", TARGET_LABEL);
for (const h of holderRows ?? []) {
  const k = `fee ${h.total_fee} · plan ${h.plan_type}`;
  feeMix[k] = (feeMix[k] ?? 0) + 1;
}
for (const [k, v] of Object.entries(feeMix)) console.log(`     ${v}x  ${k}`);
console.log(`\n  The label alone does not determine a fee — it spans Online (45000/40000) and`);
console.log(`  Offline (75000/67000) variants. Only a catalog batch id determines price.`);

// ───────────────────────────── 4. which enrollment table does the UI read? ─────────────────────────────
head("4 · THE FIXTURE TRAP — which table does the student profile actually read?");
const { data: legacy } = await db.from("enrollments").select("id");
console.log(`  enrollments        (fixture) rows: ${legacy?.length}`);
console.log(`  course_enrollments (real)    rows: ${rows.length}`);
console.log(`
  app/api/admin/students/[id]/route.ts:72-73 reads BOTH:
      getCourseEnrollmentsByPhone(phone)  -> course_enrollments  (real)
      getEnrollments(student.id)          -> enrollments         (fixture, mock fallback)
  and merges them into unified course cards tagged  source: "course" | "legacy".

  CONSEQUENCE: the transfer action must be offered ONLY on source:"course" cards.
  A legacy card has no schedule, no batch and no real row to supersede.`);

// ───────────────────────────── 5. schedule shape + reusable machinery ─────────────────────────────
head("5 · SCHEDULE SHAPE AND THE MACHINERY ALREADY AVAILABLE TO REUSE");
console.log(`  Shipra's schedule (the exact JSONB shape a transfer must preserve):`);
for (const l of sh.schedule) console.log("     " + JSON.stringify(l));
console.log(`
  Reusable, already in the codebase — no second implementation needed:
    lib/installments.ts:240  effectiveCourseForBatch(course, batchId)
        overlays a catalog batch's price / start_date / emi_config / capacity onto a course
    lib/installments.ts:208  buildBatchLabel(batchStart, timings)
        GENERATES the "Starts 13 Jul 2026 · Morning" format — i.e. the free-text labels are
        this function's output, which is what makes parsing them back tractable
    lib/installments.ts:81   buildSchedule / buildFullWithSeatSchedule / buildInstallmentOnlySchedule
        build a FRESH schedule with every line paid:false — usable for shape, NOT for a
        transfer, because a transfer must carry paid lines across untouched
    lib/dates.ts:91,102      addDaysISO / addMonthsISO  (IST-correct date arithmetic)
    lib/paymentPlanChange.ts, lib/paymentSupersede.ts   existing supersession scaffolding`);

console.log("\n");
