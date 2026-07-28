/**
 * Trust-rail provenance gate.
 *
 * This module exists because a prior audit of this project established that
 * production carries fabricated marketing data, and that several readers in
 * `lib/dataProvider.ts` silently substitute `lib/mockData.ts` fixtures when a
 * table comes back empty. On an internal CRM screen that is embarrassing. On a
 * PUBLIC marketing page it is a false public claim, so the preview refuses to
 * render anything it cannot attribute to a source.
 *
 * The rules, in order of strictness:
 *
 *   1. NEVER invent, round, or "tidy" a number here. Every figure is passed
 *      through verbatim from its source.
 *   2. A figure sourced from a CODE DEFAULT (`lib/homeDefaults.ts`,
 *      `lib/config.ts` ACADEMY.stats) is NOT rendered. Those are seed values
 *      committed to git, not claims anyone has verified — and they are provably
 *      stale (code says 388K Instagram / 9+ years, the CMS says 500K / 15+).
 *   3. A figure the ADMIN authored in `site_settings` IS rendered, because it is
 *      the site owner's own editorial claim and is already the exact claim that
 *      production `/` publishes today. Reusing an existing owner claim is not
 *      fabrication by us; inventing a new one would be.
 *   4. A figure that OUR OWN DATABASE CONTRADICTS is dropped, even when the admin
 *      authored it. This is the "omit rather than invent" rule and it is why
 *      "100+ Top AIRs" does not appear on the preview: the `toppers` list the
 *      same settings row carries has 5 entries, so we cannot stand behind 100+.
 */
import type { HeroStat, SiteSettings, Topper } from "@/lib/types";
import { DEFAULT_HERO, DEFAULT_CONTENT, DEFAULT_TOPPERS } from "@/lib/homeDefaults";

export type Provenance = "admin" | "code-default" | "contradicted" | "derived";

export interface TrustItem {
  label: string;
  /** Pre-rendered display value, verbatim from source. Never recomputed. */
  display: string;
  provenance: Provenance;
  /** True only for `provenance === "admin"` / `"derived"`. */
  renderable: boolean;
  /** Human-readable reason, surfaced in the audit table (never in the UI). */
  note: string;
}

function statKey(s: HeroStat): string {
  return `${s.label}|${s.value}|${s.suffix}`;
}

/**
 * Is this array the committed code default rather than an admin-authored one?
 *
 * `mergeSiteSettings` overrides `hero.stats` and `content.trust_bar` as WHOLE
 * ARRAYS — it never merges them element-wise. So the only correct question is
 * "did the settings row supply this array at all", and the only signal we have
 * post-merge is whether the array is identical to the default in its entirety.
 * Comparing element-by-element would be wrong: it would discard a genuine admin
 * value that merely happens to coincide with the seed (production's "220K+
 * YouTube" is exactly this case).
 */
function isWholeArrayDefault(actual: string[], defaults: string[]): boolean {
  if (actual.length !== defaults.length) return false;
  return actual.every((v, i) => v === defaults[i]);
}

/**
 * Labels whose claim we can cross-check against our own tables. If the claim
 * exceeds what the database can evidence, we drop it rather than publish it.
 */
const CROSS_CHECKED = /\bair|rank|topper|result|selection\b/i;

function countVerifiableToppers(toppers: Topper[] | undefined): number {
  const list = toppers || [];
  // A topper row seeded from the original hardcoded list is not evidence.
  const seeded = new Set(DEFAULT_TOPPERS.map((t) => `${t.rank}|${t.exam}`));
  return list.filter((t) => {
    const rank = (t.rank || "").trim();
    if (!rank) return false;
    return !seeded.has(`${rank}|${t.exam}`);
  }).length;
}

/**
 * Classify the admin hero stats into what may and may not be published.
 *
 * `toppersCount` is the number of topper rows in the SAME settings row, used as
 * the contradiction check for any AIR/rank claim.
 */
export function classifyStats(stats: HeroStat[] | undefined, toppers: Topper[] | undefined): TrustItem[] {
  const list = stats || [];
  const verifiableToppers = countVerifiableToppers(toppers);
  const publishedToppers = (toppers || []).filter((t) => (t.rank || "").trim()).length;
  const allDefault = isWholeArrayDefault(list.map(statKey), (DEFAULT_HERO.stats || []).map(statKey));

  return list.map((s) => {
    const display = `${s.value.toLocaleString("en-IN")}${s.suffix}`;
    const base = { label: s.label, display };

    if (allDefault) {
      return {
        ...base,
        provenance: "code-default" as const,
        renderable: false,
        note: "hero.stats is identical to lib/homeDefaults.ts DEFAULT_HERO.stats — no admin-authored value exists, so this is a committed seed, not a verified claim.",
      };
    }

    if (CROSS_CHECKED.test(s.label)) {
      // The claim is about ranks. We hold the rank list; check we can back it.
      if (s.value > publishedToppers) {
        return {
          ...base,
          provenance: "contradicted" as const,
          renderable: false,
          note: `Claims ${display} but the same settings row publishes only ${publishedToppers} topper rows (${verifiableToppers} non-seed). Omitted rather than published.`,
        };
      }
    }

    return {
      ...base,
      provenance: "admin" as const,
      renderable: true,
      note: "Authored in site_settings by the site owner; identical to the claim production / already publishes.",
    };
  });
}

/**
 * The trust-bar strings admin authored, minus anything that is byte-identical to
 * the committed code default. Leading emoji are stripped for the gold-marker
 * treatment, matching how the live Home V2 trust bar already renders them.
 */
export function classifyTrustBar(trustBar: string[] | undefined): TrustItem[] {
  const list = trustBar || [];
  const allDefault = isWholeArrayDefault(
    list.map((s) => s.trim()),
    (DEFAULT_CONTENT.trust_bar || []).map((s) => s.trim()),
  );
  return list.map((raw) => {
    const trimmed = raw.trim();
    const display = trimmed.replace(/^[^A-Za-z0-9₹]+/, "").trim();
    if (allDefault) {
      return {
        label: display,
        display,
        provenance: "code-default" as const,
        renderable: false,
        note: "content.trust_bar is identical to lib/homeDefaults.ts DEFAULT_CONTENT.trust_bar — committed seed copy, not an admin claim.",
      };
    }
    if (CROSS_CHECKED.test(display)) {
      return {
        label: display,
        display,
        provenance: "contradicted" as const,
        renderable: false,
        note: "Rank/AIR claim in free text cannot be cross-checked against the toppers list; omitted.",
      };
    }
    return {
      label: display,
      display,
      provenance: "admin" as const,
      renderable: true,
      note: "Authored in site_settings.content.trust_bar; already published by production /.",
    };
  });
}

export interface TrustAudit {
  stats: TrustItem[];
  bar: TrustItem[];
  /** Ranks we can actually evidence, for the honest results line. */
  publishedToppers: number;
}

export function auditTrust(settings: SiteSettings): TrustAudit {
  return {
    stats: classifyStats(settings.hero?.stats, settings.toppers),
    bar: classifyTrustBar(settings.content?.trust_bar),
    publishedToppers: (settings.toppers || []).filter((t) => (t.rank || "").trim()).length,
  };
}

export function renderable(items: TrustItem[]): TrustItem[] {
  return items.filter((i) => i.renderable);
}
