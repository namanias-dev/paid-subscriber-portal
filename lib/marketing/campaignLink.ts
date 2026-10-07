/**
 * General-purpose UTM campaign link builder (PURE + client-safe).
 *
 * Fixes the #1 attribution blind spot for organic Instagram: today every reel,
 * story and bio link shares the same generic URL, so all of it collapses into a
 * single `instagram / (none)` bucket with no content identity. A per-piece UTM
 * link lets the existing first-party attribution pipeline (`lib/attribution.ts`)
 * record exactly which reel / post / story / channel produced a visit — and
 * therefore a registration, lead, admission or order.
 *
 * This helper is intentionally destination-agnostic: it works for ANY landing
 * path (webinar, course, notes, home, custom) and ANY channel. It only shapes
 * the URL + UTM params; nothing here reads or writes state.
 *
 * Standard UTM conventions:
 *   utm_source   = where the click came from   (instagram, youtube, whatsapp…)
 *   utm_medium   = the kind of link            (reel, story, bio, paid_social…)
 *   utm_campaign = the marketing initiative     (ai_notes_launch…)
 *   utm_content  = the exact creative / piece   (ai_notes_risk_reel…)
 *   utm_term     = optional keyword / detail
 */

/** Default public host. Overridable at build time via NEXT_PUBLIC_SITE_URL. */
export const CAMPAIGN_SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://www.namanias.com"
).replace(/\/+$/, "");

/** Normalise a UTM value: trim, lowercase, collapse whitespace/odd chars to "_". */
export function normalizeUtmValue(value: string | null | undefined): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export interface CampaignLinkInput {
  /** A path ("/webinar/foo") or an absolute URL ("https://..."). */
  destination: string;
  source: string;
  medium: string;
  campaign: string;
  content?: string;
  term?: string;
}

export interface CampaignLinkResult {
  url: string;
  /** The UTM params that were actually applied (after normalisation). */
  params: Record<string, string>;
  /** Human-readable problems that make the link unusable/weak (never throws). */
  warnings: string[];
}

function resolveBase(destination: string): URL | null {
  const dest = (destination || "").trim();
  if (!dest) return null;
  try {
    if (/^https?:\/\//i.test(dest)) return new URL(dest);
    const path = dest.startsWith("/") ? dest : `/${dest}`;
    return new URL(path, CAMPAIGN_SITE_URL);
  } catch {
    return null;
  }
}

/**
 * Build a trackable campaign URL. Never throws — an invalid destination returns
 * an empty url with a warning so the caller/UI can surface it.
 */
export function buildCampaignUrl(input: CampaignLinkInput): CampaignLinkResult {
  const warnings: string[] = [];
  const base = resolveBase(input.destination);
  if (!base) {
    return { url: "", params: {}, warnings: ["Enter a valid destination path or URL."] };
  }

  const params: Record<string, string> = {};
  const set = (key: string, raw: string | null | undefined, required = false, label = key) => {
    const v = normalizeUtmValue(raw);
    if (v) {
      base.searchParams.set(key, v);
      params[key] = v;
    } else if (required) {
      warnings.push(`${label} is required for reliable attribution.`);
    }
  };

  set("utm_source", input.source, true, "Source");
  set("utm_medium", input.medium, true, "Medium");
  set("utm_campaign", input.campaign, true, "Campaign");
  set("utm_content", input.content);
  set("utm_term", input.term);

  return { url: base.toString(), params, warnings };
}

/** Channel presets prefill sensible source + medium (and hint at content). */
export interface ChannelPreset {
  id: string;
  label: string;
  source: string;
  medium: string;
  /** Example placeholder for the per-piece content slug. */
  contentHint: string;
}

export const CHANNEL_PRESETS: ChannelPreset[] = [
  { id: "ig_reel", label: "Instagram Reel", source: "instagram", medium: "reel", contentHint: "ai_notes_risk_reel" },
  { id: "ig_post", label: "Instagram Post", source: "instagram", medium: "post", contentHint: "polity_carousel_01" },
  { id: "ig_story", label: "Instagram Story", source: "instagram", medium: "story", contentHint: "webinar_story_03" },
  { id: "ig_bio", label: "Instagram Bio / Link-in-bio", source: "instagram", medium: "bio", contentHint: "linkinbio" },
  { id: "ig_dm", label: "Instagram Auto-DM (ManyChat)", source: "instagram", medium: "autodm", contentHint: "notes_keyword" },
  { id: "meta_ad", label: "Meta Ad (paid)", source: "meta", medium: "paid_social", contentHint: "ad_variant_a" },
  { id: "google_ad", label: "Google Ad (paid)", source: "google", medium: "cpc", contentHint: "search_brand" },
  { id: "youtube", label: "YouTube", source: "youtube", medium: "video", contentHint: "explainer_01" },
  { id: "whatsapp", label: "WhatsApp", source: "whatsapp", medium: "message", contentHint: "broadcast_oct" },
  { id: "telegram", label: "Telegram", source: "telegram", medium: "community", contentHint: "channel_pin" },
  { id: "email", label: "Email", source: "email", medium: "newsletter", contentHint: "oct_digest" },
  { id: "influencer", label: "Influencer / Partner", source: "influencer", medium: "referral", contentHint: "partner_name" },
];

/** Common landing destinations to pick from (free-text path is also allowed). */
export const DESTINATION_PRESETS: { id: string; label: string; path: string }[] = [
  { id: "home", label: "Home", path: "/" },
  { id: "webinars", label: "Webinars (listing)", path: "/webinar" },
  { id: "courses", label: "Courses (listing)", path: "/courses" },
  { id: "notes", label: "Notes Store", path: "/notes" },
];
