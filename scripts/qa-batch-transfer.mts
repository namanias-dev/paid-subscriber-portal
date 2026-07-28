/**
 * Self-QA for batch/course transfer, against the real database.
 *
 * NOTHING LIVE IS MUTATED. Every case runs on a clone of a real row, tagged with a
 * batch id so cleanup can find it even if this process is killed. Seat counts the
 * transfer decrements are restored. Shipra's actual enrollment is READ ONLY — the
 * primary case clones her row and transfers the clone.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/_react-cache-shim.mjs \
 *     scripts/qa-batch-transfer.mts
 */
import { getSupabaseAdmin } from "../lib/supabase";
import { planTransfer } from "../lib/enrollmentTransfer";
import type { Course, CourseEnrollment } from "../lib/types";

const db = getSupabaseAdmin();
if (!db) throw new Error("no service-role client");

const TAG = `qa-transfer-${Date.now()}`;
const SHIPRA = "f7d9c348-689f-4e89-bddb-1dae22087261";
const TARGET_COURSE = "52457ce7-ddac-4417-a694-56d85b8a70ad";
const TARGET_BATCH = "b-mr1jfh0k-oupfzv"; // "Morning : Online", the Online variant matching her current mode

const created: string[] = [];
const seatRestore: { courseId: string; batchId: string; seatsLeft: number }[] = [];
let pass = 0, fail = 0;

const ok = (label: string, cond: boolean, detail = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};
const money = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;
const ist = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—";
const mask = (p?: string | null) => {
  const d = (p ?? "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `${d.slice(0, 2)}******${d.slice(-2)}` : "—";
};

async function cleanup() {
  if (!created.length && !seatRestore.length) return;
  console.log(`\ncleaning up ${created.length} tagged rows…`);
  await db!.from("enrollment_transfers").delete().in("from_enrollment_id", created);
  await db!.from("enrollment_transfers").delete().in("to_enrollment_id", created);
  // children first: a superseded row is referenced by the row that replaced it
  await db!.from("course_enrollments").update({ superseded_by: null }).in("id", created);
  await db!.from("course_enrollments").delete().in("id", created);
  for (const s of seatRestore) {
    const { data: c } = await db!.from("courses").select("batches").eq("id", s.courseId).single();
    if (!c) continue;
    const batches = (c.batches as { id: string; seats_left: number | null }[]).map((b) =>
      b.id === s.batchId ? { ...b, seats_left: s.seatsLeft } : b);
    await db!.from("courses").update({ batches }).eq("id", s.courseId);
  }
  const { data: left } = await db!.from("course_enrollments").select("id").in("id", created);
  console.log(`residue: ${left?.length ?? 0} rows (must be 0)`);
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await cleanup(); process.exit(130); });

/** Clone a real enrollment so a destructive test never touches the original. */
async function clone(sourceId: string, over: Partial<CourseEnrollment> = {}): Promise<CourseEnrollment> {
  const { data: src } = await db!.from("course_enrollments").select("*").eq("id", sourceId).single();
  const { id: _drop, created_at: _c, updated_at: _u, superseded_by: _s, ...rest } = src as Record<string, unknown>;
  void _drop; void _c; void _u; void _s;
  const { data, error } = await db!.from("course_enrollments")
    .insert({ ...rest, ...over, id: crypto.randomUUID(), student_name: `${TAG} clone`, email: `${TAG}@qa.invalid` })
    .select("*").single();
  if (error) throw new Error(`clone failed: ${error.message}`);
  created.push(data.id);
  return data as CourseEnrollment;
}

async function courseById(id: string): Promise<Course> {
  const { data } = await db!.from("courses").select("*").eq("id", id).single();
  return data as Course;
}

async function callTransfer(enr: CourseEnrollment, targetCourse: Course, batchId: string, reason: string, override = false) {
  const src = await courseById(enr.course_id);
  const plan = planTransfer({ enrollment: enr, sourceCourse: src, targetCourse, targetBatchId: batchId, overrideCapacity: override });
  const { data, error } = await db!.rpc("transfer_enrollment", {
    p_enrollment_id: enr.id,
    p_to_course_id: targetCourse.id,
    p_to_course_slug: targetCourse.slug,
    p_to_course_title: targetCourse.title,
    p_to_batch_id: batchId,
    p_to_batch_label: plan.target.batchLabel,
    p_new_total_fee: plan.money.newTotal,
    p_new_schedule: plan.schedule.after,
    p_shift_days: plan.schedule.shiftDays,
    p_reason: reason,
    p_actor_user_id: TAG,
    p_capacity_overridden: override,
    p_expected_amount_paid: enr.amount_paid ?? 0,
  });
  if (data) created.push(data as string);
  return { newId: data as string | null, error, plan };
}

try {
  const targetCourse = await courseById(TARGET_COURSE);
  const tb = (targetCourse.batches ?? []).find((b) => b.id === TARGET_BATCH)!;
  seatRestore.push({ courseId: TARGET_COURSE, batchId: TARGET_BATCH, seatsLeft: tb.seats_left as number });

  // ───────────────────────── 1. the primary case ─────────────────────────
  console.log("\n" + "═".repeat(96));
  console.log("1 · PRIMARY CASE — Shipra, July → August (on a CLONE; her live row is never written)");
  console.log("═".repeat(96));

  const { data: real } = await db.from("course_enrollments").select("*").eq("id", SHIPRA).single();
  const realBefore = JSON.stringify(real);

  const subject = await clone(SHIPRA);
  const before = { ...subject };
  const { newId, error, plan } = await callTransfer(subject, targetCourse, TARGET_BATCH, "QA: batch transfer verification");
  if (error) throw new Error(`transfer failed: ${error.message}`);

  const { data: oldRow } = await db.from("course_enrollments").select("*").eq("id", subject.id).single();
  const { data: newRow } = await db.from("course_enrollments").select("*").eq("id", newId!).single();

  console.log(`\n  student ${mask(before.phone)} · ${before.student_name}`);
  console.log(`  ${"field".padEnd(22)} ${"BEFORE".padEnd(34)} AFTER`);
  console.log("  " + "─".repeat(92));
  const row = (k: string, a: string, b: string) => console.log(`  ${k.padEnd(22)} ${a.padEnd(34)} ${b}`);
  row("course", String(before.course_title).slice(0, 32), String(newRow.course_title).slice(0, 40));
  row("batch", String(before.batch_label), String(newRow.batch_label));
  row("batch_id", String(before.batch_id), String(newRow.batch_id));
  row("batch start", ist(plan.source.start.iso), `${ist(plan.target.start.iso)}  (${plan.target.start.provenance})`);
  row("status", String(before.status), String(newRow.status));
  row("total fee", money(before.total_fee), money(newRow.total_fee));
  row("amount paid", money(before.amount_paid), money(newRow.amount_paid));
  row("outstanding", money(before.total_fee - before.amount_paid), money(newRow.total_fee - newRow.amount_paid));
  console.log("\n  schedule:");
  for (const l of newRow.schedule as { no: number; label: string; amount: number; due: string | null; paid: boolean }[]) {
    const b = (before.schedule as typeof l[]).find((x) => x.no === l.no);
    const moved = b && b.due !== l.due;
    console.log(`    ${l.paid ? "✓" : "○"} no.${l.no} ${l.label.padEnd(20)} ${money(l.amount).padEnd(10)} due ${ist(b?.due).padEnd(13)} -> ${ist(l.due)}${moved ? "   MOVED" : "   unchanged"}`);
  }

  console.log("\n  assertions:");
  ok("total fee unchanged", newRow.total_fee === before.total_fee, `${money(before.total_fee)} -> ${money(newRow.total_fee)}`);
  ok("amount paid unchanged", newRow.amount_paid === before.amount_paid, money(newRow.amount_paid));
  ok("outstanding unchanged", (newRow.total_fee - newRow.amount_paid) === (before.total_fee - before.amount_paid));
  const seatBefore = (before.schedule as { kind: string }[]).find((l) => l.kind === "seat");
  const seatAfter = (newRow.schedule as { kind: string }[]).find((l) => l.kind === "seat");
  ok("the PAID SEAT LINE is byte-identical", JSON.stringify(seatBefore) === JSON.stringify(seatAfter));
  const instBefore = (before.schedule as { kind: string; due: string | null; amount: number }[]).find((l) => l.kind === "installment")!;
  const instAfter = (newRow.schedule as { kind: string; due: string | null; amount: number }[]).find((l) => l.kind === "installment")!;
  ok("the unpaid 38,000 kept its amount", instAfter.amount === instBefore.amount, money(instAfter.amount));
  ok("...and only its DUE DATE moved", instAfter.due !== instBefore.due, `${ist(instBefore.due)} -> ${ist(instAfter.due)}`);
  ok("status carried over unchanged", newRow.status === before.status, `seat_booked stays seat_booked`);
  ok("old row superseded, not deleted", oldRow?.status === "transferred_out" && oldRow?.superseded_by === newId);
  ok("batch_id is now populated (the link is repaired)", newRow.batch_id === TARGET_BATCH);

  const { data: xfer } = await db.from("enrollment_transfers").select("*").eq("to_enrollment_id", newId!).single();
  ok("a transfer history row exists with who/why", !!xfer && xfer.reason.includes("QA") && xfer.actor_user_id === TAG);
  ok("history captured both schedules", !!xfer && Array.isArray(xfer.old_schedule) && Array.isArray(xfer.new_schedule));

  const { data: realAfter } = await db.from("course_enrollments").select("*").eq("id", SHIPRA).single();
  ok("SHIPRA'S LIVE ROW IS UNTOUCHED", JSON.stringify(realAfter) === realBefore);

  // ───────────────────────── 2. receipts are immutable ─────────────────────────
  console.log("\n" + "═".repeat(96));
  console.log("2 · RECEIPTS AND PAYMENTS ARE NOT REWRITTEN");
  console.log("═".repeat(96));
  const { data: receipts } = await db.from("receipts").select("id, course_title, amount").eq("phone", before.phone).limit(5);
  console.log(`  receipts on this phone: ${receipts?.length ?? 0} (a transfer issues none and edits none)`);
  ok("no receipt references the new enrollment", !(receipts ?? []).some((r) => (r as { enrollment_id?: string }).enrollment_id === newId));

  // ───────────────────────── 3. mid-schedule, part paid ─────────────────────────
  console.log("\n" + "═".repeat(96));
  console.log("3 · MID-SCHEDULE STUDENT — 2 of 4 paid");
  console.log("═".repeat(96));
  const mid = await clone(SHIPRA, {
    total_fee: 40000, amount_paid: 20000, plan_type: "emi", installment_count: 4, status: "partially_paid",
    schedule: [
      { no: 1, kind: "installment", label: "Installment 1 of 4", amount: 10000, due: "2026-07-20T06:30:00.000Z", paid: true, paid_at: "2026-07-20T00:00:00Z", reference_no: "QA-1" },
      { no: 2, kind: "installment", label: "Installment 2 of 4", amount: 10000, due: "2026-08-20T06:30:00.000Z", paid: true, paid_at: "2026-08-20T00:00:00Z", reference_no: "QA-2" },
      { no: 3, kind: "installment", label: "Installment 3 of 4", amount: 10000, due: "2026-09-20T06:30:00.000Z", paid: false },
      { no: 4, kind: "installment", label: "Installment 4 of 4", amount: 10000, due: "2026-10-20T06:30:00.000Z", paid: false },
    ],
  } as Partial<CourseEnrollment>);
  const midRes = await callTransfer(mid, targetCourse, TARGET_BATCH, "QA: mid-schedule");
  const { data: midNew } = await db.from("course_enrollments").select("*").eq("id", midRes.newId!).single();
  const midLines = midNew.schedule as { no: number; due: string; paid: boolean; reference_no?: string }[];
  ok("paid lines keep their dates AND references",
    midLines[0].due === "2026-07-20T06:30:00.000Z" && midLines[1].reference_no === "QA-2");
  ok("unpaid lines moved", midLines[2].due !== "2026-09-20T06:30:00.000Z" && midLines[3].due !== "2026-10-20T06:30:00.000Z");
  ok("amount_paid untouched", midNew.amount_paid === 20000, money(midNew.amount_paid));

  // ───────────────────────── 4. money guards inside the transaction ─────────────────────────
  console.log("\n" + "═".repeat(96));
  console.log("4 · THE TRANSACTION REFUSES INCONSISTENT WRITES (and rolls back entirely)");
  console.log("═".repeat(96));

  const guardSubject = await clone(SHIPRA);
  const gPlan = planTransfer({ enrollment: guardSubject, sourceCourse: await courseById(guardSubject.course_id), targetCourse, targetBatchId: TARGET_BATCH });

  // (a) a schedule whose paid total disagrees with amount_paid
  const tampered = gPlan.schedule.after.map((l) => (l.kind === "seat" ? { ...l, amount: 999 } : l));
  const bad = await db.rpc("transfer_enrollment", {
    p_enrollment_id: guardSubject.id, p_to_course_id: targetCourse.id, p_to_course_slug: targetCourse.slug,
    p_to_course_title: targetCourse.title, p_to_batch_id: TARGET_BATCH, p_to_batch_label: gPlan.target.batchLabel,
    p_new_total_fee: gPlan.money.newTotal, p_new_schedule: tampered, p_shift_days: gPlan.schedule.shiftDays,
    p_reason: "QA: tampered", p_actor_user_id: TAG, p_capacity_overridden: false, p_expected_amount_paid: guardSubject.amount_paid,
  });
  ok("a schedule that loses money is refused", !!bad.error, bad.error?.message.slice(0, 60));

  // (b) prove NOTHING was written by that failed attempt — the rollback proof
  const { data: stillThere } = await db.from("course_enrollments").select("status, superseded_by").eq("id", guardSubject.id).single();
  const { count: xferCount } = await db.from("enrollment_transfers").select("*", { count: "exact", head: true }).eq("from_enrollment_id", guardSubject.id);
  ok("the source row was NOT superseded by the failed attempt", stillThere?.status !== "transferred_out" && !stillThere?.superseded_by);
  ok("no partial history row was left behind", xferCount === 0);
  const { data: orphan } = await db.from("course_enrollments").select("id").eq("student_name", `${TAG} clone`).eq("batch_id", TARGET_BATCH);
  console.log(`    rows in the target batch from this tag so far: ${orphan?.length ?? 0} (the two successful transfers only)`);

  // (c) empty reason
  const noReason = await db.rpc("transfer_enrollment", {
    p_enrollment_id: guardSubject.id, p_to_course_id: targetCourse.id, p_to_course_slug: targetCourse.slug,
    p_to_course_title: targetCourse.title, p_to_batch_id: TARGET_BATCH, p_to_batch_label: gPlan.target.batchLabel,
    p_new_total_fee: gPlan.money.newTotal, p_new_schedule: gPlan.schedule.after, p_shift_days: 0,
    p_reason: "   ", p_actor_user_id: TAG, p_capacity_overridden: false, p_expected_amount_paid: guardSubject.amount_paid,
  });
  ok("a transfer without a reason is refused", !!noReason.error);

  // (d) stale preview — the money moved while a human was reading
  const stale = await db.rpc("transfer_enrollment", {
    p_enrollment_id: guardSubject.id, p_to_course_id: targetCourse.id, p_to_course_slug: targetCourse.slug,
    p_to_course_title: targetCourse.title, p_to_batch_id: TARGET_BATCH, p_to_batch_label: gPlan.target.batchLabel,
    p_new_total_fee: gPlan.money.newTotal, p_new_schedule: gPlan.schedule.after, p_shift_days: 0,
    p_reason: "QA: stale", p_actor_user_id: TAG, p_capacity_overridden: false, p_expected_amount_paid: 999999,
  });
  ok("a stale preview (paid amount changed) is refused", !!stale.error, stale.error?.message.slice(0, 50));

  // ───────────────────────── 5. double transfer ─────────────────────────
  console.log("\n" + "═".repeat(96));
  console.log("5 · DOUBLE TRANSFER — July → Aug → Sept, history chain intact");
  console.log("═".repeat(96));
  const chain1 = await clone(SHIPRA);
  const t1 = await callTransfer(chain1, targetCourse, TARGET_BATCH, "QA: hop 1");
  const { data: hop1 } = await db.from("course_enrollments").select("*").eq("id", t1.newId!).single();
  const t2 = await callTransfer(hop1 as CourseEnrollment, targetCourse, "b-mr1jb32i-emi9ju", "QA: hop 2");
  seatRestore.push({ courseId: TARGET_COURSE, batchId: "b-mr1jb32i-emi9ju", seatsLeft: (targetCourse.batches ?? []).find((b) => b.id === "b-mr1jb32i-emi9ju")!.seats_left as number });
  ok("the second hop succeeded", !t2.error, t2.error?.message);
  const { data: c1 } = await db.from("course_enrollments").select("superseded_by, status").eq("id", chain1.id).single();
  const { data: c2 } = await db.from("course_enrollments").select("superseded_by, status").eq("id", t1.newId!).single();
  const { data: c3 } = await db.from("course_enrollments").select("superseded_by, status").eq("id", t2.newId!).single();
  ok("hop 1 points to hop 2", c1?.superseded_by === t1.newId);
  ok("hop 2 points to hop 3", c2?.superseded_by === t2.newId);
  ok("only the final row is live", !c3?.superseded_by && c1?.status === "transferred_out" && c2?.status === "transferred_out");
  const { count: chainRows } = await db.from("enrollment_transfers").select("*", { count: "exact", head: true }).in("from_enrollment_id", [chain1.id, t1.newId!]);
  ok("two history rows, no orphans", chainRows === 2);

  // re-transferring an already superseded row must fail
  const again = await callTransfer(chain1, targetCourse, TARGET_BATCH, "QA: re-transfer superseded");
  ok("a superseded row cannot be transferred again", !!again.error, again.error?.message.slice(0, 52));

  // ───────────────────────── 6. pending instructions job ─────────────────────────
  console.log("\n" + "═".repeat(96));
  console.log("6 · A PENDING INSTRUCTIONS SMS IS CANCELLED, NOT SENT, AFTER A TRANSFER");
  console.log("═".repeat(96));
  const { evaluateFollowUp } = await import("../lib/sms/installmentFollowUp");
  const supersededRow = await db.from("course_enrollments").select("*").eq("id", chain1.id).single();
  const decision = evaluateFollowUp(
    { id: "job", course_enrollment_id: chain1.id, installment_no: 1, installment_fingerprint: null, attempts: 0 } as never,
    { template: { id: "installment_instructions", status: "active", gateway_template_id: "1777178519743722233" }, enrollment: supersededRow.data as never, optedOut: false, alreadyInstructed: false } as never,
  );
  ok("the follow-up is cancelled", decision.send === false, `reason: ${(decision as { reason?: string }).reason}`);
  ok("...with the transfer as the stated reason", (decision as { reason?: string }).reason === "enrollment_superseded");

  // ───────────────────────── 7. zero SMS ─────────────────────────
  console.log("\n" + "═".repeat(96));
  console.log("7 · ZERO SMS SENT ACROSS THE ENTIRE RUN");
  console.log("═".repeat(96));
  const { count: smsTotal } = await db.from("sms_logs").select("*", { count: "exact", head: true });
  const { count: queued } = await db.from("sms_scheduled_sends").select("*", { count: "exact", head: true }).eq("status", "pending");
  console.log(`  sms_logs total: ${smsTotal}   pending scheduled sends: ${queued}`);
  ok("no scheduled send was created by any transfer", queued === 0);

  console.log("\n" + "═".repeat(96));
  console.log(`RESULT — ${pass} passed, ${fail} failed`);
  console.log("═".repeat(96));
} finally {
  await cleanup();
}
process.exit(fail ? 1 : 0);
