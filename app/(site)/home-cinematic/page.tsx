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
import { isCinematicHomeEnabled } from "@/lib/homeCinematic/flag";

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
  return {
    title: "Cinematic home preview — Naman Sharma IAS Academy",
    description:
      "Internal preview of the cinematic homepage experience. Not indexed and not linked from the public site.",
    // Belt and braces: a meta robots tag AND absence from the sitemap.
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
    alternates: { canonical: undefined },
    openGraph: undefined,
    twitter: undefined,
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

  return (
    <CinematicHome
      settings={settings}
      courses={courses}
      webinars={webinars}
      purchaseMap={purchaseMap}
      homeCa={homeCa}
      whatsNewItems={whatsNew.barItems}
      waLink={waLink}
    />
  );
}
