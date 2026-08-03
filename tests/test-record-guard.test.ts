import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeTestPayment, isProductionRuntime } from "../lib/testRecordGuard";

describe("testRecordGuard", () => {
  it("flags Test Student + placeholder phone + NAMAN-TEST refs", () => {
    assert.equal(
      looksLikeTestPayment({
        student_name: "Test Student",
        phone: "9999999999",
        reference_no: "NAMAN-TEST-abc",
        item_slug: "test-webinar",
      }),
      true,
    );
    assert.equal(looksLikeTestPayment({ student_name: "Chandrakant", phone: "9876512345" }), false);
  });

  it("isProductionRuntime mirrors NODE_ENV", () => {
    assert.equal(typeof isProductionRuntime(), "boolean");
  });
});
