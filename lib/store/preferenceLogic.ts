/**
 * Pure Student Voices helpers. Safe for tests and client type imports.
 * No Next cookies, no database.
 */
import type { StoreCategory } from "./catalogue";

export const PREFERENCE_SOURCES = ["voices", "landing", "unknown"] as const;
export type PreferenceSource = (typeof PREFERENCE_SOURCES)[number];

export const PUBLIC_DEMAND_MIN = 5;
export const MAX_PREF_SUBJECTS = 24;

export function isPreferenceSource(v: unknown): v is PreferenceSource {
  return typeof v === "string" && (PREFERENCE_SOURCES as readonly string[]).includes(v);
}

export function sanitizePreferenceSource(v: unknown): PreferenceSource {
  if (v === "voices" || v === "landing") return v;
  return "unknown";
}

export function publicDemandView(
  count: number,
  maxCount: number,
): {
  share: number;
  count: number | null;
  label: string | null;
} {
  const safe = Math.max(0, Math.floor(count));
  const share = maxCount > 0 ? Math.min(1, safe / maxCount) : 0;
  if (safe <= 0) return { share: 0, count: null, label: null };
  if (safe < PUBLIC_DEMAND_MIN) return { share, count: null, label: "Growing interest" };
  return { share, count: safe, label: null };
}

export function combinations<T>(items: T[], k: number): T[][] {
  const src = [...items];
  const out: T[][] = [];
  const walk = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = start; i < src.length; i++) {
      acc.push(src[i]);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  if (k < 1 || src.length < k) return out;
  walk(0, []);
  return out;
}

export interface CoSelectionPair {
  a: string;
  b: string;
  count: number;
  pct_of_a: number;
  pct_of_b: number;
}

export interface CoSelectionTrio {
  ids: [string, string, string];
  count: number;
}

export function computeCoSelections(sets: string[][]): {
  pairs: CoSelectionPair[];
  trios: CoSelectionTrio[];
  also_selected: Record<string, Array<{ id: string; count: number; pct: number }>>;
} {
  const pairCounts = new Map<string, number>();
  const trioCounts = new Map<string, number>();
  const subjectTotals = new Map<string, number>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  for (const raw of sets) {
    const unique = [...new Set(raw.filter(Boolean))].sort();
    for (const id of unique) subjectTotals.set(id, (subjectTotals.get(id) || 0) + 1);
    for (const [a, b] of combinations(unique, 2)) {
      const key = pairKey(a, b);
      pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    }
    for (const trio of combinations(unique, 3)) {
      const key = trio.join("|");
      trioCounts.set(key, (trioCounts.get(key) || 0) + 1);
    }
  }

  const pairs: CoSelectionPair[] = [];
  for (const [key, count] of pairCounts) {
    const [a, b] = key.split("|");
    const totalA = subjectTotals.get(a) || 0;
    const totalB = subjectTotals.get(b) || 0;
    pairs.push({
      a,
      b,
      count,
      pct_of_a: totalA ? Math.round((count / totalA) * 100) : 0,
      pct_of_b: totalB ? Math.round((count / totalB) * 100) : 0,
    });
  }
  pairs.sort((x, y) => y.count - x.count || x.a.localeCompare(y.a));

  const trios: CoSelectionTrio[] = [];
  for (const [key, count] of trioCounts) {
    const ids = key.split("|") as [string, string, string];
    trios.push({ ids, count });
  }
  trios.sort((x, y) => y.count - x.count);

  const also_selected: Record<string, Array<{ id: string; count: number; pct: number }>> = {};
  for (const pair of pairs) {
    const push = (from: string, to: string, pct: number) => {
      if (!also_selected[from]) also_selected[from] = [];
      also_selected[from].push({ id: to, count: pair.count, pct });
    };
    push(pair.a, pair.b, pair.pct_of_a);
    push(pair.b, pair.a, pair.pct_of_b);
  }
  for (const id of Object.keys(also_selected)) {
    also_selected[id].sort((a, b) => b.pct - a.pct || b.count - a.count);
  }

  return { pairs, trios, also_selected };
}

export interface PreferenceSubject {
  id: string;
  slug: string;
  name: string;
  nav_label: string | null;
  meta: string | null;
  href: string;
  available: boolean;
  demand_share: number;
  demand_count: number | null;
  demand_label: string | null;
}

export function buildPreferenceSubjects(
  categories: Pick<StoreCategory, "id" | "slug" | "name" | "nav_label" | "short_description">[],
  availabilityByCategory: Map<string, boolean>,
  demandByCategory: Map<string, number>,
  metaByCategory: Map<string, string | null>,
): PreferenceSubject[] {
  const maxDemand = Math.max(0, ...[...demandByCategory.values()]);
  return categories.map((c) => {
    const demand = demandByCategory.get(c.id) || 0;
    const pub = publicDemandView(demand, maxDemand);
    return {
      id: c.id,
      slug: c.slug,
      name: c.nav_label || c.name,
      nav_label: c.nav_label,
      meta: metaByCategory.get(c.id) || c.short_description,
      href: `/notes/${c.slug}`,
      available: availabilityByCategory.get(c.id) === true,
      demand_share: pub.share,
      demand_count: pub.count,
      demand_label: pub.label,
    };
  });
}
