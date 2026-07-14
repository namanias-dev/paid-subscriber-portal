/**
 * SAFETY PROOF for the Journey Automation execution engine (P3) + SMS adapter (P4).
 * These tests are the evidence that, with flags OFF, the engine SIMULATES and sends
 * NOTHING — and that all the durability/cancellation invariants hold.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runMatcher } from "../../lib/journey-automation/engine/matcher";
import { runWorker } from "../../lib/journey-automation/engine/worker";
import { checkEligibility } from "../../lib/journey-automation/engine/eligibility";
import { sendDecision, enrollmentModeFor, shouldProcess } from "../../lib/journey-automation/engine/mode";
import { evaluateGoal, shouldSuppressReminder, evaluateCondition } from "../../lib/journey-automation/engine/latestState";
import { backoffMs, isExhausted } from "../../lib/journey-automation/engine/backoff";
import { enrollmentDedupeKey, jobDedupeKey, sendIdempotencyKey } from "../../lib/journey-automation/engine/keys";
import {
  InMemoryPort, RecordingSender, ScriptedState, MutableClock,
  makeEvent, workflow, paymentReminderGraph, candidate,
} from "./engineFakes";

const ALL_FLAGS_ON = { executionEnabled: true, smsEnabled: true, promotionalEnabled: true };

function setup(execMode: "off" | "simulate" | "live" = "simulate") {
  const clock = new MutableClock(Date.parse("2026-07-14T06:00:00.000Z"));
  const wf = workflow({ execution_mode: execMode });
  const graph = paymentReminderGraph();
  const data = new InMemoryPort({
    candidatesByEvent: { installment_overdue: [candidate(wf, graph)] },
    graphsByVersion: { ver1: graph },
    workflowsById: { wf1: wf },
  }, clock);
  const sender = new RecordingSender();
  const state = new ScriptedState();
  return { clock, data, sender, state, wf, graph };
}

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------
describe("pure: eligibility ordering (fail-closed)", () => {
  const base = { normalizedPhone: "9876543210", phoneValid: true, optedOut: false, isStaffOrTest: false, alreadyEnrolledActive: false, alreadyConverted: false, canaryAllowed: true };
  it("invalid phone blocks first", () => assert.equal(checkEligibility({ ...base, phoneValid: false }).reason, "invalid_phone"));
  it("opted out blocks", () => assert.equal(checkEligibility({ ...base, optedOut: true }).reason, "opted_out"));
  it("staff/test blocks", () => assert.equal(checkEligibility({ ...base, isStaffOrTest: true }).reason, "staff_or_test"));
  it("already enrolled blocks", () => assert.equal(checkEligibility({ ...base, alreadyEnrolledActive: true }).reason, "already_enrolled"));
  it("already converted blocks", () => assert.equal(checkEligibility({ ...base, alreadyConverted: true }).reason, "already_converted"));
  it("canary excluded blocks", () => assert.equal(checkEligibility({ ...base, canaryAllowed: false }).reason, "canary_excluded"));
  it("clean → eligible", () => assert.equal(checkEligibility(base).eligible, true));
});

describe("pure: sendDecision is fail-closed", () => {
  it("simulate enrollment never goes live", () => assert.equal(sendDecision({ enrollmentMode: "simulate", killSwitchEngaged: false, category: "transactional", guardOverrides: ALL_FLAGS_ON, paymentRemindersEnabled: true }).live, false));
  it("live enrollment + flags off → simulate", () => assert.equal(sendDecision({ enrollmentMode: "live", killSwitchEngaged: false, category: "transactional", guardOverrides: { executionEnabled: false, smsEnabled: false } }).live, false));
  it("live + all flags on → live", () => assert.equal(sendDecision({ enrollmentMode: "live", killSwitchEngaged: false, category: "transactional", guardOverrides: ALL_FLAGS_ON, paymentRemindersEnabled: true }).live, true));
  it("payment_reminder needs its category flag", () => assert.equal(sendDecision({ enrollmentMode: "live", killSwitchEngaged: false, category: "payment_reminder", guardOverrides: ALL_FLAGS_ON, paymentRemindersEnabled: false }).reason, "payment_reminders_disabled"));
  it("kill switch forces simulate", () => assert.equal(sendDecision({ enrollmentMode: "live", killSwitchEngaged: true, category: "transactional", guardOverrides: ALL_FLAGS_ON, paymentRemindersEnabled: true }).live, false));
});

describe("pure: latest-state + goal + backoff + keys", () => {
  const paid = { paid: true, hasOverdue: false, optedOut: false, enrolledInCourse: true, registeredForWebinar: false, planPausedOrWaived: false };
  const overdue = { paid: false, hasOverdue: true, optedOut: false, enrolledInCourse: false, registeredForWebinar: false, planPausedOrWaived: false };
  it("goal met when paid", () => assert.equal(evaluateGoal("payment_completed", paid), true));
  it("goal not met when overdue", () => assert.equal(evaluateGoal("payment_completed", overdue), false));
  it("reminder suppressed once paid", () => assert.equal(shouldSuppressReminder("payment_reminder", paid).suppress, true));
  it("reminder suppressed when paused/waived", () => assert.equal(shouldSuppressReminder("payment_reminder", { ...overdue, planPausedOrWaived: true }).reason, "plan_paused_or_waived"));
  it("reminder allowed when genuinely overdue", () => assert.equal(shouldSuppressReminder("payment_reminder", overdue).suppress, false));
  it("condition evaluates latest state", () => assert.equal(evaluateCondition({ check: "is_paid" }, paid), true));
  it("backoff grows then caps + exhausts", () => { assert.ok(backoffMs(2) > backoffMs(1)); assert.equal(isExhausted(5, 5), true); assert.equal(isExhausted(4, 5), false); });
  it("keys are deterministic", () => { assert.equal(sendIdempotencyKey("e1", "n"), sendIdempotencyKey("e1", "n")); assert.equal(jobDedupeKey("e1", "n"), "job:e1:n"); assert.equal(enrollmentDedupeKey("v", "9", "ev"), "enroll:v:9:ev"); });
});

// ---------------------------------------------------------------------------
// Matcher — idempotency
// ---------------------------------------------------------------------------
describe("matcher: idempotent enrollment", () => {
  it("duplicate event → exactly one enrollment + one job", async () => {
    const { data, state, clock } = setup("simulate");
    const ev = makeEvent({ id: "evt_dup", event_type: "installment_overdue" });
    data.events.push(ev, { ...ev }); // same id twice (duplicate)
    await runMatcher(data, state, clock);
    // second drain (re-processing) must not create a second enrollment
    data.events.forEach((e) => ((e as { processed_at?: string }).processed_at = undefined));
    await runMatcher(data, state, clock);
    assert.equal(data.enrollments.length, 1);
    assert.equal(data.jobs.filter((j) => j.node_key === "n_wait").length, 1);
  });
});

// ---------------------------------------------------------------------------
// Flags OFF → SIMULATION sends NOTHING
// ---------------------------------------------------------------------------
describe("flags OFF → simulation only (no chokepoint call)", () => {
  it("SMS node is simulated; SenderPort is NEVER called", async () => {
    const { data, sender, state, clock } = setup("simulate");
    state.latest = { paid: false, hasOverdue: true, optedOut: false, enrolledInCourse: false, registeredForWebinar: false, planPausedOrWaived: false };
    data.events.push(makeEvent());
    await runMatcher(data, state, clock);

    // wait → condition(no) → sms(simulated) → exit
    for (let i = 0; i < 6; i++) {
      await runWorker(data, sender, state, clock);
      const pending = data.activeJobs();
      if (!pending.length) break;
      clock.set(Math.min(...pending.map((j) => new Date(j.scheduled_for).getTime())));
    }
    assert.equal(sender.calls.length, 0, "chokepoint must NOT be called in simulation");
    const smsRun = data.nodeRuns.find((r) => r.node_key === "n_sms");
    assert.ok(smsRun, "sms node run recorded");
    assert.equal(smsRun!.status, "simulated");
    assert.equal((smsRun!.outcome as Record<string, unknown>).would_send, true);
  });
});

// ---------------------------------------------------------------------------
// Payment during a wait → reminder cancelled (the headline safety test)
// ---------------------------------------------------------------------------
describe("paid during wait → pending reminder cancelled, no 'please pay' after paying", () => {
  it("goal-stop cancels the queued reminder before it can send", async () => {
    const { data, sender, state, clock } = setup("live"); // even in LIVE the payment must stop it
    state.latest = { paid: false, hasOverdue: true, optedOut: false, enrolledInCourse: false, registeredForWebinar: false, planPausedOrWaived: false };
    data.events.push(makeEvent());
    await runMatcher(data, state, clock);

    // tick 1: execute the wait → schedules the condition/reminder path for later
    await runWorker(data, sender, state, clock, { guardOverrides: ALL_FLAGS_ON, paymentRemindersEnabled: true });

    // student pays during the wait
    state.latest = { ...state.latest, paid: true, hasOverdue: false };

    // advance past the wait and run: revalidation must catch the payment → goal_met
    const pending = data.activeJobs();
    clock.set(Math.min(...pending.map((j) => new Date(j.scheduled_for).getTime())));
    await runWorker(data, sender, state, clock, { guardOverrides: ALL_FLAGS_ON, paymentRemindersEnabled: true });

    assert.equal(sender.calls.length, 0, "no reminder sent after payment");
    assert.equal(data.goals.length, 1, "conversion recorded");
    const enr = data.enrollments[0];
    assert.equal(enr.status, "goal_met");
    assert.equal(data.activeJobs().length, 0, "all pending jobs cancelled");
    assert.ok(!data.nodeRuns.find((r) => r.node_key === "n_sms"), "reminder node never executed");
  });
});

// ---------------------------------------------------------------------------
// Suppression on latest-state recheck (plan paused / waiver)
// ---------------------------------------------------------------------------
describe("plan paused / waiver → overdue reminder suppressed", () => {
  it("records suppression, sends nothing, continues to exit", async () => {
    const { data, sender, state, clock } = setup("live");
    state.latest = { paid: false, hasOverdue: true, optedOut: false, enrolledInCourse: true, registeredForWebinar: false, planPausedOrWaived: true };
    data.events.push(makeEvent());
    await runMatcher(data, state, clock);
    for (let i = 0; i < 6; i++) {
      await runWorker(data, sender, state, clock, { guardOverrides: ALL_FLAGS_ON, paymentRemindersEnabled: true });
      const pending = data.activeJobs();
      if (!pending.length) break;
      clock.set(Math.min(...pending.map((j) => new Date(j.scheduled_for).getTime())));
    }
    assert.equal(sender.calls.length, 0);
    const smsRun = data.nodeRuns.find((r) => r.node_key === "n_sms");
    assert.equal(smsRun?.status, "suppressed");
    assert.ok(data.suppressions.some((s) => String(s.reason).includes("plan_paused_or_waived")));
  });
});

// ---------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------
describe("kill switch halts everything", () => {
  it("matcher enrolls nobody and worker sends nothing", async () => {
    const { data, sender, state, clock } = setup("live");
    data.settings = { killSwitchEngaged: true, pausedCategories: [] };
    data.events.push(makeEvent());
    const m = await runMatcher(data, state, clock);
    assert.equal(m.halted, "kill_switch");
    assert.equal(data.enrollments.length, 0);
    const w = await runWorker(data, sender, state, clock, { guardOverrides: ALL_FLAGS_ON, paymentRemindersEnabled: true });
    assert.equal(w.halted, "kill_switch");
    assert.equal(sender.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// LIVE send path (all flags on) — one send, idempotent, via SenderPort only
// ---------------------------------------------------------------------------
describe("live mode: single send via chokepoint, idempotent", () => {
  it("sends once with idempotencyKey; re-run does not double-send", async () => {
    const { data, sender, state, clock } = setup("live");
    state.latest = { paid: false, hasOverdue: true, optedOut: false, enrolledInCourse: false, registeredForWebinar: false, planPausedOrWaived: false };
    data.events.push(makeEvent());
    await runMatcher(data, state, clock);
    const opts = { guardOverrides: ALL_FLAGS_ON, paymentRemindersEnabled: true };
    for (let i = 0; i < 6; i++) {
      await runWorker(data, sender, state, clock, opts);
      const pending = data.activeJobs();
      if (!pending.length) break;
      clock.set(Math.min(...pending.map((j) => new Date(j.scheduled_for).getTime())));
    }
    assert.equal(sender.calls.length, 1, "exactly one real send");
    const enr = data.enrollments[0];
    assert.equal(sender.calls[0].dedupeKey, sendIdempotencyKey(enr.id, "n_sms"));
    assert.equal(sender.calls[0].mobile, "9876543210");
    // Re-run the whole worker: idempotent node-run means no second send.
    await runWorker(data, sender, state, clock, opts);
    assert.equal(sender.calls.length, 1, "no double-send on re-run");
  });
});

// ---------------------------------------------------------------------------
// Retry / backoff / dead-letter + crash recovery
// ---------------------------------------------------------------------------
describe("retry/backoff, dead-letter, crash recovery", () => {
  it("provider failure retries then dead-letters", async () => {
    const { data, sender, state, clock } = setup("live");
    sender.failWith = "provider_500";
    state.latest = { paid: false, hasOverdue: true, optedOut: false, enrolledInCourse: false, registeredForWebinar: false, planPausedOrWaived: false };
    data.events.push(makeEvent());
    await runMatcher(data, state, clock);
    const opts = { guardOverrides: ALL_FLAGS_ON, paymentRemindersEnabled: true };
    // force the sms job to reach max attempts quickly
    let deadReached = false;
    for (let i = 0; i < 30; i++) {
      await runWorker(data, sender, state, clock, opts);
      const sms = data.jobByNode("n_sms");
      if (sms?.status === "dead") { deadReached = true; break; }
      // advance to the next scheduled time (covers wait + backoff reschedules)
      const pending = data.activeJobs();
      if (!pending.length) break;
      clock.set(Math.max(clock.now() + 1, Math.min(...pending.map((j) => new Date(j.scheduled_for).getTime()))));
    }
    assert.equal(deadReached, true, "failing send eventually dead-letters");
    assert.equal(sender.calls.length >= 5, true, "retried multiple times before dead-letter");
  });

  it("crash recovery re-queues a stuck running job", async () => {
    const { data, state, clock } = setup("simulate");
    data.events.push(makeEvent());
    await runMatcher(data, state, clock);
    const job = data.jobs.find((j) => j.node_key === "n_wait")!;
    // simulate a crash mid-run: mark it running with an old start time
    job.status = "running";
    (data as unknown as { jobStart: Record<string, number> }).jobStart = { [job.id]: clock.now() - 60 * 60_000 };
    const requeued = await data.requeueStaleJobs(10 * 60_000);
    assert.equal(requeued, 1);
    assert.equal(data.jobs.find((j) => j.id === job.id)!.status, "queued");
  });
});

// ---------------------------------------------------------------------------
// Timezone-aware / duration wait
// ---------------------------------------------------------------------------
describe("wait scheduling", () => {
  it("schedules the next node after the configured delay (2 days)", async () => {
    const { data, sender, state, clock } = setup("simulate");
    data.events.push(makeEvent());
    await runMatcher(data, state, clock);
    const t0 = clock.now();
    await runWorker(data, sender, state, clock); // executes the wait node
    const condJob = data.jobByNode("n_cond");
    assert.ok(condJob, "next job scheduled after wait");
    const delta = new Date(condJob!.scheduled_for).getTime() - t0;
    assert.equal(delta, 2 * 86_400_000, "waited exactly 2 days");
  });
});

// ---------------------------------------------------------------------------
// Category pause + per-workflow off
// ---------------------------------------------------------------------------
describe("category pause + execution off", () => {
  it("execution_mode off → matcher enrolls nobody", async () => {
    const { data, state, clock } = setup("off");
    data.events.push(makeEvent());
    // 'off' workflows are excluded from candidates in the real port; emulate that:
    (data.cfg.candidatesByEvent as Record<string, unknown[]>).installment_overdue = [];
    const m = await runMatcher(data, state, clock);
    assert.equal(m.enrolled, 0);
    assert.equal(data.enrollments.length, 0);
    assert.equal(shouldProcess("off", false), "off");
    assert.equal(enrollmentModeFor("off"), "simulate");
  });

  it("paused category suppresses the send", async () => {
    const { data, sender, state, clock } = setup("live");
    data.settings = { killSwitchEngaged: false, pausedCategories: ["payment_reminder"] };
    state.latest = { paid: false, hasOverdue: true, optedOut: false, enrolledInCourse: false, registeredForWebinar: false, planPausedOrWaived: false };
    data.events.push(makeEvent());
    await runMatcher(data, state, clock);
    for (let i = 0; i < 6; i++) {
      await runWorker(data, sender, state, clock, { guardOverrides: ALL_FLAGS_ON, paymentRemindersEnabled: true });
      const pending = data.activeJobs();
      if (!pending.length) break;
      clock.set(Math.min(...pending.map((j) => new Date(j.scheduled_for).getTime())));
    }
    assert.equal(sender.calls.length, 0);
    assert.ok(data.suppressions.some((s) => String(s.reason).includes("category_paused")));
  });
});
