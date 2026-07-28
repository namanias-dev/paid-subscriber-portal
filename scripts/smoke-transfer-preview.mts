/**
 * READ-ONLY smoke of the transfer impact preview for the primary case.
 * Reads live rows and computes the plan. Writes nothing.
 */
import { getSupabaseAdmin } from "../lib/supabase";
import { planTransfer } from "../lib/enrollmentTransfer";
import type { Course, CourseEnrollment } from "../lib/types";

const db = getSupabaseAdmin();
if (!db) throw new Error("no client");

const SHIPRA = "f7d9c348-689f-4e89-bddb-1dae22087261";
const TARGET_COURSE = "52457ce7-ddac-4417-a694-56d85b8a70ad";
const TARGET_BATCH = "b-mr1jfh0k-oupfzv";

const money = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;
const ist = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—";
const mask = (p?: string | null) => { const d = (p ?? "").replace(/\D/g, "").slice(-10); return d.length === 10 ? `${d.slice(0, 2)}******${d.slice(-2)}` : "—"; };

const { data: enr } = await db.from("course_enrollments").select("*").eq("id", SHIPRA).single();
const { data: src } = await db.from("courses").select("*").eq("id", enr.course_id).single();
const { data: tgt } = await db.from("courses").select("*").eq("id", TARGET_COURSE).single();

const plan = planTransfer({
  enrollment: enr as CourseEnrollment,
  sourceCourse: src as Course,
  targetCourse: tgt as Course,
  targetBatchId: TARGET_BATCH,
});

console.log("\n" + "═".repeat(94));
console.log("READ-ONLY SMOKE — transfer impact preview as the modal will render it");
console.log("═".repeat(94));
console.log(`student ${mask(enr.phone)} · status ${enr.status} · enrolled ${ist(enr.created_at)}\n`);

console.log("STEP 1 · where she is now");
console.log(`   course        ${enr.course_title}`);
console.log(`   batch         ${enr.batch_label}   (batch_id: ${enr.batch_id})`);
console.log(`   total fee     ${money(enr.total_fee)}`);
console.log(`   paid          ${money(enr.amount_paid)}`);
console.log(`   outstanding   ${money(enr.total_fee - enr.amount_paid)}`);

console.log("\nSTEP 2 · target");
console.log(`   course        ${plan.target.courseTitle}${plan.target.courseChanged ? "   [COURSE CHANGES]" : ""}`);
console.log(`   batch         ${plan.target.batchLabel}   (batch_id: ${TARGET_BATCH})`);

console.log("\nSTEP 3 · impact");
console.log(`   money         ${plan.money.detail}`);
console.log(`   fee           ${money(plan.money.oldTotal)} -> ${money(plan.money.newTotal)}   delta ${money(plan.money.delta)}`);
console.log(`   outstanding   ${money(plan.money.oldOutstanding)} -> ${money(plan.money.newOutstanding)}`);
console.log(`   neutral?      ${plan.financiallyNeutral}`);

console.log(`\n   BATCH START   ${ist(plan.source.start.iso)}  ->  ${ist(plan.target.start.iso)}   (${plan.schedule.shiftDays! > 0 ? "+" : ""}${plan.schedule.shiftDays} days)`);
console.log(`     current start provenance: ${plan.source.start.provenance}`);
console.log(`       ${plan.source.start.detail}`);
console.log(`       derived timestamp: ${plan.source.start.iso}`);
console.log(`     new start provenance:     ${plan.target.start.provenance}`);
console.log(`       ${plan.target.start.detail}`);
console.log(`       derived timestamp: ${plan.target.start.iso}`);

console.log("\n   schedule");
console.log(`     ${"line".padEnd(22)}${"amount".padEnd(11)}${"due now".padEnd(14)}${"due after".padEnd(14)}effect`);
for (const c of plan.schedule.changes) {
  console.log(`     ${(c.paid ? "✓ " : "○ ") + c.label.padEnd(20)}${money(c.amount).padEnd(11)}${ist(c.oldDue).padEnd(14)}${ist(c.newDue).padEnd(14)}${c.effect}`);
}

console.log("\n   seats");
console.log(`     target ${plan.seats.target.seatsLeft} -> ${plan.seats.target.after}     source ${plan.seats.source.seatsLeft} -> ${plan.seats.source.after}`);

console.log("\n   warnings");
for (const w of plan.warnings) console.log(`     [${w.code}] ${w.detail}`);
console.log("\n   blocks");
console.log(plan.blocks.length ? plan.blocks.map((b) => `     [${b.code}] ${b.detail}`).join("\n") : "     none — this transfer would be permitted");

const { data: after } = await db.from("course_enrollments").select("updated_at, status, batch_label").eq("id", SHIPRA).single();
console.log(`\nHER LIVE ROW AFTER THIS SMOKE: status ${after.status} · batch ${after.batch_label} · updated_at ${after.updated_at}  (unchanged — nothing was written)`);
console.log("═".repeat(94) + "\n");
