import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CinematicHome from "@/components/public/home-cinematic/CinematicHome";
import {
  getPublishedCourses,
  getPublicWebinars,
  getSiteSettings,
  getPublicCaArticles,
} from "@/lib/dataProvider";
import { getPurchaseSnapshot, coursePurchaseMap } from "@/lib/purchaseStatus";
import { getWhatsNew } from "@/lib/announcements";
import { whatsappLink } from "@/lib/phone";
import { buildHomeV2Metadata, buildHomeV2JsonLd } from "@/components/public/home-v2/seo";
import { isCinematicHomeEnabled } from "@/lib/homeCinematic/flag";
import { guardCourses } from "@/lib/homeCinematic/fixtureGuard";

/**
 * `/home-cinematic` — the cinematic home PREVIEW route.
 *
 * This route is entirely ADDITIVE. It does not import, wrap, modify or shadow
 * `app/(site)/page.tsx`, and production `/` is completely unaware of it. It sits
 * inside the `(site)` group so it inherits the real nav, announcement bar, footer,
 * floating WhatsApp action and AI widget from `app/(site)/layout.tsx` — the same
 * components, not reimplementations.
 *
 * FLAG: off unless `NEXT_PUBLIC_CINEMATIC_HOME_ENABLED === "true"`. When off the
 * route 404s via `notFound()`, so an accidental deploy cannot expose a work in
 * progress. Rollback is removing the env var and redeploying.
 *
 * INDEXING: `robots: noindex, nofollow`. It is also absent from `app/sitemap.ts`,
 * which uses an explicit static allowlist — so no change to that file was needed
 * and none was made.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  if (!isCinematicHomeEnabled()) return { title: "Not found", robots: { index: false, follow: false } };

  // Reuse the SHARED builder `/` already uses, so title/description/OG/Twitter are
  // identical and this preview is a faithful switch candidate rather than a page
  // that would silently drop metadata on promotion. `components/.../seo.ts` was
  // written for exactly this: "when V2 is only being previewed the caller layers
  // `robots: { index: false }` on top".
  const settings = await getSiteSettings();
  const base = buildHomeV2Metadata(settings);

  return {
    ...base,
    // SELF-referential canonical, deliberately NOT the shared builder's "/".
    // A noindex page canonicalising to `/` is a conflicting signal that can, in
    // the worst case, propagate the noindex to the production homepage. Pointing
    // it at itself makes the preview incapable of affecting `/` at all.
    alternates: { canonical: "/home-cinematic" },
    // Belt and braces: a meta robots tag AND absence from the sitemap.
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  };
}

export default async function CinematicHomePreviewPage() {
  if (!isCinematicHomeEnabled()) notFound();

  // Every reader here is already used by `/` or by the site layout, and the three
  // hottest ones are React `cache()`-wrapped in lib/dataProvider.ts, so this page
  // does not add a duplicate round trip for them. No new reader was introduced,
  // and in particular no seventh mock-fallback reader.
  const [courses, webinars, settings, caArticles, whatsNew] = await Promise.all([
    getPublishedCourses(),
    getPublicWebinars(),
    getSiteSettings(),
    getPublicCaArticles(),
    getWhatsNew(),
  ]);

  const snapshot = await getPurchaseSnapshot();
  const purchaseMap = coursePurchaseMap(courses, snapshot);

  const flagged = caArticles.filter((a) => a.show_on_home);
  const homeCa = (flagged.length ? flagged : caArticles).slice(0, 3);

  const waLink = whatsappLink(
    settings.brand.whatsapp || settings.brand.support_phone,
    "Hi, I have a question about your courses / webinars.",
  );

  // Structured data, composed from the SAME builder `/` uses — minus its FAQPage
  // node. This preview does not render an FAQ, and FAQ markup for questions that
  // are not on the page is a claim the page cannot support; the honest-numbers rule
  // applies to machine-readable claims too. Organization and the Course ItemList
  // both describe content that IS rendered here, so both are kept.
  // The course list fed to JSON-LD goes through the SAME fixture guard as the
  // rendered list, so a mock fallback can never be published as structured data
  // either.
  const graph = buildHomeV2JsonLd(settings, guardCourses(courses).rows) as {
    "@context": string;
    "@graph": { "@type"?: string }[];
  };
  const jsonLd = { ...graph, "@graph": graph["@graph"].filter((n) => n["@type"] !== "FAQPage") };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <CinematicHome
        settings={settings}
        courses={courses}
        webinars={webinars}
        purchaseMap={purchaseMap}
        homeCa={homeCa}
        whatsNewItems={whatsNew.barItems}
        waLink={waLink}
      />
    </>
  );
}
