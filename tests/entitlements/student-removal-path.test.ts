import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decideRemovalPath } from "../../lib/studentRemoval";

describe("student removal path", () => {
  test("zero money history is hard delete", () => {
    const r = decideRemovalPath({ paymentCount: 0, proofCount: 0, enrollmentPaidSignals: 0 });
    assert.equal(r.path, "hard_delete");
  });
  test("any payment row archives", () => {
    assert.equal(decideRemovalPath({ paymentCount: 1, proofCount: 0, enrollmentPaidSignals: 0 }).path, "archive");
  });
  test("enrolment paid without payment row still archives", () => {
    assert.equal(decideRemovalPath({ paymentCount: 0, proofCount: 0, enrollmentPaidSignals: 1 }).path, "archive");
  });
});
