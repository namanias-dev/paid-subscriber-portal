import type { SiteSettings, HeroConfig, PopupConfig, HomeContent, BrandConfig, Topper, NavConfig, AboutContent } from "./types";
import { normalizeLeaderboardSettings, DEFAULT_LEADERBOARD_SETTINGS } from "./leaderboardConfig";
import { ACADEMY, SUPPORT } from "./config";

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
  logo_height: 48,
  show_wordmark: true,
  wordmark: "Naman Sharma",
  wordmark_sub: "IAS Academy",
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
  quiz_lead_gate: true,
  quiz_quote:
    "Every question you attempt today is a decision you'll make as an officer tomorrow. Practice isn't preparation for the exam — it's preparation for the chair you're destined to fill.",
  quiz_quote_author: "Naman Sharma IAS Academy",
};

export const DEFAULT_BRAND: Required<BrandConfig> = {
  name: ACADEMY.name,
  short_name: ACADEMY.shortName,
  tagline: ACADEMY.tagline,
  address: ACADEMY.address,
  support_phone: SUPPORT.phone,
  support_email: SUPPORT.email,
  whatsapp: SUPPORT.phone,
  maps_url: "",
  maps_embed_url: "",
  instagram: ACADEMY.instagram,
  youtube: ACADEMY.youtube,
  telegram: ACADEMY.telegram,
};

/** Seeded from the original hardcoded topper list so existing installs render as before. */
export const DEFAULT_TOPPERS: Topper[] = [
  { id: "t1", name: "", rank: "AIR 84", exam: "UPSC CSE", order: 0 },
  { id: "t2", name: "Shivani", rank: "AIR 122", exam: "UPSC CSE", order: 1 },
  { id: "t3", name: "Vineet", rank: "AIR 231", exam: "UPSC CSE", order: 2 },
  { id: "t4", name: "Sahil", rank: "AIR 245", exam: "IFoS", order: 3 },
  { id: "t5", name: "Aditi", rank: "AIR 351", exam: "UPSC CSE", order: 4 },
  { id: "t6", name: "Manu", rank: "AIR 434", exam: "UPSC CSE", order: 5 },
  { id: "t7", name: "", rank: "AIR 617", exam: "UPSC CSE", order: 6 },
  { id: "t8", name: "Gourav", rank: "AIR 914", exam: "UPSC CSE", order: 7 },
  { id: "t9", name: "Rudraksh", rank: "AIR 944", exam: "UPSC CSE", order: 8 },
];

export const DEFAULT_NAV: NavConfig = { overrides: {} };

export const DEFAULT_ABOUT: AboutContent = {
  hero_eyebrow: "About",
  hero_title: "9+ years of making UPSC personal in Chandigarh",
  hero_intro:
    "Naman Sharma IAS Academy was built on one belief — that sincere, personal mentorship beats crowded coaching halls. With small batches, direct faculty access and a results-first culture, we've helped aspirants secure top ranks across UPSC CSE & IFoS.",
  mentor_heading: "Meet Naman Sir",
  mentor_body:
    "A mentor known for clarity, consistency and a genuinely personal approach. Naman Sir has guided thousands of aspirants with daily current affairs, structured foundation courses, optionals and rigorous test series — online, offline and hybrid.\n\n\"Chandigarh se bhi UPSC crack hota hai\" isn't a slogan — it's a promise we keep every year.",
  mentor_quote: "",
  values_heading: "Our values",
  values: [
    { icon: "🤝", title: "Personal first", desc: "Every student matters. Small batches, real attention." },
    { icon: "📈", title: "Results-driven", desc: "Proven methods, refined over 9+ years." },
    { icon: "💛", title: "Accessible", desc: "Affordable, honest, and student-friendly pricing." },
  ],
};

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  id: "home",
  logo_url: null,
  logo_alt: "Naman Sharma IAS Academy",
  hero: DEFAULT_HERO,
  popup: DEFAULT_POPUP,
  content: DEFAULT_CONTENT,
  brand: DEFAULT_BRAND,
  toppers: DEFAULT_TOPPERS,
  nav: DEFAULT_NAV,
  about: DEFAULT_ABOUT,
  leaderboard: DEFAULT_LEADERBOARD_SETTINGS,
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
    brand: { ...DEFAULT_BRAND, ...(isObj(r.brand) ? r.brand : {}) },
    // Toppers: use the stored list when present (admin owns it); else seed defaults.
    toppers: Array.isArray(r.toppers) ? r.toppers : DEFAULT_TOPPERS,
    nav: { overrides: { ...(isObj(r.nav) && isObj((r.nav as NavConfig).overrides) ? (r.nav as NavConfig).overrides : {}) } },
    about: { ...DEFAULT_ABOUT, ...(isObj(r.about) ? r.about : {}) },
    leaderboard: normalizeLeaderboardSettings(r.leaderboard),
    updated_at: r.updated_at,
  };
}
