/**
 * Per-tab transform contract — masked fixtures per tab, every reject reason
 * exercised. If any tab-specific column mapping changes in tabRegistry.ts,
 * these tests are the first fence to fall.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TAB_SPECS } from "../../lib/legacy-migration/tabRegistry";
import { transformRow, parseLegacyTimestamp } from "../../lib/legacy-migration/transform";

const ctx = { importBatch: "2026-07-21T00:00:00.000Z" };

/** Never a real number — 6XXXXX57ff pattern picks a valid Indian mobile shape (starts with 6-9, 10 digits). */
const MASK_PHONE = "6000000000";
const MASK_PHONE_2 = "7111111111";
const MASK_PHONE_3 = "8222222222";

describe("transformRow — FB LEADS (smart B/C resolver)", () => {
  const spec = TAB_SPECS["FB LEADS"];
  it("accepts a full row with campaign in col B (form_name)", () => {
    const row = {
      Date: "2025-05-01T10:15:22+0530",
      form_name: "upsc_masterclass_may2025",
      Form: "Delhi",
      platform: "fb",
      phone_number: `+91${MASK_PHONE}`,
      email: "masked@example.com",
      full_name: "Masked Name",
      Status: "New Lead",
      State: "Delhi",
    };
    const out = transformRow(spec, row, 2, ctx);
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.lead.canonical_phone, MASK_PHONE);
      assert.equal(out.lead.tab, "FB LEADS");
      assert.equal(out.lead.channel_legacy, "Meta Ads (legacy)");
      assert.equal(out.lead.campaign_raw, "upsc_masterclass_may2025");
      assert.equal(out.lead.campaign_clean, "upsc_masterclass_may2025");
      assert.equal(out.lead.platform_hint, "fb");
      assert.ok(out.lead.timestamp_iso, "timestamp should parse");
    }
  });

  it("resolves campaign from col C when B is a state name (B/C swap)", () => {
    const row = { Date: "2025-05-01", form_name: "Delhi", Form: "google_ads_campaign_v2", phone_number: MASK_PHONE };
    const out = transformRow(spec, row, 3, ctx);
    assert.equal(out.ok, true);
    if (out.ok) {
      // "Delhi" scores as location; "google_ads_campaign_v2" scores as campaign — C should win.
      assert.equal(out.lead.campaign_raw, "google_ads_campaign_v2");
    }
  });

  it("rejects empty row", () => {
    const out = transformRow(spec, { Date: "", form_name: "", phone_number: "" }, 4, ctx);
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.rejected.reason, "empty_row");
  });

  it("rejects row with invalid phone (starts with 5)", () => {
    const out = transformRow(spec, { phone_number: "5123456789" }, 5, ctx);
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.rejected.reason, "phone_not_indian_mobile");
  });

  it("rejects row with no phone column value", () => {
    const out = transformRow(spec, { Date: "2025-05-01", form_name: "cx" }, 6, ctx);
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.rejected.reason, "no_phone_column_value");
  });
});

describe("transformRow — Copy of FB LEADS (explicit campaign column + Ph fallback)", () => {
  const spec = TAB_SPECS["Copy of FB LEADS"];
  it("prefers campaign_name over form_name", () => {
    const out = transformRow(
      spec,
      {
        Date: "2025-06-15T09:00:00+0530",
        campaign_name: "explicit_campaign",
        form_name: "generic_form",
        phone_number: MASK_PHONE_2,
      },
      2,
      ctx,
    );
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.lead.campaign_clean, "explicit_campaign");
  });
  it("falls back to Ph when phone_number is blank", () => {
    const out = transformRow(spec, { Date: "2025-06-15", phone_number: "", Ph: `91${MASK_PHONE_2}` }, 3, ctx);
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.lead.canonical_phone, MASK_PHONE_2);
  });
});

describe("transformRow — Sheet1 (100% campaign fallback)", () => {
  const spec = TAB_SPECS["Sheet1"];
  it("stores campaign_raw but forces campaign_clean=null", () => {
    const out = transformRow(
      spec,
      { Date: "01/06/2025", Name: "Masked", "Phone number (10 digits only)": MASK_PHONE },
      2,
      ctx,
    );
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.lead.channel_legacy, "Organic (legacy, form)");
      assert.equal(out.lead.campaign_clean, null, "campaign_clean must stay NULL for Sheet1 (100% fallback)");
    }
  });
});

describe("transformRow — Google Ads (schema-less, no-phone-column fallback + no timestamp)", () => {
  const spec = TAB_SPECS["Google Ads"];
  it("walks every cell to find a phone", () => {
    const row = { "": "junk", K1: "no", something_else: `+91-${MASK_PHONE_3}`, another: "text" };
    const out = transformRow(spec, row, 2, ctx);
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.lead.canonical_phone, MASK_PHONE_3);
      assert.equal(out.lead.timestamp_iso, null, "no timestamp column → null");
      assert.equal(out.lead.channel_legacy, "Google Ads (legacy, low-conf)");
    }
  });
  it("returns phone_extractor_no_match when no cell yields a phone", () => {
    const out = transformRow(spec, { a: "hello", b: "world" }, 3, ctx);
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.rejected.reason, "phone_extractor_no_match");
  });
});

describe("transformRow — WhatsApp / Instagram / Google Ad Campaign / BACKUP_ALL_LEADS / Call These Leads", () => {
  it("WhatsApp stores state and Student Status", () => {
    const spec = TAB_SPECS["WhatsApp"];
    const out = transformRow(spec, { "WhatsApp Date": "15/07/2025", "Full Name": "Masked", "Phone No.": MASK_PHONE, State: "UP", "Student Status": "Prospect" }, 2, ctx);
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.lead.state_hint, "UP");
      assert.equal(out.lead.status_raw, "Prospect");
      assert.equal(out.lead.channel_legacy, "Organic (legacy, WhatsApp/Owned)");
    }
  });
  it("Instagram: NEW Batch flags origin_review_needed=true", () => {
    const spec = TAB_SPECS["Instagram: NEW Batch"];
    const out = transformRow(spec, { Timestamp: "2025-05-01T10:00:00", Name: "Masked", "Phone number": MASK_PHONE }, 2, ctx);
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.lead.origin_review_needed, true, "IG batch must be flagged for review");
      assert.equal(out.lead.channel_legacy, "Meta Ads (legacy, IG origin unconfirmed)");
    }
  });
  it("Google Ad Campaign keeps explicit Campaign", () => {
    const spec = TAB_SPECS["Google Ad Campaign"];
    const out = transformRow(spec, { Date: "2025-05-01", Name: "Masked", Contact: MASK_PHONE, Campaign: "GA_Search_Delhi_2025" }, 2, ctx);
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.lead.campaign_clean, "GA_Search_Delhi_2025");
  });
  it("BACKUP_ALL_LEADS uses created_time column", () => {
    const spec = TAB_SPECS["BACKUP_ALL_LEADS"];
    const out = transformRow(spec, { created_time: "2024-11-15T10:00:00+0000", campaign_name: "old_snapshot", phone_number: MASK_PHONE }, 2, ctx);
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.lead.channel_legacy, "Meta Ads (legacy, snapshot)");
  });
  it("Call These Leads channel is Unknown", () => {
    const spec = TAB_SPECS["Call These Leads"];
    const out = transformRow(spec, { created_time: "2025-01-01T00:00:00Z", full_name: "Masked", "Phone Number": MASK_PHONE, form_name: "Not a real campaign" }, 2, ctx);
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.lead.channel_legacy, "Unknown (legacy, manual list)");
    }
  });
});

describe("parseLegacyTimestamp — accepts every shape observed in the workbook", () => {
  it("ISO with tz", () => {
    assert.ok(parseLegacyTimestamp("2025-05-01T10:15:22+0530"));
  });
  it("DMY", () => {
    assert.ok(parseLegacyTimestamp("01/06/2025 12:30:00"));
  });
  it("epoch seconds", () => {
    assert.ok(parseLegacyTimestamp("1717200000"));
  });
  it("returns null for junk", () => {
    assert.equal(parseLegacyTimestamp(""), null);
    assert.equal(parseLegacyTimestamp("not a date"), null);
  });
});
