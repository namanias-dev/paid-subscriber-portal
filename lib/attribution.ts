/**
 * First-party attribution: normalize UTM/referrer into a stable source, and
 * maintain first-touch (frozen) + last-touch (rolling) in a readable cookie.
 *
 * Pure module — no next/* or DOM imports — so it's safe to use on the server
 * (request cookies) AND the client (document.cookie / Tracker).
 */

export const VISITOR_COOKIE = "nsa_vid";
export const ATTR_COOKIE = "nsa_attr";
export const CONSENT_COOKIE = "nsa_consent";
export const SESSION_COOKIE = "nsa_sid";
export const CONSENT_VERSION = 1;

export interface AttributionTouch {
  source: string;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
  landing_path: string | null;
  referrer: string | null;
  /** Raw source/domain kept for "other"/"referral" so nothing is lost. */
  raw?: string | null;
  /**
   * Meta click identifiers, captured additively at landing. Never PII:
   *  - fbclid: raw click id from the ad URL (?fbclid=...)
   *  - fbc/fbp: the `_fbc`/`_fbp` browser cookies (set by the pixel), used as
   *    non-PII match keys for CAPI so attribution works WITHOUT advanced matching.
   * All optional — absent for non-Meta traffic. Ride the existing JSONB touch, so
   * they persist onto buyers.first_touch/last_touch with no schema migration.
   */
  fbclid?: string | null;
  fbc?: string | null;
  fbp?: string | null;
  /**
   * Google Ads click identifier, captured additively at landing (?gclid=... —
   * supplied automatically by Google auto-tagging). Never PII. Absent for
   * non-Google traffic. Rides the existing JSONB touch — no schema migration.
   */
  gclid?: string | null;
  /**
   * Google Ads iOS/Android in-app click identifiers (?wbraid= / ?gbraid=). Ride
   * alongside `gclid` for traffic where privacy-safe click ids are used instead
   * of the classic gclid (typical for App/iOS 14+). Non-PII.
   */
  wbraid?: string | null;
  gbraid?: string | null;
  /**
   * FULL AD-HIERARCHY IDENTIFIERS (additive). These are the ids and human names
   * Meta/Google Ads inject via URL tokens (?campaign_id=…&adset_id=…&ad_id=…&
   * ad_name=…) — see docs/naman-ai/reports/attribution-full-capture.md for the
   * copy-paste URL parameter blocks. All optional/non-PII; absent for non-paid
   * traffic. Ride the existing JSONB touch so `leads.attribution` picks them up
   * with no schema change; the flat scalar columns on `webinar_registrations`
   * and `payments` are populated by `adCaptureStampFromState` (see
   * `lib/marketing/adCaptureStamp.ts`).
   */
  utm_id?: string | null;
  campaign_id?: string | null;
  adset_id?: string | null;
  ad_id?: string | null;
  ad_name?: string | null;
}

export interface AttributionState {
  first_touch: (AttributionTouch & { first_seen_at: string }) | null;
  last_touch: (AttributionTouch & { last_seen_at: string }) | null;
}

export interface ConsentState {
  analytics: boolean;
  marketing: boolean;
  version: number;
}

/** normalized source -> alias list (case-insensitive, protocol/www stripped). */
const SOURCE_ALIASES: Record<string, string[]> = {
  instagram: ["ig", "insta", "instagram", "instagram.com", "l.instagram.com", "ig_ad"],
  facebook: ["fb", "facebook", "facebook.com", "m.facebook.com", "fb_ad", "meta"],
  whatsapp: ["wa", "whatsapp", "whatsapp.com", "wa.me", "chat.whatsapp.com"],
  google: ["google", "google.com", "googleads", "gads", "adwords", "google.co.in"],
  youtube: ["yt", "youtube", "youtube.com", "youtu.be"],
  telegram: ["tg", "telegram", "t.me"],
};

const ALIAS_TO_SOURCE: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [src, aliases] of Object.entries(SOURCE_ALIASES)) {
    m[src] = src;
    for (const a of aliases) m[a] = src;
  }
  return m;
})();

function clean(v: string | null | undefined): string {
  return (v || "").trim().toLowerCase();
}

/** Strip protocol + leading www. from a host/url, returning the bare host. */
export function bareHost(referrer: string | null | undefined): string {
  const r = clean(referrer);
  if (!r) return "";
  try {
    const host = r.includes("://") ? new URL(r).host : r.split("/")[0];
    return host.replace(/^www\./, "");
  } catch {
    return r.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

/**
 * Resolve a normalized source from (utm_source, referrer, ownHost).
 * - utm_source present -> map via alias table, else "other" (raw kept).
 * - no utm -> derive from referrer host; our own host or empty -> "direct";
 *   known host -> mapped; any other external host -> "referral" (domain kept).
 */
export function normalizeSource(
  utmSource: string | null | undefined,
  referrer: string | null | undefined,
  ownHost?: string | null,
): { source: string; raw: string | null } {
  const u = clean(utmSource);
  if (u) {
    const mapped = ALIAS_TO_SOURCE[u];
    if (mapped) return { source: mapped, raw: null };
    return { source: "other", raw: u };
  }
  const host = bareHost(referrer);
  if (!host) return { source: "direct", raw: null };
  // Normalize ownHost through the same bareHost path so `www.namanias.com` and
  // `namanias.com` match (previously `www.` on ownHost broke this and misclassified
  // internal self-referrals as EXTERNAL "referral" — exactly the bug where a user
  // browsing on-site got a "Referral" first-touch that then blocked the real ad
  // click from being recorded as first-touch acquisition).
  const own = bareHost(ownHost || "");
  if (own && (host === own || host.endsWith(`.${own}`))) {
    return { source: "direct", raw: null };
  }
  const mappedHost = ALIAS_TO_SOURCE[host];
  if (mappedHost) return { source: mappedHost, raw: null };
  return { source: "referral", raw: host };
}

/** Build a touch from landing params (client passes parsed query + referrer). */
export function buildTouch(input: {
  params: Record<string, string | null | undefined>;
  referrer: string | null | undefined;
  path: string | null | undefined;
  ownHost?: string | null;
}): AttributionTouch {
  const { source, raw } = normalizeSource(input.params.utm_source, input.referrer, input.ownHost);
  const trimOrNull = (k: string): string | null => (input.params[k] || "").trim() || null;
  const touch: AttributionTouch = {
    source,
    medium: clean(input.params.utm_medium) || null,
    campaign: trimOrNull("utm_campaign"),
    content: trimOrNull("utm_content"),
    term: trimOrNull("utm_term"),
    landing_path: input.path || null,
    referrer: (input.referrer || "").trim() || null,
    raw,
  };
  // Full ad-hierarchy identifiers (additive; nullable). These are the ids/name
  // Meta and Google Ads inject via URL parameter tokens. `buildTouch` receives
  // them as flat params from the client — the caller is expected to have
  // parsed them off the landing URL alongside the standard utm_* keys.
  const utmId = trimOrNull("utm_id");
  const campaignId = trimOrNull("campaign_id");
  const adsetId = trimOrNull("adset_id");
  const adId = trimOrNull("ad_id");
  const adName = trimOrNull("ad_name");
  if (utmId) touch.utm_id = utmId;
  if (campaignId) touch.campaign_id = campaignId;
  if (adsetId) touch.adset_id = adsetId;
  if (adId) touch.ad_id = adId;
  if (adName) touch.ad_name = adName;
  return touch;
}

/** Does this touch carry a real marketing signal (utm, external referrer, or ad click)? */
export function touchIsMeaningful(t: AttributionTouch): boolean {
  return (
    t.source !== "direct" ||
    !!t.campaign ||
    !!t.medium ||
    !!t.fbclid ||
    !!t.fbc ||
    !!t.gclid ||
    !!t.wbraid ||
    !!t.gbraid ||
    !!t.campaign_id ||
    !!t.adset_id ||
    !!t.ad_id
  );
}

/**
 * Strong acquisition signal — an unambiguous paid/campaign click identifier or
 * an explicit campaign tag. These are the touches paid attribution SHOULD win on:
 * anything without one is either Direct, Organic, or an ambient site-referral
 * (aggregator/wiki/on-site bounce), never something a marketer paid for.
 *
 * The ad-hierarchy ids (`campaign_id`/`adset_id`/`ad_id`) are just as
 * unambiguous as `gclid`/`fbclid` — they only appear when Meta or Google
 * templates injected them, which never happens on organic/referral traffic.
 */
export function touchHasAcquisitionSignal(t: AttributionTouch): boolean {
  return (
    !!t.gclid ||
    !!t.fbclid ||
    !!t.fbc ||
    !!t.wbraid ||
    !!t.gbraid ||
    !!t.campaign ||
    !!t.campaign_id ||
    !!t.adset_id ||
    !!t.ad_id
  );
}

/** Merge a new touch into existing state: first-touch frozen, last-touch rolling. */
export function mergeAttribution(
  existing: AttributionState | null,
  touch: AttributionTouch,
  nowISO: string,
): AttributionState {
  const prev = existing || { first_touch: null, last_touch: null };
  // FIRST-TOUCH, marketing-aware — priority (top wins, never demoted):
  //  1. nothing captured yet → record this touch (meaningful or a Direct placeholder);
  //  2. existing NON-meaningful placeholder (Direct/organic, no campaign/click id)
  //     is UPGRADED to the first meaningful marketing touch that arrives — so a
  //     returning/organic visitor who later clicks a Google ad is correctly
  //     attributed instead of being stuck on Direct;
  //  3. existing meaningful-but-AMBIENT touch (external referrer/other, still
  //     without a click id or campaign — e.g. an aggregator hop or a same-tab
  //     bounce whose referrer survived) is UPGRADED to a subsequent PAID AD CLICK
  //     (gclid / fbclid / fbc / explicit campaign). A paid ad click is a first-
  //     class acquisition — it must not be blocked by an ambient referrer that
  //     preceded it. This is the root fix for the "testing11" case where a stale
  //     on-site referrer first-touch masked the actual Google Ads acquisition.
  //  4. an existing first-touch that ALREADY carries an acquisition signal
  //     (gclid/fbclid/campaign) is NEVER overwritten (first-touch wins).
  let first = prev.first_touch;
  if (!first) {
    first = { ...touch, first_seen_at: nowISO };
  } else if (!touchIsMeaningful(first) && touchIsMeaningful(touch)) {
    first = { ...touch, first_seen_at: nowISO };
  } else if (!touchHasAcquisitionSignal(first) && touchHasAcquisitionSignal(touch)) {
    first = { ...touch, first_seen_at: nowISO };
  }
  // Last-touch updates only on a meaningful new signal; otherwise keep prior.
  let last: AttributionState["last_touch"];
  if (touchIsMeaningful(touch) || !prev.last_touch) {
    // CAMPAIGN-STICKY last touch: roll to the new signal, but carry forward the
    // last-KNOWN campaign + Meta click ids (fbclid/fbc/fbp) when this touch didn't
    // carry its own. Otherwise a later organic/social visit (e.g. an in-app
    // Instagram referral with no utm) would ERASE the ad campaign that actually
    // drove a returning visitor — the click that matters is a middle touch the
    // 2-slot cookie can't keep. Never overwrites a real new campaign/click id.
    const carried: AttributionTouch = { ...touch };
    const prevLast = prev.last_touch;
    if (prevLast) {
      if (!carried.campaign && prevLast.campaign) carried.campaign = prevLast.campaign;
      if (!carried.fbclid && prevLast.fbclid) carried.fbclid = prevLast.fbclid;
      if (!carried.fbc && prevLast.fbc) carried.fbc = prevLast.fbc;
      if (!carried.fbp && prevLast.fbp) carried.fbp = prevLast.fbp;
      if (!carried.gclid && prevLast.gclid) carried.gclid = prevLast.gclid;
      if (!carried.wbraid && prevLast.wbraid) carried.wbraid = prevLast.wbraid;
      if (!carried.gbraid && prevLast.gbraid) carried.gbraid = prevLast.gbraid;
      // Ad-hierarchy stickiness: never let a later organic/internal hop erase
      // the ad-level ids/name that Meta or Google injected via the original
      // landing URL. Same rationale as the campaign/click-id carries above.
      if (!carried.utm_id && prevLast.utm_id) carried.utm_id = prevLast.utm_id;
      if (!carried.campaign_id && prevLast.campaign_id) carried.campaign_id = prevLast.campaign_id;
      if (!carried.adset_id && prevLast.adset_id) carried.adset_id = prevLast.adset_id;
      if (!carried.ad_id && prevLast.ad_id) carried.ad_id = prevLast.ad_id;
      if (!carried.ad_name && prevLast.ad_name) carried.ad_name = prevLast.ad_name;
    }
    last = { ...carried, last_seen_at: nowISO };
  } else {
    last = prev.last_touch;
  }
  return { first_touch: first, last_touch: last };
}

export function parseAttrCookie(raw: string | null | undefined): AttributionState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw));
    if (v && typeof v === "object") return v as AttributionState;
  } catch { /* ignore */ }
  return null;
}

export function serializeAttr(state: AttributionState): string {
  return encodeURIComponent(JSON.stringify(state));
}

export function parseConsentCookie(raw: string | null | undefined): ConsentState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw));
    if (v && typeof v === "object") return v as ConsentState;
  } catch { /* ignore */ }
  return null;
}

/**
 * Extract Meta non-PII match keys (fbc/fbp/fbclid) from a stored attribution
 * state. Prefers first-touch (the click that actually drove acquisition), falls
 * back to last-touch. Used server-side at the PAID chokepoint to attach match
 * signals to the CAPI event so it links to the ad WITHOUT advanced matching.
 */
export function metaIdentityFromState(state: AttributionState | null): {
  fbc: string | null;
  fbp: string | null;
  fbclid: string | null;
} {
  const ft = state?.first_touch || null;
  const lt = state?.last_touch || null;
  return {
    fbc: ft?.fbc || lt?.fbc || null,
    fbp: ft?.fbp || lt?.fbp || null,
    fbclid: ft?.fbclid || lt?.fbclid || null,
  };
}

/**
 * Extract the Google Ads click id from a stored attribution state. Prefers
 * first-touch (the click that drove acquisition), falls back to last-touch.
 */
export function googleIdentityFromState(state: AttributionState | null): { gclid: string | null } {
  const ft = state?.first_touch || null;
  const lt = state?.last_touch || null;
  return { gclid: ft?.gclid || lt?.gclid || null };
}

// ----------------------------- Marketing channel -----------------------------
// A coarse, filterable channel derived from a single touch. Kept deliberately
// small + deterministic so the CRM filter and the campaign report agree.

export const GOOGLE_ADS_CHANNEL = "Google Ads";
export const MARKETING_CHANNELS = [
  GOOGLE_ADS_CHANNEL,
  "Meta Ads",
  "Organic",
  "Referral",
  "Direct",
  "Other",
] as const;
export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];

const PAID_MEDIA = new Set(["cpc", "ppc", "paid", "paidsearch", "paid_search", "paid_social", "ppc_ads", "cpm"]);

/**
 * Derive the marketing channel for a touch.
 *  - gclid OR (source=google & paid medium)     → "Google Ads"
 *  - fbclid/fbc OR (meta source & paid medium)   → "Meta Ads"
 *  - known social/search source (non-paid)       → "Organic"
 *  - external referrer                           → "Referral"
 *  - own site / no signal                        → "Direct"
 *  - anything else (e.g. utm with unknown source)→ "Other"
 */
export function deriveChannel(touch: AttributionTouch | null | undefined): MarketingChannel {
  if (!touch) return "Direct";
  const source = clean(touch.source);
  const medium = clean(touch.medium);
  const paid = PAID_MEDIA.has(medium);
  if (touch.gclid || touch.wbraid || touch.gbraid || (source === "google" && paid)) return "Google Ads";
  if (touch.fbclid || touch.fbc || ((source === "facebook" || source === "instagram") && paid)) return "Meta Ads";
  if (["google", "instagram", "facebook", "youtube", "telegram", "whatsapp"].includes(source)) return "Organic";
  if (source === "referral") return "Referral";
  if (!source || source === "direct") return "Direct";
  return "Other";
}

/**
 * Coarse ad-platform tag derived from a single touch. SHARES the same paid-
 * medium/click-id predicates as `deriveChannel` (do not fork the logic — bugs
 * in one must never let the other classify differently).
 *
 *  - Meta   → fbclid / fbc / (facebook|instagram source & paid medium)
 *  - Google → gclid / wbraid / gbraid / (google source & paid medium)
 *  - Other  → any campaign-hierarchy id present (utm_source unknown, but the
 *             marketer clearly tagged the URL: keep it distinguishable from
 *             pure Direct/Organic/Referral, which return null).
 *  - null   → no touch OR nothing that resembles a paid ad click.
 */
export function derivePlatform(
  touch: AttributionTouch | null | undefined,
): "meta" | "google" | "other" | null {
  if (!touch) return null;
  const source = clean(touch.source);
  const medium = clean(touch.medium);
  const paid = PAID_MEDIA.has(medium);
  if (touch.fbclid || touch.fbc || ((source === "facebook" || source === "instagram") && paid)) return "meta";
  if (touch.gclid || touch.wbraid || touch.gbraid || (source === "google" && paid)) return "google";
  if (touch.campaign_id || touch.adset_id || touch.ad_id) return "other";
  return null;
}

/** A short readable attribution summary for record-stamping (source + campaign). */
export function flattenForStamp(state: AttributionState | null): {
  source: string | null;
  campaign: string | null;
  first_touch: AttributionState["first_touch"];
  last_touch: AttributionState["last_touch"];
} {
  const ft = state?.first_touch || null;
  const lt = state?.last_touch || null;
  return {
    source: ft?.source || lt?.source || null,
    campaign: ft?.campaign || lt?.campaign || null,
    first_touch: ft,
    last_touch: lt,
  };
}
