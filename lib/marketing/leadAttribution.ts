/**
 * Lead-level marketing attribution (PURE, client-safe).
 *
 * Turns the first-party attribution cookie state (see lib/attribution.ts) into a
 * flat stamp persisted on the `leads` row + the `lead_created` event, and a
 * fill-if-empty patch used when a repeat submit FOLDS into an existing lead so a
 * later touch NEVER overwrites the first-touch campaign/channel that actually
 * won the lead. Nothing here sends or executes.
 */
import {
  type AttributionState,
  type AttributionTouch,
  deriveChannel,
} from "@/lib/attribution";

export interface LeadAttribution {
  /** Coarse channel: "Google Ads" | "Meta Ads" | "Organic" | "Referral" | "Direct" | "Other". */
  channel: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  gclid: string | null;
  landing_page_path: string | null;
  referrer: string | null;
  /** Full first/last-touch state, stored as JSONB for future analysis. */
  attribution: AttributionState | null;
}

/** The scalar attribution columns (everything except the JSONB state). */
export const LEAD_ATTRIBUTION_SCALARS = [
  "channel",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "landing_page_path",
  "referrer",
] as const;

export const EMPTY_LEAD_ATTRIBUTION: LeadAttribution = {
  channel: null,
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  utm_content: null,
  utm_term: null,
  gclid: null,
  landing_page_path: null,
  referrer: null,
  attribution: null,
};

function nn(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s ? s : null;
}

/**
 * Build a lead attribution stamp from cookie state. FIRST-TOUCH WINS: the utm /
 * gclid / channel come from the first meaningful touch (the click that acquired
 * the lead), falling back to last-touch when there's no first-touch.
 */
export function leadAttributionFromState(state: AttributionState | null): LeadAttribution {
  const touch: AttributionTouch | null = state?.first_touch || state?.last_touch || null;
  if (!touch) return { ...EMPTY_LEAD_ATTRIBUTION, attribution: state ?? null };
  return {
    channel: deriveChannel(touch),
    utm_source: nn(touch.source),
    utm_medium: nn(touch.medium),
    utm_campaign: nn(touch.campaign),
    utm_content: nn(touch.content),
    utm_term: nn(touch.term),
    gclid: nn(touch.gclid),
    landing_page_path: nn(touch.landing_path),
    referrer: nn(touch.referrer),
    attribution: state ?? null,
  };
}

/** True when the stamp carries a real marketing signal worth persisting. */
export function hasAttributionSignal(a: LeadAttribution | null | undefined): boolean {
  if (!a) return false;
  return !!(a.gclid || a.utm_campaign || a.utm_medium || (a.channel && a.channel !== "Direct") || a.attribution);
}

/** Columns for a NEW lead insert (only non-null values, plus the JSONB state). */
export function newLeadAttributionColumns(a: LeadAttribution | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!a) return out;
  for (const k of LEAD_ATTRIBUTION_SCALARS) {
    const v = a[k];
    if (v != null && v !== "") out[k] = v;
  }
  if (a.attribution) out.attribution = a.attribution;
  return out;
}

type ExistingAttribution = Partial<Record<(typeof LEAD_ATTRIBUTION_SCALARS)[number] | "attribution", unknown>>;

/**
 * FILL-IF-EMPTY patch for a FOLD (repeat submit into an existing lead). Only
 * fills columns the existing lead is MISSING — never overwrites an existing
 * first-touch channel/campaign/gclid. Returns {} when nothing needs filling.
 */
export function fillMissingAttribution(
  existing: ExistingAttribution,
  incoming: LeadAttribution | null | undefined,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (!incoming) return patch;
  for (const k of LEAD_ATTRIBUTION_SCALARS) {
    const cur = existing[k];
    const next = incoming[k];
    if ((cur == null || cur === "") && next != null && next !== "") patch[k] = next;
  }
  if (existing.attribution == null && incoming.attribution) patch.attribution = incoming.attribution;
  return patch;
}
