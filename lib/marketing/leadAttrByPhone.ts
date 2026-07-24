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
 * DISPLAY-WIDENING (2026-07-24, 4th shipment)
 * -------------------------------------------
 * The prior shipment (`8076c57a`) surfaced only leads with a populated scalar
 * `channel` column. Investigation of the deployed prod DB found that only
 * ~119 of ~987 non-legacy leads have `channel` set — the attribution scalars
 * are only populated for post-2026-07-16 leads (the "capture full Meta +
 * Google ad hierarchy" work, `fe1c8334`). Historically-captured leads carry
 * a form `source` ("Webinar" / "quiz_public" / "home_popup") but no scalar
 * `channel`, so ~87% of user rows show no pill even though we do know
 * SOMETHING about how they arrived.
 *
 * The map now carries a second `displayChannel` field derived from the best
 * available signal, in order of quality:
 *
 *   1. Scalar `channel` (existing behavior — populated at real ingestion by
 *      `leadAttributionFromState`).
 *   2. `deriveChannel(attribution.first_touch)` — the JSONB first-touch tuple
 *      when scalar `channel` was somehow dropped (defensive; not observed in
 *      prod today but future-proofs against ingestion regressions).
 *   3. `deriveChannel({source: utm_source||source||first_source, medium: utm_medium,
 *      campaign: utm_campaign||campaign||first_campaign, gclid})` — the
 *      remaining scalar signals, including the form `source` for older leads
 *      that predate the utm-capture work. `deriveChannel` returns "Other"
 *      for unrecognized form sources; "Organic" for social; "Referral" for
 *      referrals; "Direct" only when the source is genuinely empty.
 *   4. `null` — no display pill (honest — no signal captured).
 *
 * `displayChannel` is used by SourcePill ONLY. `derivedChannelFor` (aggregate
 * source-card totals) continues reading `channel` (the scalar) so aggregate
 * counts stay byte-identical to the pre-widening numbers (G1). Never reads
 * from `attribution.legacy_touches[]` per the collision-lead contract (G2).
 *
 * PII: consumers hold this in-memory only, never logged. The map keys are the
 * last-10 digit phone (`normPhone`), never the full E.164 string.
 */

import { normPhone } from "../phone";
import { hasLegacyFlag } from "../legacy-migration/legacyFilter";
import { deriveChannel, type AttributionTouch } from "../attribution";
import type { Lead } from "../types";

/** Minimum lead shape needed to derive a display source attribution stamp. */
export type LeadForSourceAttr = Pick<
  Lead,
  | "phone"
  | "channel"
  | "utm_campaign"
  | "utm_source"
  | "utm_medium"
  | "gclid"
  | "source"
  | "first_source"
  | "campaign"
  | "first_campaign"
  | "attribution"
>;

/** Per-phone marketing stamp used by SourcePill + derivedChannelFor. */
export interface LeadAttrByPhoneEntry {
  /** Scalar channel captured at ingestion. Drives aggregate source-card counts
   *  via `derivedChannelFor`. Unchanged in behavior from prior shipment. */
  channel: string | null;
  /** Best-effort display channel derived from all available lead signals
   *  (scalar channel → attribution.first_touch → utm/source fallback). Only
   *  read by SourcePill for the row-level display; never by aggregate counts. */
  displayChannel: string | null;
  utm_campaign: string | null;
  utm_source: string | null;
  /** True when the underlying lead had `attribution.legacy === true`. */
  legacy: boolean;
}

/** Non-empty trimmed string, else null. Shared helper. */
function nn(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s ? s : null;
}

/**
 * Best-effort DISPLAY channel for a lead. Uses the scalar `channel` when
 * populated (the honest first-touch capture path). Otherwise derives from the
 * remaining lead signals via `deriveChannel`, which handles utm signals, click
 * ids, and form-source fallbacks (`instagram` → Organic, `referral` → Referral,
 * unrecognized forms → Other; empty → Direct).
 *
 * NEVER reads from `attribution.legacy_touches[]` — the collision-lead
 * contract (G2) says the appended legacy touch must not surface as if it were
 * the real first-touch. A collision row whose only signal is `legacy_touches`
 * legitimately returns null here (honest empty pill).
 */
export function deriveDisplayChannel<T extends LeadForSourceAttr>(l: T): string | null {
  const scalar = nn(l.channel ?? null);
  if (scalar) return scalar;
  // (2) attribution.first_touch — the real first-touch tuple when it was
  //     persisted to JSONB but not mirrored to the scalar `channel` column
  //     (defensive; ingestion writes both today but this survives future drift).
  const state = l.attribution ?? null;
  const firstTouch = state?.first_touch ?? null;
  if (firstTouch) {
    const derived = deriveChannel(firstTouch);
    if (derived) return derived;
  }
  // (3) Synthetic touch from the remaining scalar signals. utm_source wins;
  //     otherwise the FORM `source` (or first_source) is used as the touch
  //     source. `deriveChannel` classifies known sources (instagram/facebook/
  //     youtube/telegram/whatsapp → Organic; google → Organic-or-GoogleAds
  //     depending on paid medium; referral → Referral) and falls through to
  //     "Other" for unrecognized form sources.
  const synthetic: AttributionTouch = {
    source: nn(l.utm_source) || nn(l.source) || nn(l.first_source) || "",
    medium: nn(l.utm_medium),
    campaign: nn(l.utm_campaign) || nn(l.campaign) || nn(l.first_campaign),
    content: null,
    term: null,
    landing_path: null,
    referrer: null,
    gclid: nn(l.gclid),
  };
  const derived = deriveChannel(synthetic);
  // `deriveChannel` returns "Direct" for a null/empty source with no click id.
  // We PREFER honest "no pill" over asserting "Direct" for a completely
  // signal-less lead — a leftover-empty row (no channel, no utm, no source,
  // no first_source) has nothing worth displaying.
  if (derived === "Direct" && !synthetic.source && !synthetic.gclid) return null;
  return derived;
}

/**
 * Build the phone → attribution map with the collision-preference rules above.
 *
 * The scalar `l.channel` column is the correct read path for AGGREGATE COUNTS:
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
 * DISPLAY uses `displayChannel` (see {@link deriveDisplayChannel}) which
 * widens to utm / form-source fallbacks so old leads without a scalar
 * `channel` still render an honest pill. Aggregate counts remain unchanged.
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
      displayChannel: deriveDisplayChannel(l),
      utm_campaign: l.utm_campaign ?? null,
      utm_source: l.utm_source ?? null,
      legacy: isLegacy,
    };
    seenLegacy.set(key, isLegacy);
  }
  return out;
}

/**
 * Drop entries that carry NEITHER a scalar `channel` NOR a derived
 * `displayChannel`. Two consumers read this map:
 *
 *   - `SourcePill` — reads `displayChannel || channel`; entries where both
 *     are null/empty never produce a pill anyway.
 *   - `derivedChannelFor` — returns `Unknown` when either the phone is not in
 *     the map OR the entry's `channel` is empty; entries with only a
 *     `displayChannel` still bucket to Unknown in aggregate (unchanged G1).
 *
 * Pruning is therefore behaviorally a no-op but shrinks the JSON payload —
 * only entries that CAN contribute to a pill (scalar or derived) survive.
 * At prod scale this stays a small map (well under the ~4.5 MB serverless
 * response-body budget) even after widening — the widening keeps the ~987
 * non-legacy leads with a source signal, all of which are already inside
 * `getLeadsForPillMap()` today.
 *
 * Preserves the winning entry per phone under the collision-preference rules
 * above — this only drops entries that couldn't influence the rendered pill or
 * aggregate channel bucket.
 */
export function pruneEmptyChannels(
  map: Record<string, LeadAttrByPhoneEntry>,
): Record<string, LeadAttrByPhoneEntry> {
  const out: Record<string, LeadAttrByPhoneEntry> = {};
  for (const [phone, entry] of Object.entries(map)) {
    const ch = (entry.channel ?? "").trim();
    const disp = (entry.displayChannel ?? "").trim();
    if (!ch && !disp) continue;
    out[phone] = entry;
  }
  return out;
}
