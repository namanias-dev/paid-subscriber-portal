import type { Webinar } from "./types";

/**
 * Webinar "lineage" = the connected component of webinars linked by the
 * duplicate feature via previous_webinar_id / next_webinar_id. A re-run of the
 * same webinar (e.g. "Masterclass 28 Jun" → its 4 Jul duplicate) is the SAME
 * product for the student. Payments only store item_slug, so when the slug
 * changes across a duplicate a prior PAID on the old slug would otherwise be
 * ignored — that is the root of the false "payment failed" popup (Problem 3).
 *
 * These pure helpers let access/recovery logic treat the whole lineage as one:
 * "paid" is sticky across the lineage and a later failed attempt on a sibling
 * slug never overrides an earlier success.
 */
type LineageWebinar = Pick<Webinar, "id" | "slug" | "previous_webinar_id" | "next_webinar_id">;

/**
 * Map every webinar slug → the set of slugs in its lineage (including itself).
 * Singletons map to a one-element set, so callers can use it unconditionally.
 */
export function buildWebinarLineageSlugMap(webinars: LineageWebinar[]): Map<string, Set<string>> {
  const byId = new Map<string, LineageWebinar>();
  for (const w of webinars) if (w.id) byId.set(w.id, w);

  // Undirected adjacency over prev/next (both directions, deduped).
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!a || !b || a === b) return;
    (adj.get(a) || adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) || adj.set(b, new Set()).get(b)!).add(a);
  };
  for (const w of webinars) {
    if (!w.id) continue;
    if (w.previous_webinar_id && byId.has(w.previous_webinar_id)) link(w.id, w.previous_webinar_id);
    if (w.next_webinar_id && byId.has(w.next_webinar_id)) link(w.id, w.next_webinar_id);
  }

  // BFS connected components → slug sets.
  const compById = new Map<string, Set<string>>(); // id → set of ids in component
  const seen = new Set<string>();
  for (const w of webinars) {
    const start = w.id;
    if (!start || seen.has(start)) continue;
    const ids = new Set<string>();
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const cur = queue.shift()!;
      ids.add(cur);
      for (const nb of adj.get(cur) || []) {
        if (!seen.has(nb)) { seen.add(nb); queue.push(nb); }
      }
    }
    for (const id of ids) compById.set(id, ids);
  }

  const out = new Map<string, Set<string>>();
  for (const w of webinars) {
    if (!w.slug) continue;
    const ids = compById.get(w.id) || new Set([w.id]);
    const slugs = new Set<string>();
    for (const id of ids) {
      const s = byId.get(id)?.slug;
      if (s) slugs.add(s);
    }
    slugs.add(w.slug);
    out.set(w.slug, slugs);
  }
  return out;
}

/**
 * Expand a set of "paid" webinar slugs to include every lineage-sibling slug,
 * so a success anywhere in a lineage marks the whole lineage as paid/registered.
 */
export function expandPaidSlugsByLineage(paidSlugs: Iterable<string>, webinars: LineageWebinar[]): Set<string> {
  const lineage = buildWebinarLineageSlugMap(webinars);
  const out = new Set<string>();
  for (const slug of paidSlugs) {
    out.add(slug);
    const sibs = lineage.get(slug);
    if (sibs) for (const s of sibs) out.add(s);
  }
  return out;
}
