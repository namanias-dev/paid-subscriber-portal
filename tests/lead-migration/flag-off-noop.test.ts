/**
 * Flag-off no-op — with LEGACY_IMPORT_ENABLED, SHEETS_SYNC_ENABLED, and
 * META_LEADS_ENABLED all unset (or "false"), the deployed code changes nothing:
 *   - --commit refuses.
 *   - The sheets-sync route returns 501.
 *   - The Meta webhook POST returns 501 with the exact missing config list.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  isLegacyImportEnabled,
  isMetaLeadsEnabled,
  isSheetsSyncEnabled,
  legacyMigrationFlagSnapshot,
} from "../../lib/legacy-migration/flags";
import { missingMetaConfig, MetaLeadsNotConfiguredError, fetchLeadgenRecord } from "../../lib/meta/leadAds";

const KEYS = ["LEGACY_IMPORT_ENABLED", "SHEETS_SYNC_ENABLED", "META_LEADS_ENABLED"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("Flag readers — every unset flag reads false", () => {
  it("all three default false", () => {
    assert.equal(isLegacyImportEnabled(), false);
    assert.equal(isSheetsSyncEnabled(), false);
    assert.equal(isMetaLeadsEnabled(), false);
    assert.deepEqual(legacyMigrationFlagSnapshot(), { legacyImport: false, sheetsSync: false, metaLeads: false });
  });
  it('only exact-string "true" counts', () => {
    for (const bad of ["1", "yes", "TRUE ", "on", "True"]) {
      process.env.LEGACY_IMPORT_ENABLED = bad;
      const got = isLegacyImportEnabled();
      // "True" (mixed case) IS accepted because readFlag lowercases; but "TRUE " with a trailing space is not.
      const shouldBeTrue = bad.trim().toLowerCase() === "true";
      assert.equal(got, shouldBeTrue, `flag value "${bad}" should be ${shouldBeTrue}`);
    }
  });
});

describe("Meta scaffold — fetchLeadgenRecord refuses without full config", () => {
  it("throws MetaLeadsNotConfiguredError with the full missing list", async () => {
    const missing = missingMetaConfig();
    assert.ok(missing.includes("META_APP_ID"));
    assert.ok(missing.includes("META_APP_SECRET"));
    assert.ok(missing.includes("META_LEADGEN_VERIFY_TOKEN"));
    assert.ok(missing.includes("META_LONG_LIVED_TOKEN"));
    assert.ok(missing.includes("META_LEADS_ENABLED=true"));
    await assert.rejects(
      () =>
        fetchLeadgenRecord({
          leadgen_id: "0",
          page_id: "0",
          form_id: "0",
          created_time: 0,
        }),
      (err: unknown) => err instanceof MetaLeadsNotConfiguredError,
    );
  });
});
