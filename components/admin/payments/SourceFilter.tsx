"use client";

import { useMemo } from "react";
import { SOURCE_DEFINITIONS, SOURCE_DISPLAY_ORDER, type SourceDisplayKey } from "@/lib/marketing/sourceDefinitions";

/**
 * Multi-select Source (derived CRM channel) filter — pill grid over
 * {@link SOURCE_DISPLAY_ORDER}, so the option set is the SAME as the source
 * card + expanded panel (no separate hand-maintained list). Selecting one or
 * more sources narrows the payments list to matching leads; deselecting all
 * disables the filter.
 *
 * Rendering-only: the parent owns the `Set<SourceDisplayKey>` and its URL
 * serialisation. Options that aren't present in the current data are still
 * shown (so an admin can click "Google Ads" even in a week with 0 Google Ads
 * paid — the empty result is itself signal). Ordering matches the card.
 */
export default function SourceFilter({
  value,
  onChange,
}: {
  value: Set<SourceDisplayKey>;
  onChange: (next: Set<SourceDisplayKey>) => void;
}) {
  const options = useMemo(
    () => SOURCE_DISPLAY_ORDER.map((k) => ({ key: k, def: SOURCE_DEFINITIONS[k] })),
    [],
  );

  function toggle(k: SourceDisplayKey) {
    const next = new Set(value);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onChange(next);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map(({ key, def }) => {
        const active = value.has(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            aria-pressed={active}
            title={def.definition}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold motion-reduce:transition-none ${active ? "border-primary bg-primary/10 text-primary" : "border-line text-ink2 hover:border-primary/50"}`}
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: def.color }}
            />
            {def.label}
          </button>
        );
      })}
    </div>
  );
}

/** Encode a filter state to a URL query value ("meta_ads,google_ads") — sorted
 * for deterministic URLs. Empty set → empty string (parent should drop the
 * param entirely so a clean URL stays clean). */
export function encodeSourceFilter(value: Set<SourceDisplayKey>): string {
  if (value.size === 0) return "";
  return [...value].map(displayToSlug).sort().join(",");
}

/** Decode a URL query value back into a filter state. Unknown slugs are
 * silently dropped so a bookmarked URL for an old channel name never breaks
 * the page. Case-insensitive. */
export function decodeSourceFilter(raw: string | null | undefined): Set<SourceDisplayKey> {
  const set = new Set<SourceDisplayKey>();
  if (!raw) return set;
  const known = new Map<string, SourceDisplayKey>();
  for (const k of SOURCE_DISPLAY_ORDER) known.set(displayToSlug(k), k);
  for (const part of raw.split(",")) {
    const slug = part.trim().toLowerCase();
    const hit = known.get(slug);
    if (hit) set.add(hit);
  }
  return set;
}

/** URL-safe slug for a display key — lower-case, spaces → underscores. */
export function displayToSlug(key: SourceDisplayKey): string {
  return key.toLowerCase().replace(/\s+/g, "_");
}
