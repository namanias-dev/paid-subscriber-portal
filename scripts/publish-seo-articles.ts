/**
 * Publish the 21 long-form UPSC SEO articles from content/seo-articles/*.md into
 * the Resources table as LIVE, PUBLISHED content.
 *
 * Difference from apply-seo-articles.ts (which is a shared DRAFT ingester):
 *   - tags are OVERWRITTEN with the article's META tags (not unioned), so weak
 *     legacy tags are replaced — then deduped/slugified by normalizeResourceInput.
 *   - status is forced to "published" and publish_at is set to now (in the past
 *     by the time it renders), so isResourcePublished() returns true → instantly
 *     live on the force-dynamic /resources/[slug] route.
 *   - slug is passed explicitly to preserve it (normalize can regen from title).
 *
 * Scope: ONLY the 21 slugs in ALLOWED_SLUGS. No other resource is touched.
 *
 * CREATE-OR-UPDATE by slug. Idempotent: safe to re-run (re-asserts published
 * state, refreshes tags/keywords/body from the source files).
 *
 * DRY-RUN by default. Pass --commit to write. Pass --only=<slug> to limit.
 *
 *   node --env-file=.env.local --import tsx scripts/publish-seo-articles.ts
 *   node --env-file=.env.local --import tsx scripts/publish-seo-articles.ts --commit
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getResourceBySlug, addResource, updateResource, isResourcePublished } from "../lib/dataProvider";
import { normalizeResourceInput } from "../lib/resourceNormalize";
import { RESOURCE_CATEGORIES } from "../lib/resourceConstants";
import type { CaSeo } from "../lib/types";

const COMMIT = process.argv.includes("--commit");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "content", "seo-articles");
const VALID_CATS = new Set(RESOURCE_CATEGORIES.map((c) => c.slug));

/** The exact 21 articles this script is allowed to publish. */
const ALLOWED_SLUGS = new Set<string>([
  "upsc-eligibility-criteria-2027",
  "upsc-rank-wise-service-allocation",
  "ias-ips-ifs-irs-difference",
  "how-many-candidates-appear-for-upsc-every-year",
  "upsc-success-rate",
  "what-happens-after-clearing-upsc",
  "ias-officer-salary-power-role-career-growth",
  "ips-officer-salary-training-uniform-responsibilities",
  "important-government-schemes-for-upsc-2027",
  "important-supreme-court-judgments-for-upsc-2027",
  "important-reports-and-indices-for-upsc-2027",
  "ncert-books-for-upsc-class-6-to-12",
  "best-polity-book-for-upsc-laxmikanth-strategy",
  "best-history-books-for-upsc-prelims-mains",
  "best-geography-books-for-upsc-cse",
  "best-economy-book-for-upsc-beginners",
  "best-environment-book-for-upsc-prelims",
  "best-ethics-book-for-upsc-mains-gs-paper-4",
  "best-essay-book-for-upsc-mains",
  "best-csat-books-for-upsc-prelims",
  "best-current-affairs-sources-for-upsc",
]);

interface Meta {
  slug: string;
  title: string;
  summary: string;
  seoTitle?: string;
  metaDescription?: string;
  focusKeyword?: string;
  secondaryKeywords?: string[];
  category?: string;
  examRelevance?: string;
  difficulty?: string;
  targetYear?: string;
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

async function main() {
  if (!existsSync(DIR)) {
    console.error(`No folder ${DIR}. Nothing to publish.`);
    return;
  }
  const files = readdirSync(DIR).filter((f) => f.endsWith(".md")).sort();

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let published = 0;
  const report: string[] = [];

  for (const file of files) {
    const raw = readFileSync(join(DIR, file), "utf8");
    const metaJson = extract(raw, "<!--META", "META-->");
    const body = extract(raw, "<BODY>", "</BODY>");
    if (!metaJson || !body) continue;

    let meta: Meta;
    try {
      meta = JSON.parse(metaJson);
    } catch (err) {
      console.error(`SKIP ${file}: invalid META JSON — ${(err as Error).message}`);
      skipped++;
      continue;
    }
    if (!meta.slug || !meta.title) continue;
    // Only the 21 target articles — never touch anything else.
    if (!ALLOWED_SLUGS.has(meta.slug)) continue;
    if (ONLY && meta.slug !== ONLY) continue;

    const category = meta.category && VALID_CATS.has(meta.category) ? meta.category : "beginner";

    const existing = await getResourceBySlug(meta.slug);

    const seo: CaSeo = {
      ...(existing?.seo || {}),
      title: meta.seoTitle || existing?.seo?.title || null,
      description: meta.metaDescription || existing?.seo?.description || null,
      keywords: [meta.focusKeyword, ...(meta.secondaryKeywords || [])].filter(Boolean).join(", "),
      structured_data_enabled: true,
      faq_schema_enabled: (meta.faq?.length || 0) > 0,
    };

    const payload = {
      slug: meta.slug,
      title: meta.title,
      summary: meta.summary || "",
      body_html: body,
      category,
      subject: "General",
      exam_relevance: meta.examRelevance || "all",
      target_year: meta.targetYear || "evergreen",
      difficulty: meta.difficulty || "beginner",
      status: "published" as const,
      publish_at: new Date().toISOString(),
      author: "Naman Sharma IAS Academy",
      focus_keyword: meta.focusKeyword || null,
      // OVERWRITE (not union): weak legacy tags are replaced by the META tags.
      // normalizeResourceInput slugifies + dedupes these.
      tags: Array.from(new Set(meta.tags || [])),
      faq: meta.faq || [],
      related: { ...(existing?.related || {}), ...(meta.related || {}) },
      seo,
      is_local: category === "local",
      order_index: existing?.order_index ?? 0,
    };

    const normalized = normalizeResourceInput(payload);
    if (!normalized.ok || !normalized.value) {
      console.error(`SKIP ${file}: normalize failed — ${normalized.error}`);
      skipped++;
      continue;
    }
    const v = normalized.value as Record<string, unknown>;

    const tagCount = (v.tags as string[] | undefined)?.length ?? 0;
    const kwChars = ((v.seo as CaSeo | undefined)?.keywords || "").length;
    const bodyHtml = typeof v.body_html === "string" ? v.body_html : "";
    const hasSeoTags = /<h2>\s*SEO Tags\s*<\/h2>/i.test(bodyHtml);

    if (COMMIT) {
      const res = existing ? await updateResource(existing.id, v) : await addResource(v);
      if (res) {
        existing ? updated++ : created++;
        if (isResourcePublished(res)) published++;
      } else {
        console.error(`FAIL ${file}: write returned null.`);
        skipped++;
        continue;
      }
    }

    report.push(
      `${(existing ? "upd" : "new")} ${meta.slug.padEnd(50)} tags:${String(tagCount).padStart(2)} kw:${String(kwChars).padStart(4)}ch pub:${COMMIT ? "Y" : "-"} seoTags:${hasSeoTags ? "Y" : "N"}`
    );
  }

  console.log("\n=== SEO ARTICLES " + (COMMIT ? "PUBLISHED" : "DRY-RUN") + " ===");
  report.forEach((r) => console.log(r));
  console.log(
    `\narticles: ${report.length}   ${COMMIT ? `created: ${created}  updated: ${updated}  publishedLive: ${published}` : "(dry-run)"}   skipped: ${skipped}`
  );
  if (!COMMIT) console.log("Re-run with --commit to write (sets status=published, publish_at=now).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
