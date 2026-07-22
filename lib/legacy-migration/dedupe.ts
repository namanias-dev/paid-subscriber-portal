/**
 * Intra-tab (keep-newest) and cross-tab (priority-merge) dedupe for StagedLead
 * arrays. No I/O. Deterministic — same inputs always produce the same outputs
 * so tests can freeze on golden expectations.
 */

import { LEAD_SOURCE_PRIORITY, type LegacyTab } from "./tabRegistry";
import type { StagedLead, LegacyTouchpoint } from "./types";

/**
 * Fold multiple touches into the winner's `legacy_touches[]` array. `winner`
 * is mutated in place: its own touch stays at index 0 and the losers are
 * appended in the order supplied. Losers are marked `winner=false` so the
 * downstream JSONB has an audit trail of what merged in.
 */
export function foldTouchesIntoWinner(winner: StagedLead, losers: StagedLead[]): StagedLead {
  const merged: LegacyTouchpoint[] = [{ ...winner.legacy_touch, winner: true }];
  for (const l of losers) merged.push({ ...l.legacy_touch, winner: false });
  return {
    ...winner,
    legacy_touch: { ...winner.legacy_touch, winner: true },
    merged_touches: merged,
    // Best-effort NULL-fill from losers (never overrides a set field).
    name: winner.name ?? losers.find((l) => l.name)?.name ?? null,
    email: winner.email ?? losers.find((l) => l.email)?.email ?? null,
    state_hint: winner.state_hint ?? losers.find((l) => l.state_hint)?.state_hint ?? null,
    city_hint: winner.city_hint ?? losers.find((l) => l.city_hint)?.city_hint ?? null,
    campaign_clean: winner.campaign_clean ?? losers.find((l) => l.campaign_clean)?.campaign_clean ?? null,
    campaign_raw: winner.campaign_raw ?? losers.find((l) => l.campaign_raw)?.campaign_raw ?? null,
    status_raw: winner.status_raw ?? losers.find((l) => l.status_raw)?.status_raw ?? null,
    platform_hint: winner.platform_hint ?? losers.find((l) => l.platform_hint)?.platform_hint ?? null,
  };
}

/**
 * Intra-tab dedupe: for a canonical phone appearing >1× within one tab, keep
 * the row with the newest `lead_timestamp` (nulls last); stack the others onto
 * the winner. Returns the deduplicated leads array + count of dropped rows.
 */
export function dedupeIntraTab(rows: StagedLead[]): { kept: StagedLead[]; droppedCount: number } {
  const byPhone = new Map<string, StagedLead[]>();
  for (const r of rows) {
    const bucket = byPhone.get(r.canonical_phone);
    if (bucket) bucket.push(r);
    else byPhone.set(r.canonical_phone, [r]);
  }
  const kept: StagedLead[] = [];
  let droppedCount = 0;
  for (const bucket of byPhone.values()) {
    if (bucket.length === 1) {
      kept.push(bucket[0]);
      continue;
    }
    // Newest first, nulls (missing timestamp) go last.
    bucket.sort((a, b) => {
      if (a.timestamp_iso && b.timestamp_iso) return b.timestamp_iso.localeCompare(a.timestamp_iso);
      if (a.timestamp_iso) return -1;
      if (b.timestamp_iso) return 1;
      return 0;
    });
    const [winner, ...losers] = bucket;
    kept.push(foldTouchesIntoWinner(winner, losers));
    droppedCount += losers.length;
  }
  return { kept, droppedCount };
}

/**
 * Cross-tab dedupe: for a canonical phone appearing in ≥2 tabs, keep the row
 * from the tab with the LOWEST `LEAD_SOURCE_PRIORITY` value. Ties (same tab,
 * shouldn't happen after intra-tab dedupe) fall back to newest timestamp.
 */
export function dedupeCrossTab(rows: StagedLead[]): {
  kept: StagedLead[];
  droppedCount: number;
  phonesInMultipleTabs: number;
} {
  const byPhone = new Map<string, StagedLead[]>();
  for (const r of rows) {
    const bucket = byPhone.get(r.canonical_phone);
    if (bucket) bucket.push(r);
    else byPhone.set(r.canonical_phone, [r]);
  }
  const kept: StagedLead[] = [];
  let droppedCount = 0;
  let phonesInMultipleTabs = 0;
  for (const bucket of byPhone.values()) {
    if (bucket.length === 1) {
      kept.push(bucket[0]);
      continue;
    }
    // Winner = min priority; if tied, newest timestamp.
    bucket.sort((a, b) => {
      const pa = a.priority ?? LEAD_SOURCE_PRIORITY[a.tab as LegacyTab];
      const pb = b.priority ?? LEAD_SOURCE_PRIORITY[b.tab as LegacyTab];
      if (pa !== pb) return pa - pb;
      if (a.timestamp_iso && b.timestamp_iso) return b.timestamp_iso.localeCompare(a.timestamp_iso);
      if (a.timestamp_iso) return -1;
      if (b.timestamp_iso) return 1;
      return 0;
    });
    const [winner, ...losers] = bucket;
    kept.push(foldTouchesIntoWinner(winner, losers));
    droppedCount += losers.length;
    if (bucket.some((r) => r.tab !== bucket[0].tab)) phonesInMultipleTabs += 1;
  }
  return { kept, droppedCount, phonesInMultipleTabs };
}
