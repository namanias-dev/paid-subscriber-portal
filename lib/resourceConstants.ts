import type { ResourceCta } from "./types";

/**
 * Canonical Resource categories. Each has its own clean cluster page at
 * /resources/<slug>. These slugs are RESERVED — an article can never use one of
 * them as its own slug (the router treats them as category pages).
 */
export const RESOURCE_CATEGORIES: { slug: string; name: string; icon: string; blurb: string }[] = [
  { slug: "beginner", name: "Beginner Guides", icon: "beginner", blurb: "Start from zero — the complete Day-1 roadmap for new UPSC aspirants." },
  { slug: "strategy", name: "Strategy", icon: "strategy", blurb: "Prelims, Mains and answer-writing strategy that actually works." },
  { slug: "books", name: "Booklist & NCERTs", icon: "books", blurb: "The right books, NCERT strategy and how to read them." },
  { slug: "syllabus", name: "Syllabus & Pattern", icon: "syllabus", blurb: "The official UPSC syllabus and exam pattern, explained simply." },
  { slug: "optional", name: "Optional Subjects", icon: "optional", blurb: "How to choose and prepare your optional subject." },
  { slug: "prelims", name: "Prelims", icon: "prelims", blurb: "Everything for the UPSC Prelims — GS + CSAT." },
  { slug: "mains", name: "Mains", icon: "mains", blurb: "GS papers, essay and answer writing for the UPSC Mains." },
  { slug: "notes", name: "Free Notes & PDFs", icon: "notes_pdf", blurb: "Free, downloadable UPSC notes, roadmaps and booklists." },
  { slug: "local", name: "UPSC in Chandigarh", icon: "local", blurb: "UPSC coaching for Chandigarh, Mohali, Panchkula, Tricity & Himachal." },
];

/** Slugs reserved for category cluster pages (cannot be used as article slugs). */
export const RESERVED_RESOURCE_SLUGS = new Set<string>([
  ...RESOURCE_CATEGORIES.map((c) => c.slug),
  "feed.xml",
  "search",
]);

export function resourceCategoryName(slug: string | null | undefined): string {
  if (!slug) return "";
  const found = RESOURCE_CATEGORIES.find((c) => c.slug === slug);
  return found?.name || slug.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export function resourceCategoryMeta(slug: string | null | undefined) {
  return RESOURCE_CATEGORIES.find((c) => c.slug === slug) || null;
}

export const RESOURCE_STATUSES = ["draft", "scheduled", "published", "archived"] as const;

export const RESOURCE_EXAM_RELEVANCE: { value: string; label: string }[] = [
  { value: "beginner", label: "Beginner" },
  { value: "prelims", label: "Prelims" },
  { value: "mains", label: "Mains" },
  { value: "interview", label: "Interview" },
  { value: "all", label: "All stages" },
];

export const RESOURCE_DIFFICULTY: { value: string; label: string }[] = [
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

export const RESOURCE_TARGET_YEARS = ["evergreen", "2026", "2027", "2028", "2029"];

/**
 * The chronological journey stages, Day-1 → exam. `order_index` on an article
 * places it within the overall roadmap; the stage groups them visually.
 */
export const JOURNEY_STAGES: string[] = [
  "Stage 1: Getting Started",
  "Stage 2: Understand the Exam",
  "Stage 3: Build the Foundation",
  "Stage 4: Prelims Preparation",
  "Stage 5: Mains & Answer Writing",
  "Stage 6: Revision & Test Practice",
];

/** Preset CTA blocks the admin can insert (defaults are editable per article). */
export const CTA_PRESETS: { kind: ResourceCta["kind"]; title: string; description: string; cta_label: string; href: string }[] = [
  { kind: "webinar", title: "Join Naman Sir's Live UPSC Beginners Masterclass", description: "A free live session to plan your UPSC journey the right way.", cta_label: "Register free", href: "/webinars" },
  { kind: "course", title: "Start with the Safalta Foundation Batch", description: "Structured GS Foundation with mentorship by Naman Sir.", cta_label: "View course", href: "/courses" },
  { kind: "quiz", title: "Attempt free UPSC MCQs", description: "Test yourself with our daily prelims-style questions.", cta_label: "Start quiz", href: "/quizzes" },
  { kind: "whatsapp", title: "Talk to our team", description: "Have a question about your UPSC preparation? We're here to help.", cta_label: "Chat on WhatsApp", href: "/contact" },
  { kind: "centre", title: "Visit our Sector-17 Chandigarh Centre", description: "Meet Naman Sir and our mentors in person.", cta_label: "Get directions", href: "/contact" },
];

export function ctaPreset(kind: ResourceCta["kind"]) {
  return CTA_PRESETS.find((c) => c.kind === kind) || null;
}
