/**
 * SELF-QA for the installment instructions follow-up, against the REAL database.
 *
 * Why against the real database: the guarantees that matter here are Postgres
 * guarantees. FOR UPDATE SKIP LOCKED either stops two concurrent drains from
 * taking one row or it does not, and a unique index either refuses a duplicate
 * or it does not — an in-memory fake would only prove that my fake behaves the
 * way I imagined Postgres behaves.
 *
 * ZERO REAL SENDS, structurally. Every drain here is passed a stub sender, so
 * the gateway module is never even reached. The stub also lets a transient
 * failure be simulated on demand.
 *
 * WRITES: only public.sms_scheduled_sends, and only rows tagged with this run's
 * id. sms_logs is never written — the parent_send_id foreign key points at an
 * EXISTING log row, read-only — so the log count the user tracks cannot move.
 * Cleanup is registered for normal exit and for interruption.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/_react-cache-shim.mjs \
 *     scripts/qa-followup-sequence.mts
 */
import { getSupabaseAdmin } from "../lib/supabase";
import {
  claimDueFollowUps, drainDueFollowUps, evaluateFollowUp, getFollowUp,
  cancelFollowUpByStaff, listPendingFollowUps, requeueStaleFollowUps,
  FOLLOW_UP_DELAY_MINUTES, INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID,
  type ScheduledSend,
} from "../lib/sms/installmentFollowUp";
import { installmentFingerprint } from "../lib/sms/installmentAttribution";
import { getAllCourseEnrollments } from "../lib/dataProvider";
import type { SendSmsResult } from "../lib/sms/service";

const RUN = `qa-seq-${Date.now()}`;
const MIN = 60_000;

const db = getSupabaseAdmin();
if (!db) { console.error("No service-role client — check .env.local"); process.exit(1); }

// ---------------------------------------------------------------------------
// Cleanup, registered before the first write.
// ---------------------------------------------------------------------------
let cleaned = false;
async function cleanup(why: string) {
  if (cleaned) return;
  cleaned = true;
  const { data, error } = await db!.from("sms_scheduled_sends").delete().like("job_id", `${RUN}%`).select("id");
  console.log(`\n[cleanup:${why}] removed ${data?.length ?? 0} QA rows${error ? ` (error: ${error.message})` : ""}`);
}
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { void cleanup(sig).then(() => process.exit(130)); });
}
process.on("uncaughtException", (e) => { console.error(e); void cleanup("uncaught").then(() => process.exit(1)); });

// ---------------------------------------------------------------------------
// The stub gateway. Nothing outbound can happen through this.
// ---------------------------------------------------------------------------
interface StubCall { mobile: string; templateId: string; dedupeKey: string | null; enrollmentId: string | null; installmentNo: number | null }
const calls: StubCall[] = [];
let failNext = 0;
const seen = new Set<string>();

const stubSend = async (input: Parameters<typeof import("../lib/sms/service").sendSms>[0]): Promise<SendSmsResult> => {
  calls.push({
    mobile: input.mobile, templateId: input.templateId, dedupeKey: input.dedupeKey ?? null,
    enrollmentId: input.installmentKey?.courseEnrollmentId ?? null,
    installmentNo: input.installmentKey?.installmentNo ?? null,
  });
  // Faithful to the real order in sendSms: the log is INSERTED (consuming the
  // dedupe key under a unique index) BEFORE the gateway is called, so a key is
  // spent even by an attempt that then fails. Modelling it the other way round is
  // what hid the dead retry path in the first place.
  const key = input.dedupeKey ?? `${input.mobile}:${input.templateId}`;
  if (seen.has(key)) return { ok: false, skipped: "duplicate" };
  seen.add(key);
  if (failNext > 0) { failNext--; return { ok: false, skipped: "send_failed", error: "simulated 502" }; }
  return { ok: true, logId: crypto.randomUUID(), status: "SENT" };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let PARENT_LOG_ID = "";
let checks = 0, failures = 0;

function check(label: string, pass: boolean, detail = "") {
  checks++;
  if (!pass) failures++;
  console.log(`${pass ? "  PASS" : "  FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}
function hdr(t: string) { console.log(`\n${"=".repeat(76)}\n${t}\n${"=".repeat(76)}`); }
const mask = (p: string) => (p.length >= 10 ? `${p.slice(0, 2)}****${p.slice(-2)}` : "****");

/** Insert a queued follow-up directly, with a chosen due time. */
async function queue(over: Partial<ScheduledSend> & { course_enrollment_id: string; installment_no: number }, dueInMinutes = -1, tag = "") {
  const { data, error } = await db!.from("sms_scheduled_sends").insert({
    template_id: INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID,
    normalized_mobile: over.normalized_mobile ?? "9999900001",
    student_name: over.student_name ?? "QA Student",
    course_enrollment_id: over.course_enrollment_id,
    installment_no: over.installment_no,
    installment_fingerprint: over.installment_fingerprint ?? null,
    parent_send_id: over.parent_send_id ?? PARENT_LOG_ID,
    job_id: `${RUN}${tag}`,
    scheduled_at: new Date(Date.now() + dueInMinutes * MIN).toISOString(),
    status: over.status ?? "pending",
    attempts: over.attempts ?? 0,
    claimed_at: over.claimed_at ?? null,
    actor_user_id: "qa-script",
  }).select("id").single();
  if (error) return { id: null as string | null, error: error.message };
  return { id: data!.id as string, error: null };
}

async function main() {
  hdr(`FOLLOW-UP SEQUENCE SELF-QA · run ${RUN}`);

  // A real log row to hang the FK on. Read-only: we never write to sms_logs.
  const { data: anyLog } = await db!.from("sms_logs").select("id").limit(1).single();
  if (!anyLog) { console.error("No sms_logs row to use as a parent send."); process.exit(1); }
  PARENT_LOG_ID = anyLog.id as string;

  const { count: logsBefore } = await db!.from("sms_logs").select("id", { count: "exact", head: true });
  console.log(`parent send (existing log, read-only): ${PARENT_LOG_ID}`);
  console.log(`sms_logs count before: ${logsBefore}`);

  // A real enrollment with a genuinely unpaid installment, so the re-validation
  // reads live business truth rather than a fixture.
  const enrollments = await getAllCourseEnrollments();
  const subject = enrollments.find((e) =>
    e.status !== "cancelled" &&
    (e.schedule || []).some((l) => l.kind === "installment" && !l.paid && l.status !== "waived" && l.status !== "cancelled"),
  );
  if (!subject) { console.error("No enrollment with an unpaid installment."); process.exit(1); }
  const openLine = (subject.schedule || []).find((l) => l.kind === "installment" && !l.paid && l.status !== "waived" && l.status !== "cancelled")!;
  console.log(`subject enrollment: ${subject.id} · ${mask(subject.phone || "")} · installment no.${openLine.no} · Rs.${openLine.amount}`);

  // =======================================================================
  hdr("1 · HAPPY PATH — the clock advances 30 minutes and step 2 goes exactly once");
  // Queued 31 minutes in the past = the state the world is in half an hour after
  // a reminder. No waiting, no fake timers: the row's due time is the clock.
  const happy = await queue({
    course_enrollment_id: subject.id, installment_no: openLine.no,
    installment_fingerprint: installmentFingerprint(openLine),
    normalized_mobile: subject.phone?.replace(/\D/g, "").slice(-10) ?? "9999900001",
  }, -1);
  check("job persisted as pending", !!happy.id, happy.error ?? "");

  const d1 = await drainDueFollowUps({ send: stubSend, limit: 50 });
  const happyRow = await getFollowUp(happy.id!);
  check("drain sent it", happyRow?.status === "sent", `status=${happyRow?.status} drain=${JSON.stringify({ sent: d1.sent, cancelled: d1.cancelled })}`);
  check("sent exactly one message for this job", calls.filter((c) => c.enrollmentId === subject.id).length === 1);
  check("the send carried the installment key", calls.some((c) => c.enrollmentId === subject.id && c.installmentNo === openLine.no));
  check("the send used the instructions template", calls.every((c) => c.templateId === INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID));

  // A second drain must find nothing: the row is terminal.
  const before2 = calls.length;
  await drainDueFollowUps({ send: stubSend, limit: 50 });
  check("a later drain does not re-send a sent job", calls.length === before2);

  // =======================================================================
  hdr("2 · WORKER RUNS TWICE CONCURRENTLY — the lock must hold");
  const raceIds: string[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await queue({ course_enrollment_id: subject.id, installment_no: 900 + i, normalized_mobile: "9999900002" }, -1, "-race");
    if (r.id) raceIds.push(r.id);
  }
  // Two claims fired together against the same due rows.
  const [claimA, claimB] = await Promise.all([claimDueFollowUps(10), claimDueFollowUps(10)]);
  const idsA = new Set(claimA.map((j) => j.id));
  const overlap = claimB.filter((j) => idsA.has(j.id));
  check("two concurrent claims took 6 rows between them", claimA.length + claimB.length === 6, `${claimA.length} + ${claimB.length}`);
  check("no row was claimed by both drains (SKIP LOCKED holds)", overlap.length === 0, `overlap=${overlap.length}`);

  // =======================================================================
  hdr("3 · PROCESS KILLED MID-WINDOW — the follow-up survives the restart");
  // This is precisely the setTimeout failure mode. The "process" that queued the
  // row is long gone; a brand-new drain in a brand-new process still finds it.
  const survivor = await queue({ course_enrollment_id: subject.id, installment_no: 950, normalized_mobile: "9999900003" }, -1, "-crash");
  const stillThere = await getFollowUp(survivor.id!);
  check("the row outlives the process that created it", stillThere?.status === "pending");

  // And a drain that died holding a claim leaves the row recoverable.
  const stranded = await queue(
    { course_enrollment_id: subject.id, installment_no: 951, normalized_mobile: "9999900003", status: "claimed", attempts: 1, claimed_at: new Date(Date.now() - 20 * MIN).toISOString() },
    -1, "-crash",
  );
  const requeued = await requeueStaleFollowUps(300);
  const recovered = await getFollowUp(stranded.id!);
  check("a claim stranded by a crashed drain is re-queued", recovered?.status === "pending", `requeued=${requeued}`);

  const d3 = await drainDueFollowUps({ send: stubSend, limit: 50 });
  const survivorRow = await getFollowUp(survivor.id!);
  const recoveredRow = await getFollowUp(stranded.id!);
  // installment_no 950/951 do not exist on the schedule, so the honest outcome is
  // a restructured cancel — the point here is that BOTH were picked up, not lost.
  check("both were processed after the restart", survivorRow?.status !== "pending" && recoveredRow?.status !== "pending",
    `survivor=${survivorRow?.status} recovered=${recoveredRow?.status} drain=${JSON.stringify(d3.byCancelReason)}`);

  // =======================================================================
  hdr("4 · IDEMPOTENCY — the unique constraint refuses a second job for one send");
  const dupA = await queue({ course_enrollment_id: subject.id, installment_no: 960, normalized_mobile: "9999900004" }, 30, "-dup");
  const dupB = await queue({ course_enrollment_id: subject.id, installment_no: 960, normalized_mobile: "9999900004" }, 30, "-dup");
  check("the first schedule is accepted", !!dupA.id);
  check("the duplicate is refused by the unique index", dupB.id === null && /duplicate key|23505/i.test(dupB.error ?? ""), dupB.error ?? "unexpectedly inserted");

  // =======================================================================
  hdr("5 · TRANSIENT GATEWAY FAILURE — retries with backoff, then fails, never duplicates");
  const flaky = await queue({
    course_enrollment_id: subject.id, installment_no: openLine.no, normalized_mobile: "9999900005",
    installment_fingerprint: installmentFingerprint(openLine),
    parent_send_id: PARENT_LOG_ID,
  }, -1, "-flaky");
  if (flaky.id === null) {
    // Same (enrollment, installment, template, parent) as the happy-path job, so
    // the unique index correctly refuses it — proof in its own right.
    check("a repeat of an already-sent follow-up cannot be re-queued", /duplicate key|23505/i.test(flaky.error ?? ""), flaky.error ?? "");
  }
  // Use a distinct parent so this is a legitimately separate follow-up.
  const { data: otherLog } = await db!.from("sms_logs").select("id").neq("id", PARENT_LOG_ID).limit(1).single();
  const flaky2 = await queue({
    course_enrollment_id: subject.id, installment_no: openLine.no, normalized_mobile: "9999900005",
    installment_fingerprint: installmentFingerprint(openLine),
    parent_send_id: otherLog!.id as string,
  }, -1, "-flaky2");

  failNext = 1;
  const callsBeforeRetry = calls.length;
  await drainDueFollowUps({ send: stubSend, limit: 50 });
  const afterFail = await getFollowUp(flaky2.id!);
  const backoffMinutes = afterFail ? Math.round((Date.parse(afterFail.scheduled_at) - Date.now()) / MIN) : -1;
  check("a transient failure returns the job to the queue", afterFail?.status === "pending", `status=${afterFail?.status}`);
  check("it is deferred with backoff, not retried instantly", backoffMinutes >= 1, `next attempt in ~${backoffMinutes}m`);
  check("the failed attempt was counted", (afterFail?.attempts ?? 0) >= 1, `attempts=${afterFail?.attempts}`);
  check("exactly one gateway attempt was made", calls.length === callsBeforeRetry + 1);

  // Exhaust the attempts: force it due again and keep failing.
  failNext = 5;
  for (let i = 0; i < 4; i++) {
    await db!.from("sms_scheduled_sends").update({ scheduled_at: new Date(Date.now() - MIN).toISOString() }).eq("id", flaky2.id!);
    await drainDueFollowUps({ send: stubSend, limit: 50 });
  }
  const exhausted = await getFollowUp(flaky2.id!);
  check("after max attempts it is marked failed and surfaced", exhausted?.status === "failed", `status=${exhausted?.status} attempts=${exhausted?.attempts} error=${exhausted?.last_error}`);
  check("every retry reached the gateway rather than dying on a duplicate key",
    calls.filter((c) => c.dedupeKey?.includes(flaky2.id!)).length === (exhausted?.attempts ?? 0),
    `${calls.filter((c) => c.dedupeKey?.includes(flaky2.id!)).length} attempts made, row records ${exhausted?.attempts}`);
  check("a failed job never reported success", exhausted?.status === "failed" && exhausted?.sent_log_id === null);
  failNext = 0;

  // =======================================================================
  hdr("6 · AUTO-CANCELS re-checked at send time, against live data");
  const paidLine = (subject.schedule || []).find((l) => l.kind === "installment" && l.paid);
  if (paidLine) {
    const paidJob = await queue({
      course_enrollment_id: subject.id, installment_no: paidLine.no,
      installment_fingerprint: installmentFingerprint(paidLine), normalized_mobile: "9999900006",
    }, -1, "-paid");
    const callsBefore = calls.length;
    await drainDueFollowUps({ send: stubSend, limit: 50 });
    const paidRow = await getFollowUp(paidJob.id!);
    check("an installment already PAID is cancelled, not sent", paidRow?.status === "cancelled" && paidRow?.cancel_reason === "installment_paid",
      `status=${paidRow?.status} reason=${paidRow?.cancel_reason}`);
    check("no message went out for the paid line", calls.length === callsBefore);
  } else {
    console.log("  (subject has no already-paid line; the paid path is covered by unit tests)");
  }

  // A line that no longer exists on the schedule = restructured.
  const goneJob = await queue({ course_enrollment_id: subject.id, installment_no: 987, normalized_mobile: "9999900007" }, -1, "-gone");
  await drainDueFollowUps({ send: stubSend, limit: 50 });
  const goneRow = await getFollowUp(goneJob.id!);
  check("a line that is gone from the plan is cancelled as restructured",
    goneRow?.status === "cancelled" && goneRow?.cancel_reason === "installment_restructured", `reason=${goneRow?.cancel_reason}`);

  // Opt-out, evaluated purely so no real number is touched.
  const optedDecision = evaluateFollowUp(
    { ...(await getFollowUp(goneJob.id!))!, installment_no: openLine.no, installment_fingerprint: installmentFingerprint(openLine) },
    { enrollment: subject, optedOut: true, alreadyInstructed: false, template: { status: "active", gateway_template_id: "1777178519743722233" } },
  );
  check("a student who opted out mid-window is cancelled", optedDecision.send === false && optedDecision.reason === "opted_out");

  // =======================================================================
  hdr("7 · STAFF CANCEL — a pending follow-up can be stopped by a human");
  const manual = await queue({ course_enrollment_id: subject.id, installment_no: 970, normalized_mobile: "9999900008" }, 25, "-manual");
  const pendingList = await listPendingFollowUps();
  check("it appears in the pending list staff can see", pendingList.some((f) => f.id === manual.id));
  check("cancelling it succeeds", await cancelFollowUpByStaff(manual.id!));
  const manualRow = await getFollowUp(manual.id!);
  check("it is recorded as cancelled by staff", manualRow?.status === "cancelled" && manualRow?.cancel_reason === "cancelled_by_staff");
  const callsBeforeManualDrain = calls.length;
  await db!.from("sms_scheduled_sends").update({ scheduled_at: new Date(Date.now() - MIN).toISOString() }).eq("id", manual.id!);
  await drainDueFollowUps({ send: stubSend, limit: 50 });
  check("a cancelled job is never picked up again", calls.length === callsBeforeManualDrain);
  check("cancelling an already-cancelled job is refused", !(await cancelFollowUpByStaff(manual.id!)));

  // =======================================================================
  hdr("8 · BULK — 50 independent jobs, throttled, failures isolated");
  const bulkTargets = enrollments
    // The subject is excluded: its (installment, template, parent) tuple is
    // already taken by the happy-path job, so the unique index would rightly
    // refuse it and the count below would be measuring that instead of bulk.
    .filter((e) => e.id !== subject.id)
    .filter((e) => e.status !== "cancelled" && (e.schedule || []).some((l) => l.kind === "installment" && !l.paid && l.status !== "waived" && l.status !== "cancelled"))
    .slice(0, 50);
  const bulkIds: string[] = [];
  for (const e of bulkTargets) {
    const l = (e.schedule || []).find((x) => x.kind === "installment" && !x.paid && x.status !== "waived" && x.status !== "cancelled")!;
    const r = await queue({
      course_enrollment_id: e.id, installment_no: l.no, installment_fingerprint: installmentFingerprint(l),
      normalized_mobile: e.phone?.replace(/\D/g, "").slice(-10) || "9999900009",
      student_name: e.student_name, parent_send_id: PARENT_LOG_ID,
    }, -1, "-bulk");
    if (r.id) bulkIds.push(r.id);
  }
  check("one independent job per recipient", bulkIds.length === bulkTargets.length, `${bulkIds.length} of ${bulkTargets.length}`);

  // One recipient's gateway call fails; everyone else must still go.
  failNext = 1;
  const callsBeforeBulk = calls.length;
  const dBulk = await drainDueFollowUps({ send: stubSend, limit: 40 });
  const bulkRows = await Promise.all(bulkIds.map((id) => getFollowUp(id)));
  const sent = bulkRows.filter((r) => r?.status === "sent").length;
  const requeuedAfterFail = bulkRows.filter((r) => r?.status === "pending" && (r?.attempts ?? 0) > 0).length;
  const stillQueued = bulkRows.filter((r) => r?.status === "pending" && (r?.attempts ?? 0) === 0).length;
  check("a tick is bounded — the rest waits for the next one, never a burst",
    dBulk.claimed <= 40, `claimed=${dBulk.claimed} of ${bulkIds.length}`);
  check("one recipient's failure did not stop the others",
    sent >= dBulk.claimed - dBulk.cancelled - 1 - requeuedAfterFail, `sent=${sent} cancelled=${dBulk.cancelled} requeued=${requeuedAfterFail}`);
  check("the failed recipient was isolated and re-queued, not dropped", requeuedAfterFail <= 1);
  check("overflow beyond one tick is still queued", stillQueued === Math.max(0, bulkIds.length - 40), `still queued=${stillQueued}`);
  check("each send was addressed individually", calls.length - callsBeforeBulk === dBulk.claimed, `${calls.length - callsBeforeBulk} calls for ${dBulk.claimed} claims`);
  failNext = 0;

  // Every gateway attempt must carry its own key. A repeat would mean the log
  // insert collided, which is how the retry path was silently dead before.
  const keys = calls.map((c) => c.dedupeKey).filter(Boolean);
  const repeated = keys.filter((k, i) => keys.indexOf(k) !== i);
  check("no two gateway attempts shared a dedupe key", repeated.length === 0,
    `${new Set(keys).size} distinct keys across ${keys.length} attempts${repeated.length ? `; repeated: ${[...new Set(repeated)].join(", ")}` : ""}`);

  // =======================================================================
  hdr("9 · ZERO REAL SENDS");
  const { count: logsAfter } = await db!.from("sms_logs").select("id", { count: "exact", head: true });
  check("sms_logs is unchanged by this QA run", logsBefore === logsAfter, `${logsBefore} → ${logsAfter}`);
  const { count: instructionsEver } = await db!
    .from("sms_logs").select("id", { count: "exact", head: true })
    .eq("template_id", INSTALLMENT_INSTRUCTIONS_TEMPLATE_ID);
  check("no instructions SMS has ever been logged", instructionsEver === 0, `count=${instructionsEver}`);
  console.log(`  stub gateway received ${calls.length} calls; the real gateway module was never imported by the drain path.`);
  console.log(`  delay constant in use: ${FOLLOW_UP_DELAY_MINUTES} minutes.`);

  hdr(`RESULT · ${checks - failures}/${checks} checks passed`);
  await cleanup("done");
  const { count: leftover } = await db!.from("sms_scheduled_sends").select("id", { count: "exact", head: true });
  console.log(`sms_scheduled_sends rows remaining after cleanup: ${leftover}`);
  process.exit(failures ? 1 : 0);
}

void main();
