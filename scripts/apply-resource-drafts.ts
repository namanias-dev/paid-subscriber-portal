/**
 * Apply the gold-standard rewritten drafts in content/resource-drafts/*.md to the
 * existing UPSC Resource drafts in the database.
 *
 * Each markdown file carries:
 *   - human-readable YAML frontmatter (for reviewers)
 *   - a machine-readable <!--META ... META--> JSON block (slug, seo, faq, related…)
 *   - the public HTML body between <BODY> and </BODY> markers
 *   - a non-public appendix (SEO Pack / JSON-LD / Fact Ledger / QA Report) that is
 *     NEVER pushed to the public body.
 *
 * The matching resource (by slug) is updated IN PLACE. status stays 'draft'
 * (pending Naman Sir review) — nothing is auto-published. reading_time is
 * auto-recalculated from the new body.
 *
 * DRY-RUN by default. Pass --commit to write. Pass --only=<slug> to limit.
 *
 *   node --env-file=.env.local --import tsx scripts/apply-resource-drafts.ts
 *   node --env-file=.env.local --import tsx scripts/apply-resource-drafts.ts --commit
 *   node --env-file=.env.local --import tsx scripts/apply-resource-drafts.ts --commit --only=upsc-exam-pattern-syllabus
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getResourceBySlug, updateResource } from "../lib/dataProvider";
import { normalizeResourceInput } from "../lib/resourceNormalize";
import type { CaSeo } from "../lib/types";

const COMMIT = process.argv.includes("--commit");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "content", "resource-drafts");

interface Meta {
  slug: string;
  title: string;
  summary: string;
  seoTitle?: string;
  metaDescription?: string;
  focusKeyword?: string;
  secondaryKeywords?: string[];
  tags?: string[];
  related?: { resource_slugs?: string[]; quiz_slugs?: string[]; webinar_slugs?: string[]; course_slugs?: string[] };
  faq?: { q: string; a: string }[];
}

function extract(raw: string, startTag: string, endTag: string): string | null {
  const s = raw.indexOf(startTag);
  const e = raw.indexOf(endTag);
  if (s === -1 || e === -1 || e < s) return null;
  return raw.slice(s + startTag.length, e).trim();
}

function wordCount(html: string): number {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean).length;
}

async function main() {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

  let applied = 0;
  let skipped = 0;
  const report: string[] = [];

  for (const file of files) {
    const raw = readFileSync(join(DIR, file), "utf8");
    const metaJson = extract(raw, "<!--META", "META-->");
    const body = extract(raw, "<BODY>", "</BODY>");
    if (!metaJson || !body) {
      console.error(`SKIP ${file}: missing META or BODY markers.`);
      skipped++;
      continue;
    }
    let meta: Meta;
    try {
      meta = JSON.parse(metaJson);
    } catch (err) {
      console.error(`SKIP ${file}: invalid META JSON — ${(err as Error).message}`);
      skipped++;
      continue;
    }
    if (ONLY && meta.slug !== ONLY) continue;

    const existing = await getResourceBySlug(meta.slug);
    if (!existing) {
      console.error(`SKIP ${file}: no resource with slug "${meta.slug}".`);
      skipped++;
      continue;
    }

    const seo: CaSeo = {
      ...existing.seo,
      title: meta.seoTitle || existing.seo?.title || null,
      description: meta.metaDescription || existing.seo?.description || null,
      keywords: [meta.focusKeyword, ...(meta.secondaryKeywords || [])].filter(Boolean).join(", "),
      structured_data_enabled: true,
      faq_schema_enabled: (meta.faq?.length || 0) > 0,
    };

    const patch = {
      slug: meta.slug, // keep the clean URL — normalize regenerates slug from title otherwise
      title: meta.title,
      summary: meta.summary,
      focus_keyword: meta.focusKeyword || null,
      tags: Array.from(new Set([...(existing.tags || []), ...(meta.tags || []), "pending-review"])),
      body_html: body,
      faq: meta.faq || [],
      related: { ...existing.related, ...(meta.related || {}) },
      seo,
      reading_time: undefined, // auto-recalc from new body
      status: "draft" as const,
    };

    const normalized = normalizeResourceInput(patch);
    if (!normalized.ok || !normalized.value) {
      console.error(`SKIP ${file}: normalize failed — ${normalized.error}`);
      skipped++;
      continue;
    }
    const v = normalized.value;
    const wc = wordCount(body);
    report.push(
      `${meta.slug.padEnd(42)} ${String(wc).padStart(5)}w  ${String(v.reading_time).padStart(2)}min  faq:${(meta.faq?.length || 0)}  rel:${(meta.related?.resource_slugs?.length || 0)}`
    );

    if (COMMIT) {
      const updated = await updateResource(existing.id, v as Record<string, unknown>);
      if (updated) applied++;
      else {
        console.error(`FAIL ${file}: update returned null.`);
        skipped++;
      }
    }
  }

  console.log("\n=== RESOURCE DRAFTS " + (COMMIT ? "APPLIED" : "DRY-RUN") + " ===");
  console.log("slug".padEnd(42) + " words  read  faq  related");
  report.forEach((r) => console.log(r));
  console.log(`\n${COMMIT ? "applied" : "would apply"}: ${report.length}   skipped: ${skipped}`);
  if (!COMMIT) console.log("Re-run with --commit to write.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
