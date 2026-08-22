import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { gateQuiz, type Learner } from "../../lib/entitlements";
import type { Course, Quiz } from "../../lib/types";

const LIVE_SAFALTA = "61425007-6662-4864-88cf-12ca96db8b82";

const safalta = {
  id: LIVE_SAFALTA,
  slug: "full-gs-foundation-safalta-batch-for-upsc-cse-2027-28-september-2026",
  title: "Full GS Foundation SAFALTA BATCH",
  entitlements: { recorded: true },
} as Course;

const quiz = {
  id: "q1",
  slug: "economy-quiz-goods-and-services",
  requires_payment: true,
  requires_login: true,
  access_rules: { allowed_course_ids: ["co-safalta"] },
} as Quiz;

function learner(courseIds: string[]): Learner {
  return {
    studentId: "s1",
    phone: "9811398622",
    name: "Walkin",
    email: null,
    courseIds,
    hasPlan: false,
    blocked: false,
    kind: "buyer",
  };
}

describe("gateQuiz foundation live UUID vs stale demo id", () => {
  test("fully-paid Safalta enrollee is allowed even when the quiz list still has co-safalta", () => {
    const gate = gateQuiz(quiz, learner([LIVE_SAFALTA]), [safalta]);
    assert.equal(gate.allowed, true);
    assert.equal(gate.reason, "ok");
    assert.ok(gate.unlockCourseIds.includes(LIVE_SAFALTA));
  });

  test("no enrolment still payment-locks a paid quiz", () => {
    const gate = gateQuiz(quiz, learner([]), [safalta]);
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, "payment");
  });
});
