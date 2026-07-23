/**
 * Phone → marketing-attribution map builder shared by the admin Payments and
 * Students routes.
 *
 * WHAT IT SOLVES
 * --------------
 * The Payments/Finance and People pages render a read-only lead SOURCE pill
 * (`components/admin/SourcePill.tsx`) on each row. The pill reads a per-phone
 * `channel` / `utm_*` stamp built from the CRM leads. Before the legacy-lead
 * migration (commits `2542f0c8` + `c84f2538`), `getLeads()` returned every
 * lead, and the map picked the first match per phone. After c84f2538,
 * `getLeads()` defaulted to `includeLegacy: false`, which correctly hides
 * ~178k legacy phones from the CRM/Kanban/SMS audiences BUT also stripped
 * source display from ALL payments whose only lead match was a legacy row
 * (~59 payments in prod at time of shipment), regressing the payments page.
 *
 * THE POST-FIX CONTRACT
 * ---------------------
 * We call `getLeads({ includeLegacy: true })`, then build the map with the
 * following DETERMINISTIC preference:
 *
 *   1. If a phone has BOTH a non-legacy AND a legacy lead (the ~129 collision
 *      cases), the NON-LEGACY row wins. This preserves the collision-lead
 *      contract G2: read source from the REAL `attribution.first_touch`
 *      (stored in the scalar `channel` column at real ingestion), never from
 *      the appended `legacy_touches[]`.
 *   2. Given equal legacy status, the first row seen wins (order stable so a
 *      lead's channel doesn't flip between refreshes).
 *
 * Each map entry carries a `legacy` boolean. The aggregate source-card path
 * (`lib/webinarSource.ts:derivedChannelFor`) short-circuits `legacy: true`
 * entries to "Unknown" so channel counts stay byte-identical to the
 * pre-shipment legacy-free totals (G1). The DISPLAY path (`SourcePill`) does
 * NOT gate on `legacy` because a real channel captured at ingestion is honest
 * to show — the flag is informational for the counts path only.
 *
 * PII: consumers hold this in-memory only, never logged. The map keys are the
 * last-10 digit phone (`normPhone`), never the full E.164 string.
 */

import { normPhone } from "../phone";
import { hasLegacyFlag } from "../legacy-migration/legacyFilter";
import type { Lead } from "../types";

/** Minimum lead shape needed to derive a display source attribution stamp. */
export type LeadForSourceAttr = Pick<
  Lead,
  "phone" | "channel" | "utm_campaign" | "utm_source" | "attribution"
>;

/** Per-phone marketing stamp used by SourcePill + derivedChannelFor. */
export interface LeadAttrByPhoneEntry {
  channel: string | null;
  utm_campaign: string | null;
  utm_source: string | null;
  /** True when the underlying lead had `attribution.legacy === true`. */
  legacy: boolean;
}

/**
 * Build the phone → attribution map with the collision-preference rules above.
 *
 * The scalar `l.channel` column is the correct read path:
 *   - It is populated at real ingestion from `attribution.first_touch` via
 *     `leadAttributionFromState` — so a non-legacy row's `channel` is the
 *     real first-touch channel.
 *   - It is NEVER overwritten by the collision merge branch — the fix in
 *     commit `c59c6ab9` narrowed `mergeCollisionAttribution` to append to
 *     `legacy_touches[]` only and leave every other scalar/JSONB field alone.
 *     So on a collision row (legacy sheet phone matched to a live lead)
 *     `l.channel` is still the real first-touch channel — same value as
 *     reading `attribution.first_touch` directly.
 *
 * Pure function: no I/O, no side effects, order-preserving.
 */
export function buildLeadAttrByPhone<T extends LeadForSourceAttr>(
  leads: readonly T[],
): Record<string, LeadAttrByPhoneEntry> {
  const out: Record<string, LeadAttrByPhoneEntry> = {};
  const seenLegacy = new Map<string, boolean>();
  for (const l of leads) {
    const key = normPhone(l.phone);
    if (!key) continue;
    const isLegacy = hasLegacyFlag(l);
    const existing = seenLegacy.get(key);
    // A non-legacy winner is final for this phone — later rows (legacy or
    // duplicate live) never overwrite it. This is what makes collision rows
    // resolve to the REAL first-touch source, not the appended legacy touch.
    if (existing === false) continue;
    // A legacy incumbent is only replaced by a non-legacy incoming.
    if (existing === true && isLegacy) continue;
    out[key] = {
      channel: l.channel ?? null,
      utm_campaign: l.utm_campaign ?? null,
      utm_source: l.utm_source ?? null,
      legacy: isLegacy,
    };
    seenLegacy.set(key, isLegacy);
  }
  return out;
}
