import type { SiteSettings, HeroConfig, PopupConfig, HomeContent } from "./types";

/**
 * Default home/site content. The public site renders DB settings merged OVER
 * these defaults, so every field is optional and any empty/missing value falls
 * back here — existing installs with no settings row render exactly as before.
 */

export const DEFAULT_HERO: Required<Omit<HeroConfig, "portrait_url" | "portrait_alt">> & {
  portrait_url: string | null;
  portrait_alt: string | null;
} = {
  badge: "⭐ Chandigarh's #1 Personal UPSC Academy",
  headline: "Crack UPSC the Right Way — with Naman Sir",
  subheading:
    "Chandigarh's Premier UPSC, IAS, HAS, HCS & PCS Academy for Online & Offline Preparation. Foundation, Optionals, Test Series & Mentorship.",
  portrait_url: null,
  portrait_alt: "Naman Sir — UPSC Mentor",
  stats: [
    { value: 388, suffix: "K+", label: "Instagram" },
    { value: 220, suffix: "K+", label: "YouTube" },
    { value: 9, suffix: "+", label: "Years" },
    { value: 9, suffix: "+", label: "Top AIRs" },
  ],
  buttons: [
    { enabled: true, label: "Book Free Demo", href: "/demo", style: "primary" },
    { enabled: true, label: "₹50 Beginner Masterclass", href: "/courses/beginner-upsc-masterclass", style: "saffron" },
  ],
};

export const DEFAULT_POPUP: Required<PopupConfig> = {
  enabled: false,
  delay_seconds: 5,
  heading: "GET FREE UPSC MATERIAL",
  subtext: "Fill this form to get instant access — limited time!",
  button_text: "Get Free Access",
  success_message: "🎉 You're in! Our team will reach out with your free material shortly.",
  interest_options: ["UPSC Foundation", "Optional Subject", "Test Series", "Mentorship", "Just exploring"],
};

export const DEFAULT_CONTENT: Required<HomeContent> = {
  trust_bar: [
    "⭐ 388K+ Instagram",
    "▶ 220K+ YouTube",
    "🏅 9+ Top AIRs",
    "📚 9+ Years",
    "📍 Chandigarh Sector 17C",
  ],
  why_heading: "A genuinely personal way to prepare for UPSC",
  why_sub: "Why Naman Sir",
  modes_heading: "Learn your way",
  modes_sub: "Online, offline, recorded or hybrid — your schedule, your choice.",
  courses_heading: "Explore our courses",
  courses_sub: "Foundation to optionals, test series to mentorship.",
  results_heading: "Results that speak",
  results_sub: "Our students, their ranks — across UPSC CSE & IFoS.",
  free_heading: "Free resources to get started",
  band_heading: "Start for just ₹50",
  band_subtext: "Join the Beginner Masterclass or book a 1-week demo and experience our teaching before you commit.",
  band_primary_label: "₹50 Masterclass",
  band_primary_href: "/courses/beginner-upsc-masterclass",
  band_secondary_label: "1-Week Demo",
  band_secondary_href: "/demo",
  testimonials_heading: "What aspirants say",
  locations_heading: "Visit us in Chandigarh",
  locations_sub: "Our flagship offline centre is at Sector 17C, Chandigarh. We serve aspirants across the region.",
  faq_heading: "Frequently asked questions",
  lead_heading: "Get free counselling",
  lead_sub: "Talk to our team and build a personalised UPSC roadmap — completely free.",
};

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  id: "home",
  logo_url: null,
  logo_alt: "Naman Sharma IAS Academy",
  hero: DEFAULT_HERO,
  popup: DEFAULT_POPUP,
  content: DEFAULT_CONTENT,
};

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Shallow-merge a stored (possibly partial) settings row over the defaults. */
export function mergeSiteSettings(row: Partial<SiteSettings> | null | undefined): SiteSettings {
  const r = row || {};
  return {
    id: r.id || "home",
    logo_url: r.logo_url ?? DEFAULT_SITE_SETTINGS.logo_url,
    logo_alt: r.logo_alt || DEFAULT_SITE_SETTINGS.logo_alt,
    hero: { ...DEFAULT_HERO, ...(isObj(r.hero) ? r.hero : {}) },
    popup: { ...DEFAULT_POPUP, ...(isObj(r.popup) ? r.popup : {}) },
    content: { ...DEFAULT_CONTENT, ...(isObj(r.content) ? r.content : {}) },
    updated_at: r.updated_at,
  };
}
