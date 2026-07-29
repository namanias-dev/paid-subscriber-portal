import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  formatLegacyPillLabel,
  legacyWorklistHref,
  phoneKeyFromRaw,
  pickLegacyCampaign,
  type LegacyLeadMatch,
} from "../../lib/marketing/legacyLeadMatch";

describe("phoneKeyFromRaw", () => {
  test("strips country code and non-digits to last 10", () => {
    assert.equal(phoneKeyFromRaw("+91 99887-91797"), "9988791797");
    assert.equal(phoneKeyFromRaw("919988791797"), "9988791797");
    assert.equal(phoneKeyFromRaw("9988791797"), "9988791797");
  });

  test("rejects blank / under-10 / staff pseudo-phones", () => {
    assert.equal(phoneKeyFromRaw(""), "");
    assert.equal(phoneKeyFromRaw(null), "");
    assert.equal(phoneKeyFromRaw("12345"), "");
    assert.equal(phoneKeyFromRaw("staff:a1111111-1111-1111-1111-111111111111"), "");
  });
});

describe("legacy pill framing", () => {
  test("label is unmistakably historical", () => {
    const m: LegacyLeadMatch = {
      leadId: "x",
      phoneKey: "9988791797",
      campaign: "INDIA-NCERT Batch",
      status: "Not Interested",
      sourceTab: "Google Ads",
      date: "2024-01-12T10:00:00+05:30",
      extraCount: 0,
    };
    const label = formatLegacyPillLabel(m);
    assert.match(label, /^Legacy:/);
    assert.ok(label.includes("INDIA-NCERT Batch"));
    assert.ok(label.includes("Not Interested"));
    assert.ok(label.includes("2024"));
    assert.ok(!label.toLowerCase().includes("current"));
  });

  test("extraCount surfaces multiple legacy rows", () => {
    const m: LegacyLeadMatch = {
      leadId: "x",
      phoneKey: "9988791797",
      campaign: "A",
      status: "Not Called",
      sourceTab: "FB LEADS",
      date: null,
      extraCount: 2,
    };
    assert.ok(formatLegacyPillLabel(m).includes("(+2)"));
  });

  test("worklist href opens legacy scope with phone search", () => {
    const href = legacyWorklistHref("9988791797");
    assert.ok(href.includes("scope=legacy"));
    assert.ok(href.includes("search=9988791797"));
  });

  test("campaign preference: clean → campaign → source tab", () => {
    assert.equal(pickLegacyCampaign({ campaign_clean: "Clean", campaign: "Raw", legacy_source_tab: "Tab" }), "Clean");
    assert.equal(pickLegacyCampaign({ campaign_clean: null, campaign: "Raw", legacy_source_tab: "Tab" }), "Raw");
    assert.equal(pickLegacyCampaign({ campaign_clean: null, campaign: null, legacy_source_tab: "Tab" }), "Tab");
  });
});

describe("no-match renders nothing (contract)", () => {
  test("lookup returns null for missing key — pill component gates on null", () => {
    // Component contract: LegacyLeadPill({ match: null }) → null.
    // Enforced by reading the component source so a regression that drops the
    // guard fails this suite.
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const src = readFileSync(join(import.meta.dirname, "..", "..", "components/admin/LegacyLeadPill.tsx"), "utf8");
    assert.match(src, /if\s*\(\s*!match\s*\)\s*return\s+null/);
    assert.match(src, /target="_blank"/);
    assert.match(src, /stopPropagation/);
  });
});
