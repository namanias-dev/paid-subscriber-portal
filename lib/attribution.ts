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
  if (ownHost && (host === clean(ownHost) || host.endsWith(`.${clean(ownHost)}`))) {
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
  return {
    source,
    medium: clean(input.params.utm_medium) || null,
    campaign: (input.params.utm_campaign || "").trim() || null,
    content: (input.params.utm_content || "").trim() || null,
    term: (input.params.utm_term || "").trim() || null,
    landing_path: input.path || null,
    referrer: (input.referrer || "").trim() || null,
    raw,
  };
}

/** Does this touch carry a real marketing signal (utm, external referrer, or Meta click)? */
export function touchIsMeaningful(t: AttributionTouch): boolean {
  return t.source !== "direct" || !!t.campaign || !!t.medium || !!t.fbclid || !!t.fbc;
}

/** Merge a new touch into existing state: first-touch frozen, last-touch rolling. */
export function mergeAttribution(
  existing: AttributionState | null,
  touch: AttributionTouch,
  nowISO: string,
): AttributionState {
  const prev = existing || { first_touch: null, last_touch: null };
  const first =
    prev.first_touch ||
    (touchIsMeaningful(touch) || !prev.last_touch ? { ...touch, first_seen_at: nowISO } : null);
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
