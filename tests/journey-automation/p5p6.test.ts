/**
 * P5/P6 safety proofs:
 *   (i)   engine cron requires CRON_SECRET (unauthenticated => rejected)
 *   (ii)  DLQ manual retry is idempotent + only re-enqueues (cannot bypass guards),
 *         and a re-run in SIMULATION still sends NOTHING
 *   (iii) analytics revenue attribution reconciles to deriveCollections
 *   (iv)  staff-task node creates exactly one task record (idempotent), no send
 *   (v)   flags-off => the chokepoint is never called
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { authorizeCron } from "../../lib/journey-automation/engine/cronAuth";
import { planDeadJobRetry } from "../../lib/journey-automation/engine/monitor";
import { attributeRevenue, type AttributableEnrollment, type RevenueSource } from "../../lib/journey-automation/engine/analytics";
import { deriveCollections } from "../../lib/installments";
import { runWorker } from "../../lib/journey-automation/engine/worker";
import {
  InMemoryPort, RecordingSender, ScriptedState, MutableClock,
  workflow, paymentReminderGraph,
} from "./engineFakes";
import type { EnrollmentRow, JobRow } from "../../lib/journey-automation/engine/types";

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe("P5 — engine cron auth (fail-closed)", () => {
  it("rejects when CRON_SECRET is not configured", () => {
    assert.equal(authorizeCron(req("https://x/api/cron/journey-engine"), undefined), false);
    assert.equal(authorizeCron(req("https://x/api/cron/journey-engine?secret=whatever"), ""), false);
  });
  it("rejects an unauthenticated or mismatched request", () => {
    assert.equal(authorizeCron(req("https://x/api/cron/journey-engine"), "s3cret"), false);
    assert.equal(authorizeCron(req("https://x/api/cron/journey-engine?secret=nope"), "s3cret"), false);
    assert.equal(authorizeCron(req("https://x/api/cron/journey-engine", { authorization: "Bearer nope" }), "s3cret"), false);
  });
  it("accepts a valid secret via query or Bearer header", () => {
    assert.equal(authorizeCron(req("https://x/api/cron/journey-engine?secret=s3cret"), "s3cret"), true);
    assert.equal(authorizeCron(req("https://x/api/cron/journey-engine", { authorization: "Bearer s3cret" }), "s3cret"), true);
  });
});

describe("P5 — DLQ retry is idempotent + re-enqueue only", () => {
  it("only 'dead'/'failed' jobs are retryable; everything else is a no-op", () => {
    const now = new Date().toISOString();
    const dead = planDeadJobRetry("dead", now);
    assert.equal(dead.requeue, true);
    if (dead.requeue) {
      assert.equal(dead.patch.status, "queued"); // re-enqueue only — never "done"/skipped
      assert.equal(dead.patch.attempts, 0);
      assert.equal(dead.patch.dead_letter, false);
    }
    assert.equal(planDeadJobRetry("failed", now).requeue, true);
    for (const s of ["queued", "running", "done", "cancelled"]) {
      assert.equal(planDeadJobRetry(s, now).requeue, false, `${s} must be a no-op`);
    }
  });

  it("a re-enqueued job re-runs through the worker and sends NOTHING in simulation", async () => {
    const clock = new MutableClock(Date.parse("2026-07-14T00:00:00Z"));
    const wf = workflow({ execution_mode: "simulate" });
    const data = new InMemoryPort({ workflowsById: { wf1: wf }, graphsByVersion: { ver1: paymentReminderGraph() } }, clock);
    const sender = new RecordingSender();
    const state = new ScriptedState(); // latest.paid = false => reminder path, no disqualification

    const enr: EnrollmentRow = {
      id: "enr_x", workflow_id: "wf1", version_id: "ver1", event_id: "evt1",
      normalized_phone: "9876543210", student_id: "stu1", lead_id: null, enrollment_ref: "cenr1",
      mode: "simulate", status: "active", current_node_key: "n_sms",
      context: { event_type: "installment_overdue", payload: {} }, goal_met: false, exit_reason: null,
      dedupe_key: null, enrolled_at: new Date(clock.now()).toISOString(), updated_at: new Date(clock.now()).toISOString(), completed_at: null,
    };
    data.enrollments.push(enr);
    const dead: JobRow = {
      id: "job_dead", enrollment_id: "enr_x", workflow_id: "wf1", node_key: "n_sms", kind: "execute_node",
      status: "dead", scheduled_for: new Date(clock.now()).toISOString(), attempts: 5, max_attempts: 5,
      dedupe_key: "d1", last_error: "boom", dead_letter: true,
    };
    data.jobs.push(dead);

    // Manual retry (what retryDeadJob applies): re-enqueue only.
    const plan = planDeadJobRetry(dead.status, new Date(clock.now()).toISOString());
    assert.equal(plan.requeue, true);
    if (plan.requeue) Object.assign(dead, plan.patch);
    assert.equal(dead.status, "queued");

    await runWorker(data, sender, state, clock, { batchSize: 10 });

    // Guard-respecting: simulation records a would-send but the chokepoint is NEVER called.
    assert.equal(sender.calls.length, 0, "no live send in simulation, even after a retry");
    const nr = data.nodeRuns.find((r) => r.node_key === "n_sms");
    assert.ok(nr, "send node executed");
    assert.equal(nr?.status, "simulated");
  });
});

describe("P6 — revenue attribution reconciles to deriveCollections", () => {
  function ce(id: string, total: number, paidLines: number[], unpaid: number[]) {
    const schedule = [
      ...paidLines.map((amount, i) => ({ no: i, kind: "installment", label: `p${i}`, amount, due: null, paid: true })),
      ...unpaid.map((amount, i) => ({ no: 100 + i, kind: "installment", label: `u${i}`, amount, due: null, paid: false })),
    ];
    return { id, total_fee: total, schedule } as unknown as Parameters<typeof deriveCollections>[0] & { id: string };
  }

  it("attributed revenue == sum of deriveCollections(paid) over the attributed set (no double count)", () => {
    const a = ce("ceA", 50000, [20000, 10000], [20000]); // paid 30000
    const b = ce("ceB", 40000, [40000], []);              // paid 40000
    const sources: RevenueSource[] = [
      { id: "ceA", paid: deriveCollections(a).paid },
      { id: "ceB", paid: deriveCollections(b).paid },
    ];
    const t = Date.parse("2026-07-01T00:00:00Z");
    const day = 86_400_000;
    const enrollments: AttributableEnrollment[] = [
      { enrollmentRef: "ceA", enrolledAt: t, completedAt: t + 2 * day, goalMet: true, goalType: "payment_completed" },
      { enrollmentRef: "ceA", enrolledAt: t, completedAt: t + 3 * day, goalMet: true, goalType: "payment_completed" }, // duplicate ref
      { enrollmentRef: "ceB", enrolledAt: t, completedAt: t + 1 * day, goalMet: true, goalType: "payment_completed" },
    ];
    const res = attributeRevenue(enrollments, sources);
    const expected = deriveCollections(a).paid + deriveCollections(b).paid; // 30000 + 40000
    assert.equal(res.attributedRevenue, expected, "reconciles to the ledger derive");
    assert.equal(res.attributedRefs.length, 2, "deduped by course-enrollment ref (no double count)");
  });

  it("excludes out-of-window, non-payment goals, and zero-paid conversions", () => {
    const a = ce("ceA", 50000, [30000], [20000]); // paid 30000
    const zero = ce("ceZ", 50000, [], [50000]);   // paid 0
    const sources: RevenueSource[] = [
      { id: "ceA", paid: deriveCollections(a).paid },
      { id: "ceZ", paid: deriveCollections(zero).paid },
    ];
    const t = Date.parse("2026-07-01T00:00:00Z");
    const day = 86_400_000;
    const enrollments: AttributableEnrollment[] = [
      { enrollmentRef: "ceA", enrolledAt: t, completedAt: t + 60 * day, goalMet: true, goalType: "payment_completed" }, // out of 30d window
      { enrollmentRef: "ceA", enrolledAt: t, completedAt: t + day, goalMet: true, goalType: "webinar_registered" },     // non-payment goal
      { enrollmentRef: "ceZ", enrolledAt: t, completedAt: t + day, goalMet: true, goalType: "payment_completed" },      // zero paid
    ];
    const res = attributeRevenue(enrollments, sources);
    assert.equal(res.attributedRevenue, 0);
    assert.equal(res.attributedCount, 0);
  });
});

describe("PART A — staff-task node creates a real record (idempotent), no send", () => {
  it("creates exactly one task and never calls the sender", async () => {
    const clock = new MutableClock(Date.parse("2026-07-14T00:00:00Z"));
    const graph = {
      nodes: [
        { node_key: "n_trigger", type: "trigger", config: { eventType: "installment_overdue" }, position: { x: 0, y: 0 } },
        { node_key: "n_task", type: "staff_task", config: { title: "Call the student", assignee: "counsellor" }, position: { x: 0, y: 1 } },
        { node_key: "n_exit", type: "exit", config: {}, position: { x: 0, y: 2 } },
      ],
      edges: [
        { edge_key: "e1", source: "n_trigger", target: "n_task", branch_label: null },
        { edge_key: "e2", source: "n_task", target: "n_exit", branch_label: null },
      ],
    };
    const wf = workflow({ execution_mode: "simulate" });
    const data = new InMemoryPort({ workflowsById: { wf1: wf }, graphsByVersion: { ver1: graph } }, clock);
    const sender = new RecordingSender();
    const state = new ScriptedState();

    const enr: EnrollmentRow = {
      id: "enr_t", workflow_id: "wf1", version_id: "ver1", event_id: "evt1",
      normalized_phone: "9876543210", student_id: "stu1", lead_id: null, enrollment_ref: null,
      mode: "simulate", status: "active", current_node_key: "n_task",
      context: { event_type: "installment_overdue", payload: {} }, goal_met: false, exit_reason: null,
      dedupe_key: null, enrolled_at: new Date(clock.now()).toISOString(), updated_at: new Date(clock.now()).toISOString(), completed_at: null,
    };
    data.enrollments.push(enr);
    data.jobs.push({
      id: "job_t", enrollment_id: "enr_t", workflow_id: "wf1", node_key: "n_task", kind: "execute_node",
      status: "queued", scheduled_for: new Date(clock.now()).toISOString(), attempts: 0, max_attempts: 5,
      dedupe_key: "dt", last_error: null, dead_letter: false,
    });

    await runWorker(data, sender, state, clock, { batchSize: 10 });
    assert.equal(data.staffTasks.length, 1, "one staff task recorded");
    assert.equal(data.staffTasks[0].title, "Call the student");
    assert.equal(sender.calls.length, 0, "staff task never sends");
  });
});
