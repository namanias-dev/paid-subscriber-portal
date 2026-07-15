/**
 * Pure lead-sorting helpers for the Lead CRM Kanban columns. Kept side-effect
 * free so they can be unit-tested and reused. Sorting a card list never mutates
 * the input array.
 */
import type { Lead } from "@/lib/types";

export type KanbanSort = "newest" | "oldest" | "name";

export const KANBAN_SORTS: { value: KanbanSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "Name (A → Z)" },
];

function createdMs(l: Pick<Lead, "created_at">): number {
  const t = new Date(l.created_at).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Return a new array sorted by the chosen Kanban order (stable, non-mutating). */
export function sortLeads<T extends Pick<Lead, "created_at" | "name">>(list: T[], sort: KanbanSort): T[] {
  const out = [...list];
  out.sort((a, b) => {
    if (sort === "name") {
      return (a.name || "").localeCompare(b.name || "") || createdMs(b) - createdMs(a);
    }
    if (sort === "oldest") return createdMs(a) - createdMs(b);
    return createdMs(b) - createdMs(a); // newest
  });
  return out;
}
