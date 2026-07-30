/**
 * Meta Lead Ads — unit tests (no network / no DB).
 */

import { createHmac } from "node:crypto";
import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { mapFieldData, verifyMetaSignature, extractLeadgenPayloads } from "../../lib/meta/leadAds";
import { normalizeIndianMobile, normPhone } from "../../lib/phone";
import { phoneKeyFromRaw } from "../../lib/marketing/legacyLeadMatch";

describe("verifyMetaSignature", () => {
  const secret = "test_app_secret_meta_leadgen";
  let prev: string | undefined;

  before(() => {
    prev = process.env.META_APP_SECRET;
    process.env.META_APP_SECRET = secret;
  });
  after(() => {
    if (prev === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = prev;
  });

  it("accepts valid X-Hub-Signature-256", () => {
    const body = '{"object":"page","entry":[]}';
    const sig =
      "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
    assert.equal(verifyMetaSignature(body, sig), true);
  });

  it("rejects invalid signature", () => {
    assert.equal(verifyMetaSignature('{"a":1}', "sha256=deadbeef"), false);
  });

  it("rejects missing signature", () => {
    assert.equal(verifyMetaSignature("{}", null), false);
    assert.equal(verifyMetaSignature("{}", undefined), false);
  });
});

describe("mapFieldData", () => {
  it("maps known fields and preserves raw", () => {
    const mapped = mapFieldData([
      { name: "full_name", values: ["Ada Lovelace"] },
      { name: "phone_number", values: ["+91 98765 43210"] },
      { name: "email", values: ["ada@example.com"] },
      { name: "city", values: ["Delhi"] },
      { name: "custom_q", values: ["UPSC 2027"] },
    ]);
    assert.equal(mapped.full_name, "Ada Lovelace");
    assert.equal(mapped.phone_number, "+91 98765 43210");
    assert.equal(mapped.email, "ada@example.com");
    assert.equal(mapped.city, "Delhi");
    assert.equal(mapped.raw_field_data.length, 5);
    assert.ok(mapped.raw_field_data.some((f) => f.name === "custom_q"));
  });

  it("handles missing fields without undefined strings", () => {
    const mapped = mapFieldData([{ name: "full_name", values: ["Only Name"] }]);
    assert.equal(mapped.full_name, "Only Name");
    assert.equal(mapped.phone_number, null);
    assert.equal(mapped.email, null);
    assert.equal(mapped.city, null);
  });
});

describe("extractLeadgenPayloads", () => {
  it("extracts leadgen change values", () => {
    const payloads = extractLeadgenPayloads({
      object: "page",
      entry: [
        {
          id: "page1",
          time: 1,
          changes: [
            {
              field: "leadgen",
              value: {
                leadgen_id: "lg_1",
                page_id: "p1",
                form_id: "f1",
                created_time: 1700000000,
                ad_id: "a1",
                campaign_id: "c1",
              },
            },
          ],
        },
      ],
    });
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0]!.leadgen_id, "lg_1");
    assert.equal(payloads[0]!.form_id, "f1");
    assert.equal(payloads[0]!.created_time, 1700000000);
  });

  it("ignores non-leadgen fields", () => {
    assert.equal(
      extractLeadgenPayloads({
        entry: [{ changes: [{ field: "feed", value: { leadgen_id: "x", page_id: "p", form_id: "f" } }] }],
      }).length,
      0,
    );
  });
});

describe("phone normalisation for Meta formats", () => {
  it("normalises +91 / spaced / leading zero to last-10", () => {
    for (const raw of ["+91 98765 43210", "919876543210", "09876543210", "9876543210"]) {
      const n = normalizeIndianMobile(raw);
      assert.equal(n.ok, true, raw);
      assert.equal(n.digits10, "9876543210", raw);
      assert.equal(phoneKeyFromRaw(n.digits10!), "9876543210");
    }
  });

  it("normPhone falls back for odd Meta formats", () => {
    const d = normPhone("+91-(987)-654-3210");
    assert.ok(d === "9876543210" || d?.endsWith("9876543210"));
  });
});
