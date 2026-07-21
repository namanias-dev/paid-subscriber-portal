/**
 * Plain-English definitions for every derived marketing channel the admin CRM
 * uses. Single source of truth — the Paid Registrations by Source card, the
 * expanded panel, the Payments Source filter, and any future report ALL read
 * from here. Adding a definition once makes it visible everywhere.
 *
 * The channel STRINGS must exactly match what `deriveChannel(touch)` returns
 * (see `lib/attribution.ts`) plus the two flat lower-case aliases the CRM
 * historically also uses (`instagram`, `facebook`, etc. that fall through to
 * `Organic`). Everything is derived from the same predicates the CRM applies
 * to a lead's first-touch attribution.
 *
 * Rule: definitions describe HOW the code assigns the value — never a marketing
 * inference. `Unknown` is honestly labelled as "registered before source
 * attribution was captured" and never guessed.
 */
import { MARKETING_CHANNELS, type MarketingChannel } from "@/lib/attribution";

/** The "Unknown" bucket — never emitted by `deriveChannel`; assigned by the
 * source card when a payment/registration row has no matching lead. */
export const UNKNOWN_SOURCE = "Unknown" as const;

/** Every source that the admin surfaces can display. Union of the derived
 * marketing channels + the honest "Unknown" fallback. */
export type SourceDisplayKey = MarketingChannel | typeof UNKNOWN_SOURCE;

export interface SourceDefinition {
  /** Human-readable label as shown in the UI (title-cased). */
  label: SourceDisplayKey;
  /** One-sentence plain-English definition (never inferred, code-behavior-driven). */
  definition: string;
  /** Consistent brand-ish color used by pills/bars across the CRM. */
  color: string;
}

/**
 * The full definition map. Iterated by the Source filter + the expanded panel
 * to render every possible source with its meaning next to it. Any future
 * addition to `MARKETING_CHANNELS` must be added here — the test in
 * `tests/journey-automation/payments-source-derivation.test.ts` enforces it.
 */
export const SOURCE_DEFINITIONS: Record<SourceDisplayKey, SourceDefinition> = {
  "Google Ads": {
    label: "Google Ads",
    definition: "Clicked a paid Google ad (detected via the gclid/wbraid/gbraid click id auto-tagged by Google, or an explicit utm_source=google with a paid medium).",
    color: "#EA4335",
  },
  "Meta Ads": {
    label: "Meta Ads",
    definition: "Clicked a paid Facebook or Instagram ad (detected via the fbclid/_fbc click id, or an explicit utm_source=facebook|instagram with a paid medium).",
    color: "#1877F2",
  },
  Organic: {
    label: "Organic",
    definition: "Found us through unpaid social, unpaid search, or a share link — a known platform (Google, Instagram, Facebook, YouTube, Telegram, WhatsApp) with NO paid-ad click id.",
    color: "#10B981",
  },
  Referral: {
    label: "Referral",
    definition: "Arrived from a link on another website that we don't recognise as a paid ad or a known organic platform.",
    color: "#8B5CF6",
  },
  Direct: {
    label: "Direct",
    definition: "Typed the URL, opened a bookmark, or arrived from an untracked link (e.g. a WhatsApp forward that strips the referrer).",
    color: "#0057FF",
  },
  Other: {
    label: "Other",
    definition: "An explicit UTM tag was captured but its source didn't match any known platform (kept distinct so the raw tag isn't lost).",
    color: "#64748b",
  },
  Unknown: {
    label: "Unknown",
    definition: "Registered before source attribution was captured (or the visitor's cookies were cleared before submitting). Never inferred — shown honestly.",
    color: "#94a3b8",
  },
};

/**
 * All display keys in a stable rendering order: paid channels first (biggest
 * signal for the marketer), then Organic/Referral, then Direct/Other, then
 * Unknown last. Filter widgets iterate this to keep the pill order consistent.
 */
export const SOURCE_DISPLAY_ORDER: SourceDisplayKey[] = [
  "Google Ads",
  "Meta Ads",
  "Organic",
  "Referral",
  "Direct",
  "Other",
  UNKNOWN_SOURCE,
];

/** Look up a definition, tolerating any string (falls back to Unknown). */
export function sourceDefinition(key: string | null | undefined): SourceDefinition {
  const k = (key || "").trim();
  if (k in SOURCE_DEFINITIONS) return SOURCE_DEFINITIONS[k as SourceDisplayKey];
  return SOURCE_DEFINITIONS[UNKNOWN_SOURCE];
}

/** Every derived channel key that has a definition — for filter widgets. */
export const ALL_SOURCE_KEYS: readonly SourceDisplayKey[] = [
  ...MARKETING_CHANNELS,
  UNKNOWN_SOURCE,
];
