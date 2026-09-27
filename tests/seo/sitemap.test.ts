import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPublicSitemap } from "../../lib/seo/sitemapDocument.ts";
import { indexableUrl, SEO_ORIGIN, seoUrl, truthfulLastModified } from "../../lib/seoOrigin.ts";
import { isPublicCourseAvailable } from "../../lib/publicCourse.ts";
import { isPublicIndexableCaArticle, resolvePublicCaArticle } from "../../lib/publicCaArticle.ts";
import { notesProductPath } from "../../lib/store/paths.ts";
import type { CaArticle, Resource } from "../../lib/types.ts";

const ORIGIN = "https://www.namanias.com";

/** Audit C3: sitemap URLs that 404 because they fail the public course gate. */
const DEAD_COURSE_SLUGS = [
  "hcs-crash-course",
  "saarthi-gs-foundation-online",
  "saarthi-gs-foundation-offline",
  "digital-saarthi",
  "economy-foundation-for-upsc-2027-28-by-naman-sir",
  "beginner-upsc-masterclass",
  "safalta-online-foundation",
  "safalta-gs-foundation-batch-for-upsc-2027-28-29",
  "ethics-governance-mains",
  "free-counselling",
  "punjab-pcs-weekend-batch",
  "punjab-pcs-prelims-test-series",
  "safalta-june-2026-old",
];

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

function urls(entries: { url: string }[]): string[] {
  return entries.map((entry) => entry.url);
}

test("indexable origin is the www host, not the redirecting apex", () => {
  assert.equal(SEO_ORIGIN, ORIGIN);
  assert.equal(seoUrl("/sitemap.xml"), `${ORIGIN}/sitemap.xml`);
  assert.equal(seoUrl("/notes"), `${ORIGIN}/notes`);
  assert.equal(seoUrl("/"), ORIGIN);
  assert.equal(indexableUrl("https://namanias.com/courses/live", "/courses/live"), `${ORIGIN}/courses/live`);
  assert.equal(indexableUrl("/about", "/about"), `${ORIGIN}/about`);
  assert.equal(indexableUrl("about", "/about"), `${ORIGIN}/about`);
});

test("public course gate matches the course page and does not special-case -old", () => {
  assert.equal(isPublicCourseAvailable({ slug: "saarthi-old", status: "published", active: true }), true);
  assert.equal(isPublicCourseAvailable({ slug: "safalta-june-2026-old", status: "published", active: true }), true);
  assert.equal(isPublicCourseAvailable({ slug: "live", status: "published", active: undefined }), true);
  assert.equal(isPublicCourseAvailable({ slug: "draft", status: "draft", active: true }), false);
  assert.equal(isPublicCourseAvailable({ slug: "closed", status: "closed", active: true }), false);
  assert.equal(isPublicCourseAvailable({ slug: "hidden", status: "published", active: false }), false);
  assert.equal(isPublicCourseAvailable({ slug: "", status: "published", active: true }), false);
  assert.equal(isPublicCourseAvailable(null), false);

  const page = read("../../app/(site)/courses/[slug]/page.tsx");
  const loader = read("../../lib/dataProvider.ts");
  assert.match(page, /isPublicCourseAvailable\(course\)/);
  assert.match(loader, /isPublicCourseAvailable\(c\)/);
});

test("sitemap URLs use the www origin and include the Notes store", () => {
  const entries = buildPublicSitemap({
    notesProducts: [
      { slug: "polity", updated_at: "2026-03-01T00:00:00.000Z" },
      { slug: "economy", updated_at: "2026-04-02T00:00:00.000Z" },
    ],
    courses: [{ slug: "saarthi-old", status: "published", active: true, updated_at: "2025-01-15T00:00:00.000Z" }],
  });
  const list = urls(entries);
  assert.ok(list.every((url) => url.startsWith(`${ORIGIN}/`) || url === ORIGIN));
  assert.equal(list.some((url) => url.startsWith("https://namanias.com/") || url === "https://namanias.com"), false);
  assert.ok(list.includes(`${ORIGIN}/notes`));
  assert.ok(list.includes(`${ORIGIN}${notesProductPath("polity")}`));
  assert.ok(list.includes(`${ORIGIN}${notesProductPath("economy")}`));
  assert.ok(list.includes(`${ORIGIN}/courses/saarthi-old`));
  assert.equal(list.includes(`${ORIGIN}/notes/cart`), false);
});

test("unpublished and inactive courses stay out, including the known dead slugs", () => {
  const dead = DEAD_COURSE_SLUGS.map((slug, index) => ({
    slug,
    status: index % 2 === 0 ? ("draft" as const) : ("published" as const),
    active: index % 2 === 0 ? true : false,
    updated_at: "2024-01-01T00:00:00.000Z",
  }));
  const entries = buildPublicSitemap({
    courses: [
      ...dead,
      { slug: "saarthi-old", status: "published", active: true },
      { slug: "ncert-foundation", status: "published", active: true },
    ],
  });
  const list = urls(entries);
  for (const slug of DEAD_COURSE_SLUGS) {
    assert.equal(list.includes(`${ORIGIN}/courses/${slug}`), false, slug);
  }
  assert.ok(list.includes(`${ORIGIN}/courses/saarthi-old`));
  assert.ok(list.includes(`${ORIGIN}/courses/ncert-foundation`));
});

test("a published active slug ending in -old is listed; there is no -old exclusion", () => {
  const entries = buildPublicSitemap({
    courses: DEAD_COURSE_SLUGS.map((slug) => ({
      slug,
      status: "published" as const,
      active: true,
    })),
  });
  const list = urls(entries);
  for (const slug of DEAD_COURSE_SLUGS) {
    assert.ok(list.includes(`${ORIGIN}/courses/${slug}`), slug);
  }
  const sitemapSrc = read("../../app/sitemap.ts");
  const builderSrc = read("../../lib/seo/sitemapDocument.ts");
  assert.equal(sitemapSrc.includes("-old"), false);
  assert.equal(builderSrc.includes("-old"), false);
  assert.equal(sitemapSrc.includes("getAllCourses"), false);
  assert.match(sitemapSrc, /getPublishedCourses/);
  assert.match(sitemapSrc, /listStorefrontProducts/);
});

test("lastModified is a stored timestamp, never generation time", () => {
  const stamped = "2024-05-01T12:34:56.000Z";
  const entries = buildPublicSitemap({
    courses: [{ slug: "live-course", status: "published", active: true, updated_at: stamped }],
    webinars: [{ slug: "live-webinar" }],
    notesProducts: [{ slug: "polity", updated_at: stamped }],
    quizzes: [{ slug: "daily-quiz", is_public: true, status: "published", updated_at: "not-a-date" }],
  });
  const byUrl = new Map(entries.map((entry) => [entry.url, entry]));
  assert.equal(byUrl.get(`${ORIGIN}/courses/live-course`)?.lastModified?.toISOString(), stamped);
  assert.equal(byUrl.get(`${ORIGIN}/notes/polity`)?.lastModified?.toISOString(), stamped);
  assert.equal(byUrl.get(`${ORIGIN}/notes`)?.lastModified?.toISOString(), stamped);
  assert.equal(byUrl.get(`${ORIGIN}/webinars/live-webinar`)?.lastModified, undefined);
  assert.equal(byUrl.get(`${ORIGIN}/quizzes/daily-quiz`)?.lastModified, undefined);
  assert.equal(byUrl.get(`${ORIGIN}/about`)?.lastModified, undefined);
  assert.equal(byUrl.get(ORIGIN)?.lastModified, undefined);

  const bare = buildPublicSitemap({});
  for (const entry of bare) assert.equal(entry.lastModified, undefined);

  assert.equal(truthfulLastModified(null), undefined);
  assert.equal(truthfulLastModified("   "), undefined);
  assert.equal(truthfulLastModified("nope"), undefined);

  const sitemapSrc = read("../../app/sitemap.ts");
  const builderSrc = read("../../lib/seo/sitemapDocument.ts");
  assert.equal(sitemapSrc.includes("new Date("), false);
  assert.equal(builderSrc.includes("new Date("), false);
});

test("aggregate lastModified uses member updated_at, not the clock", () => {
  const article = {
    slug: "india-brics",
    status: "published",
    ca_date: "2026-09-01",
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-02T08:00:00.000Z",
    category_slug: "economy",
    tags: ["gdp-growth"],
    seo: {},
  } as CaArticle;
  const resource = {
    slug: "best-books-for-upsc",
    category: "books",
    updated_at: "2026-02-02T00:00:00.000Z",
    seo: {},
  } as Resource;
  const entries = buildPublicSitemap({ caArticles: [article], resources: [resource] });
  const byUrl = new Map(entries.map((entry) => [entry.url, entry]));
  assert.equal(byUrl.get(`${ORIGIN}/current-affairs/india-brics`)?.lastModified?.toISOString(), "2026-09-02T08:00:00.000Z");
  assert.equal(byUrl.get(`${ORIGIN}/current-affairs/daily/2026-09-01`)?.lastModified?.toISOString(), "2026-09-02T08:00:00.000Z");
  assert.equal(byUrl.get(`${ORIGIN}/current-affairs/monthly/2026-09`)?.lastModified?.toISOString(), "2026-09-02T08:00:00.000Z");
  assert.equal(byUrl.get(`${ORIGIN}/current-affairs/tag/gdp-growth`)?.lastModified?.toISOString(), "2026-09-02T08:00:00.000Z");
  assert.equal(byUrl.get(`${ORIGIN}/resources/books`)?.lastModified?.toISOString(), "2026-02-02T00:00:00.000Z");
});

test("a non-indexable current-affairs article cannot enter the sitemap", () => {
  const canonicalAlias = {
    slug: "radio-tagged-white-rumped-vulture",
    status: "published",
    publish_at: "2026-06-30T11:48:00.000Z",
    ca_date: "2026-06-30",
    created_at: "2026-06-30T11:49:18.500Z",
    updated_at: "2026-06-30T11:55:41.328Z",
    tags: ["vulture"],
    seo: { canonical_slug: "radio-tagged-white-rumped-vulture-electrocuted" },
  } as CaArticle;
  const draft = {
    slug: "unpublished-note",
    status: "draft",
    created_at: "2026-01-01T00:00:00.000Z",
    tags: ["draft-only-tag"],
    seo: {},
  } as CaArticle;
  const hidden = {
    slug: "hidden-note",
    status: "published",
    created_at: "2026-01-01T00:00:00.000Z",
    tags: ["hidden-only-tag"],
    seo: { noindex: true },
  } as CaArticle;
  const future = {
    slug: "future-note",
    status: "published",
    publish_at: "2099-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    tags: ["future-only-tag"],
    seo: {},
  } as CaArticle;
  const articles = [canonicalAlias, draft, hidden, future];
  const entries = buildPublicSitemap({ caArticles: articles });
  const list = urls(entries);

  assert.equal(isPublicIndexableCaArticle(draft), false);
  assert.equal(isPublicIndexableCaArticle(hidden), false);
  assert.equal(isPublicIndexableCaArticle(future), false);
  assert.equal(isPublicIndexableCaArticle(canonicalAlias), true);
  assert.equal(list.includes(`${ORIGIN}/current-affairs/unpublished-note`), false);
  assert.equal(list.includes(`${ORIGIN}/current-affairs/hidden-note`), false);
  assert.equal(list.includes(`${ORIGIN}/current-affairs/future-note`), false);
  assert.equal(list.includes(`${ORIGIN}/current-affairs/tag/draft-only-tag`), false);
  assert.equal(list.includes(`${ORIGIN}/current-affairs/tag/hidden-only-tag`), false);
  assert.equal(list.includes(`${ORIGIN}/current-affairs/tag/future-only-tag`), false);
  assert.ok(list.includes(`${ORIGIN}/current-affairs/radio-tagged-white-rumped-vulture-electrocuted`));
  assert.equal(list.includes(`${ORIGIN}/current-affairs/radio-tagged-white-rumped-vulture`), false);

  const hubs = new Set([`${ORIGIN}/current-affairs/daily`, `${ORIGIN}/current-affairs/monthly`]);
  const articleUrls = list.filter((url) => /\/current-affairs\/[^/]+$/.test(url) && !hubs.has(url));
  for (const url of articleUrls) {
    const requested = url.slice(url.lastIndexOf("/") + 1);
    assert.ok(resolvePublicCaArticle(articles, requested), requested);
  }
  assert.equal(
    resolvePublicCaArticle(articles, "radio-tagged-white-rumped-vulture-electrocuted")?.slug,
    "radio-tagged-white-rumped-vulture",
  );
  assert.equal(resolvePublicCaArticle(articles, "unpublished-note"), null);

  const page = read("../../app/(site)/current-affairs/[slug]/page.tsx");
  const loader = read("../../lib/dataProvider.ts");
  assert.match(page, /getCaArticleBySlug\(params\.slug\)/);
  assert.match(loader, /resolvePublicCaArticle/);
  assert.match(read("../../lib/seo/sitemapDocument.ts"), /isPublicIndexableCaArticle/);
});

test("robots.txt advertises the www sitemap and does not prefer the apex host", () => {
  const robots = read("../../app/robots.ts");
  assert.match(robots, /sitemap: seoUrl\("\/sitemap\.xml"\)/);
  assert.match(robots, /host: SEO_ORIGIN/);
  assert.equal(robots.includes("SITE_URL"), false);
  assert.equal(robots.includes("https://namanias.com"), false);
});

test("notes hub canonical is the www self URL and non-SEO consumers keep SITE_URL", () => {
  const notes = read("../../app/(site)/notes/page.tsx");
  assert.match(notes, /canonical: seoUrl\("\/notes"\)/);
  const config = read("../../lib/config.ts");
  assert.match(config, /NEXT_PUBLIC_SITE_URL \|\| "https:\/\/namanias\.com"/);
  const sms = read("../../lib/sms/config.ts");
  assert.match(sms, /SITE_URL/);
  assert.equal(sms.includes("SEO_ORIGIN"), false);
  const coursePay = read("../../lib/eazypay.ts");
  const storePay = read("../../lib/store/payments/eazypay.ts");
  assert.match(coursePay, /https:\/\/namanias\.com\/api\/v1\/bank\/payment/);
  assert.match(storePay, /https:\/\/namanias\.com\/api\/v1\/bank\/payment/);
  assert.equal(coursePay.includes("SEO_ORIGIN"), false);
  assert.equal(storePay.includes("SEO_ORIGIN"), false);
});
