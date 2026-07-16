/**
 * Shared attribution lookup helpers used by every per-person admin surface that
 * renders the read-only SourcePill (Payments card, Student profile header,
 * People/Students row). Locks in:
 *   • normalized phone lookup (`+91...` matches raw 10-digit lead rows);
 *   • absent-attribution returns null (the pill renders NOTHING);
 *   • lookup is stable across formats and empty inputs (no throws).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lastDigits10, lookupLeadAttr, type LeadAttrStamp } from "../../components/admin/SourcePill";

const byPhone: Record<string, LeadAttrStamp> = {
  "8548266654": { channel: "Google Ads", utm_campaign: "masterclass_test", utm_source: "google" },
  "9998887771": { channel: "Meta Ads", utm_campaign: "reels_1", utm_source: "facebook" },
  "8765432354": { channel: "Direct", utm_campaign: null, utm_source: null },
};

describe("SourcePill helpers — normalized phone lookup", () => {
  it('"+91 8548266654" matches the raw 10-digit lead phone', () => {
    const hit = lookupLeadAttr(byPhone, "+91 8548266654");
    assert.ok(hit);
    assert.equal(hit!.channel, "Google Ads");
    assert.equal(hit!.utm_campaign, "masterclass_test");
  });

  it("raw 10-digit phone matches", () => {
    const hit = lookupLeadAttr(byPhone, "9998887771");
    assert.ok(hit);
    assert.equal(hit!.channel, "Meta Ads");
  });

  it("phone with dashes/parentheses/spaces still matches", () => {
    const hit = lookupLeadAttr(byPhone, "(876) 543-2354");
    assert.ok(hit);
    assert.equal(hit!.channel, "Direct");
    assert.equal(hit!.utm_campaign, null);
  });

  it("empty / null / non-digits returns null (never throws)", () => {
    assert.equal(lookupLeadAttr(byPhone, ""), null);
    assert.equal(lookupLeadAttr(byPhone, null), null);
    assert.equal(lookupLeadAttr(byPhone, "N/A"), null);
  });

  it("unknown phone returns null (pill renders nothing)", () => {
    assert.equal(lookupLeadAttr(byPhone, "9000000000"), null);
  });

  it("null lookup map returns null (no throw when API is absent)", () => {
    assert.equal(lookupLeadAttr(null, "9998887771"), null);
    assert.equal(lookupLeadAttr(undefined, "9998887771"), null);
  });
});

describe("SourcePill helpers — lastDigits10", () => {
  it("strips non-digits and returns the last 10", () => {
    assert.equal(lastDigits10("+91 98765 43210"), "9876543210");
    assert.equal(lastDigits10("(876) 543-2354"), "8765432354");
    assert.equal(lastDigits10("917"), "917");
    assert.equal(lastDigits10(""), "");
    assert.equal(lastDigits10(null), "");
    assert.equal(lastDigits10(undefined), "");
  });
});
