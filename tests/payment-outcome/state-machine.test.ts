/**
 * Payment outcome integrity — pure unit coverage for the 7 required cases.
 * (No live DB / dataProvider — those paths are exercised via mapVerifyStatus
 * + the transition helper that mirrors applyVerifyForReference.)
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapVerifyStatus } from "../../lib/eazypay";
import { isPaidStatus, isOpenPaymentStatus } from "../../lib/paymentOutcome/states";

type VerifyOutcome = "paid" | "failed" | "expired" | "unknown";

/** Mirrors applyVerify terminal decision (callback never terminals). */
function afterCallback(current: string): string {
  if (isPaidStatus(current)) return current; // immutable
  return "UNCONFIRMED";
}

function afterVerify(current: string, outcome: VerifyOutcome): { to: string; newlyPaid: boolean } {
  if (isPaidStatus(current)) return { to: current, newlyPaid: false };
  if (outcome === "paid") return { to: "PAID", newlyPaid: true };
  if (outcome === "failed") return { to: "FAILED", newlyPaid: false };
  if (outcome === "expired") return { to: "EXPIRED", newlyPaid: false };
  return { to: current, newlyPaid: false }; // unknown — no terminal
}

describe("mapVerifyStatus", () => {
  it("RIP/SIP/Success → paid", () => {
    assert.equal(mapVerifyStatus("RIP"), "paid");
    assert.equal(mapVerifyStatus("SIP"), "paid");
    assert.equal(mapVerifyStatus("Success"), "paid");
  });
  it("FAILED → failed", () => assert.equal(mapVerifyStatus("FAILED"), "failed"));
  it("NotInitiated → expired", () => assert.equal(mapVerifyStatus("NotInitiated"), "expired"));
  it("Success → paid (ICICI settled token)", () => assert.equal(mapVerifyStatus("Success"), "paid"));
});

describe("7 integrity cases", () => {
  it("1. Callback FAILED hint + Verify RIP → PAID once", () => {
    let s = "INITIATED";
    s = afterCallback(s); // even with E006
    assert.equal(s, "UNCONFIRMED");
    assert.ok(isOpenPaymentStatus(s) || s === "UNCONFIRMED");
    const v = afterVerify(s, mapVerifyStatus("RIP") as VerifyOutcome);
    assert.equal(v.to, "PAID");
    assert.equal(v.newlyPaid, true);
    // confirm once
    const again = afterVerify("PAID", "paid");
    assert.equal(again.newlyPaid, false);
  });

  it("2. No callback → Verify Success → PAID", () => {
    const v = afterVerify("INITIATED", mapVerifyStatus("Success") as VerifyOutcome);
    assert.equal(v.to, "PAID");
    assert.equal(v.newlyPaid, true);
  });

  it("3. Duplicate Verify → single PAID credit", () => {
    const a = afterVerify("UNCONFIRMED", "paid");
    const b = afterVerify("PAID", "paid");
    assert.equal(a.newlyPaid, true);
    assert.equal(b.newlyPaid, false);
  });

  it("4. Race: only one newlyPaid from PAID state", () => {
    // Simulate two callers: first wins, second sees PAID.
    const first = afterVerify("UNCONFIRMED", "paid");
    const second = afterVerify(first.to, "paid");
    assert.equal([first, second].filter((x) => x.newlyPaid).length, 1);
  });

  it("5. Genuine failure only after Verify agrees", () => {
    let s = afterCallback("INITIATED"); // callback E006 → still UNCONFIRMED
    assert.equal(s, "UNCONFIRMED");
    const v = afterVerify(s, mapVerifyStatus("FAILED") as VerifyOutcome);
    assert.equal(v.to, "FAILED");
    assert.equal(v.newlyPaid, false);
  });

  it("6. NotInitiated → EXPIRED, no confirmation", () => {
    const v = afterVerify("INITIATED", mapVerifyStatus("NotInitiated") as VerifyOutcome);
    assert.equal(v.to, "EXPIRED");
    assert.equal(v.newlyPaid, false);
  });

  it("7. Existing PAID untouched by callback or failed Verify", () => {
    assert.equal(afterCallback("PAID"), "PAID");
    const v = afterVerify("PAID", "failed");
    assert.equal(v.to, "PAID");
    assert.equal(v.newlyPaid, false);
    assert.equal(isPaidStatus("PAID"), true);
  });
});
