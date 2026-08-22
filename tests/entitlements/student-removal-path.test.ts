import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decideRemovalPath } from "../../lib/studentRemoval";
import { isArchivedStudent } from "../../lib/archivedStudents";

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
  test("notes marker does not archive", () => {
    assert.equal(isArchivedStudent({ notes: "⟦ARCHIVED⟧oops", archived_at: null }), false);
  });
  test("archived_at column archives", () => {
    assert.equal(isArchivedStudent({ notes: "free text", archived_at: "2026-08-22T00:00:00.000Z" }), true);
  });
});
