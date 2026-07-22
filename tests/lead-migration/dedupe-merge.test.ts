/**
 * Dedupe & merge — intra-tab keep-newest, cross-tab priority merge, Supabase
 * collision NULL-only-fill (via the importer's in-memory pipeline), and
 * idempotency (re-running yields zero new rows).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dedupeCrossTab, dedupeIntraTab } from "../../lib/legacy-migration/dedupe";
import { runImporter } from "../../lib/legacy-migration/importer";
import { INCLUDED_TABS, LEAD_SOURCE_PRIORITY, LEGACY_WORKBOOK_SPREADSHEET_ID, type LegacyTab } from "../../lib/legacy-migration/tabRegistry";
import type { StagedLead } from "../../lib/legacy-migration/types";

function mkStaged(tab: LegacyTab, phone: string, iso: string | null, name?: string): StagedLead {
  return {
    canonical_phone: phone,
    tab,
    source_row: 2,
    timestamp_iso: iso,
    name: name ?? null,
    email: null,
    city_hint: null,
    state_hint: null,
    campaign_raw: null,
    campaign_clean: null,
    channel_legacy: "test channel",
    platform_hint: null,
    status_raw: null,
    calling_status_raw: null,
    origin_review_needed: false,
    external_lead_id: `${tab}:2`,
    priority: LEAD_SOURCE_PRIORITY[tab],
    legacy_touch: {
      tab,
      lead_timestamp: iso ?? undefined,
      campaign_raw: null,
      campaign_clean: null,
      source_type: "test",
      form_name: null,
      platform_hint: null,
      calling_status_raw: null,
      source_row: 2,
      winner: true,
    },
  };
}

describe("dedupeIntraTab — keep-newest, fold losers", () => {
  it("keeps the row with the newest timestamp", () => {
    const rows = [
      mkStaged("FB LEADS", "6000000000", "2025-01-01T00:00:00.000Z", "Old"),
      mkStaged("FB LEADS", "6000000000", "2025-05-01T00:00:00.000Z", "New"),
    ];
    const { kept, droppedCount } = dedupeIntraTab(rows);
    assert.equal(kept.length, 1);
    assert.equal(droppedCount, 1);
    assert.equal(kept[0].name, "New");
    assert.equal(kept[0].merged_touches?.length, 2);
  });
  it("nulls go last when comparing timestamps", () => {
    const rows = [
      mkStaged("FB LEADS", "6000000000", null, "Untimed"),
      mkStaged("FB LEADS", "6000000000", "2025-05-01T00:00:00.000Z", "Timed"),
    ];
    const { kept } = dedupeIntraTab(rows);
    assert.equal(kept[0].name, "Timed");
  });
});

describe("dedupeCrossTab — priority merge, phones-in-multiple-tabs", () => {
  it("keeps the row from the lowest-priority tab (FB LEADS wins)", () => {
    const rows = [
      mkStaged("Copy of FB LEADS", "6000000000", "2025-06-01T00:00:00.000Z", "Copy"),
      mkStaged("FB LEADS", "6000000000", "2025-01-01T00:00:00.000Z", "FB"),
    ];
    const { kept, droppedCount, phonesInMultipleTabs } = dedupeCrossTab(rows);
    assert.equal(kept.length, 1);
    assert.equal(droppedCount, 1);
    assert.equal(phonesInMultipleTabs, 1);
    assert.equal(kept[0].tab, "FB LEADS");
    assert.equal(kept[0].merged_touches?.length, 2);
  });
  it("does not count phones that appear only within one tab", () => {
    const rows = [
      mkStaged("FB LEADS", "6000000000", "2025-01-01T00:00:00.000Z"),
      mkStaged("FB LEADS", "6000000001", "2025-02-01T00:00:00.000Z"),
    ];
    const { phonesInMultipleTabs } = dedupeCrossTab(rows);
    assert.equal(phonesInMultipleTabs, 0);
  });
});

describe("Supabase collision — NULL-only-fill, never overwrite", () => {
  it("collision count matches the supabasePhonesOverride", async () => {
    const supabasePhones = new Set(["6000000000"]);
    const prefetched: Record<LegacyTab, Array<Record<string, string | null>>> = INCLUDED_TABS.reduce(
      (acc, tab) => ({ ...acc, [tab]: [] }),
      {} as Record<LegacyTab, Array<Record<string, string | null>>>,
    );
    prefetched["FB LEADS"] = [
      { Date: "2025-05-01T10:00:00+0530", form_name: "test_campaign", Form: "Delhi", platform: "fb", phone_number: "+916000000000", email: "m@x.com", full_name: "Masked" },
      { Date: "2025-05-01T10:00:00+0530", form_name: "second", Form: "Delhi", platform: "fb", phone_number: "+917111111111", email: "m2@x.com", full_name: "Masked2" },
    ];
    const result = await runImporter({
      mode: "dry-run",
      batchSize: 500,
      tabs: [...INCLUDED_TABS] as LegacyTab[],
      spreadsheetId: LEGACY_WORKBOOK_SPREADSHEET_ID,
      prefetched,
      supabasePhonesOverride: supabasePhones,
    });
    assert.equal(result.report.supabase.collisions_null_fills, 1);
    assert.equal(result.report.supabase.pure_inserts, 1);
  });
});

describe("Idempotency — re-running the same input yields identical output", () => {
  it("dry-run twice: identical union counts and collision counts", async () => {
    const prefetched: Record<LegacyTab, Array<Record<string, string | null>>> = INCLUDED_TABS.reduce(
      (acc, tab) => ({ ...acc, [tab]: [] }),
      {} as Record<LegacyTab, Array<Record<string, string | null>>>,
    );
    prefetched["FB LEADS"] = [
      { Date: "2025-05-01T10:00:00+0530", form_name: "c1", Form: "d", platform: "fb", phone_number: "+916000000000" },
    ];
    prefetched["Copy of FB LEADS"] = [
      { Date: "2025-06-01T10:00:00+0530", campaign_name: "c2", phone_number: "+916000000000" },
    ];
    const opts = {
      mode: "dry-run" as const,
      batchSize: 500,
      tabs: [...INCLUDED_TABS] as LegacyTab[],
      spreadsheetId: LEGACY_WORKBOOK_SPREADSHEET_ID,
      prefetched,
      supabasePhonesOverride: new Set<string>(),
    };
    const r1 = await runImporter(opts);
    const r2 = await runImporter(opts);
    assert.equal(r1.report.cross_tab.distinct_canonical_phones_union, r2.report.cross_tab.distinct_canonical_phones_union);
    assert.equal(r1.report.cross_tab.phones_in_multiple_tabs, r2.report.cross_tab.phones_in_multiple_tabs);
    assert.equal(r1.report.supabase.collisions_null_fills, r2.report.supabase.collisions_null_fills);
    assert.equal(r1.report.cross_tab.phones_in_multiple_tabs, 1, "same phone in FB LEADS + Copy of FB LEADS counts as 1 collision");
  });
});
