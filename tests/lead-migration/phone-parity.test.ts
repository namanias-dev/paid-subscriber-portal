/**
 * Phone-parity: assert that the portal's `normalizeIndianMobile` + `normPhone`
 * canonicalize every phone shape observed in the legacy workbook to the same
 * 10-digit key. Failure here means the importer's dedupe would diverge from the
 * portal's `addLead()` fold-by-phone.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeIndianMobile, normPhone } from "../../lib/phone";

// All masked. Every entry uses a valid Indian mobile prefix (6-9).
const CASES: Array<{ raw: string; expect: string | null }> = [
  { raw: "6000000000", expect: "6000000000" },
  { raw: " 6000000000 ", expect: "6000000000" },
  { raw: "+916000000000", expect: "6000000000" },
  { raw: "+91 60000 00000", expect: "6000000000" },
  { raw: "+91-60000-00000", expect: "6000000000" },
  { raw: "916000000000", expect: "6000000000" },
  { raw: "06000000000", expect: "6000000000" },
  { raw: "0916000000000", expect: "6000000000" },
  { raw: "(+91) 60000 00000", expect: "6000000000" },
  // Invalid — leading 5 fails the Indian mobile gate.
  { raw: "5000000000", expect: null },
  // Invalid — too short.
  { raw: "600000000", expect: null },
  // Invalid — non-digit garbage only.
  { raw: "phone: unknown", expect: null },
  // Empty.
  { raw: "", expect: null },
];

describe("normalizeIndianMobile — every legacy shape resolves canonically", () => {
  for (const c of CASES) {
    it(`normalizes "${c.raw.replace(/\d/g, "X")}" → ${c.expect}`, () => {
      const n = normalizeIndianMobile(c.raw);
      if (c.expect === null) {
        assert.equal(n.ok, false, `expected reject for "${c.raw.replace(/\d/g, "X")}"`);
      } else {
        assert.equal(n.ok, true, `expected accept for "${c.raw.replace(/\d/g, "X")}"`);
        assert.equal(n.digits10, c.expect);
      }
    });
  }
});

describe("normPhone — last-10 fallback still validates strict regex when used", () => {
  it("returns the canonical 10 for valid inputs", () => {
    assert.equal(normPhone("+916000000000"), "6000000000");
  });
  it("returns a last-10 slice for garbage inputs (importer will re-gate with regex)", () => {
    const v = normPhone("abcd1234567890");
    // last-10 = "1234567890" which does NOT start 6-9 — importer must reject it.
    assert.equal(v, "1234567890");
    assert.equal(/^[6-9]\d{9}$/.test(v ?? ""), false);
  });
});
