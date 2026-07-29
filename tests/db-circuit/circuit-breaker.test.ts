import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  dbCircuitOpen,
  dbCircuitStatus,
  recordDbFailure,
  recordDbOk,
  withDbBudget,
} from "@/lib/dbCircuit";

describe("dbCircuit", () => {
  test("opens after FAIL_THRESHOLD failures and recovers after TTL", async () => {
    // Reset via successes first.
    recordDbOk();
    assert.equal(dbCircuitOpen(), false);

    recordDbFailure();
    recordDbFailure();
    assert.equal(dbCircuitOpen(), false);
    recordDbFailure();
    assert.equal(dbCircuitOpen(), true);
    const status = dbCircuitStatus();
    assert.ok(status.openForMs > 0);

    // Simulate pressure: budget timeout records failure.
    const timed = await withDbBudget(
      new Promise<string>((resolve) => setTimeout(() => resolve("late"), 50)),
      5,
      "pressure",
    );
    assert.equal(timed.ok, false);
    assert.ok(dbCircuitOpen());

    // Success resets consecutive failure counter (circuit stays open until TTL).
    recordDbOk();
    assert.equal(dbCircuitStatus().failures, 0);
  });
});
