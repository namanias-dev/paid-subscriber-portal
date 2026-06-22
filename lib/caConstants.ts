import type { CaArticleType, CaGsPaper } from "./types";

/** Canonical category grid (slug + display name). Admin can enrich each with a
 * description/SEO via the ca_categories table; this list guarantees the grid is
 * always complete even before any admin edits. */
export const DEFAULT_CA_CATEGORIES: { slug: string; name: string; icon: string }[] = [
  { slug: "polity-governance", name: "Polity & Governance", icon: "🏛️" },
  { slug: "economy", name: "Economy", icon: "📈" },
  { slug: "environment", name: "Environment", icon: "🌱" },
  { slug: "science-tech", name: "Science & Tech", icon: "🔬" },
  { slug: "international-relations", name: "International Relations", icon: "🌍" },
  { slug: "security", name: "Security", icon: "🛡️" },
  { slug: "social-issues", name: "Social Issues", icon: "🤝" },
  { slug: "geography", name: "Geography", icon: "🗺️" },
  { slug: "history-culture", name: "History & Culture", icon: "🏺" },
  { slug: "ethics", name: "Ethics", icon: "⚖️" },
  { slug: "schemes", name: "Schemes", icon: "📋" },
  { slug: "reports-indices", name: "Reports & Indices", icon: "📊" },
  { slug: "judiciary", name: "Judiciary", icon: "⚖️" },
  { slug: "parliament-bills-acts", name: "Parliament/Bills/Acts", icon: "📜" },
];

export function caCategoryName(slug: string | null | undefined): string {
  if (!slug) return "";
  const found = DEFAULT_CA_CATEGORIES.find((c) => c.slug === slug);
  return found?.name || slug.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export const CA_ARTICLE_TYPES: { value: CaArticleType; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "editorial", label: "Editorial" },
  { value: "prelims_facts", label: "Prelims Facts" },
  { value: "mains_analysis", label: "Mains Analysis" },
];

export function caArticleTypeLabel(type: string | null | undefined): string {
  return CA_ARTICLE_TYPES.find((t) => t.value === type)?.label || "Daily";
}

export const CA_GS_PAPERS: CaGsPaper[] = ["GS1", "GS2", "GS3", "GS4", "Essay", "Prelims"];

export const CA_STATUSES = ["draft", "scheduled", "published", "archived", "disabled"] as const;
