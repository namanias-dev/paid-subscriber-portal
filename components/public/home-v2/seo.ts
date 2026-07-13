import type { Metadata } from "next";
import { SITE_URL, ACADEMY } from "@/lib/config";
import type { SiteSettings, Course } from "@/lib/types";
import { FAQ_V2 } from "./content";

/** Absolute URL helper — turns a relative/absolute asset path into an absolute URL. */
function abs(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const u = url.trim();
  if (!u) return undefined;
  if (/^https?:\/\//i.test(u)) return u;
  return `${SITE_URL}${u.startsWith("/") ? "" : "/"}${u}`;
}

const DEFAULT_TITLE = "Naman Sharma IAS Academy — Crack UPSC the Right Way";
const DEFAULT_DESC =
  "Chandigarh's most personal UPSC academy. Foundation, Optionals, Test Series & Mentorship — Online, Offline & Hybrid. Daily current affairs, MCQs, PYQs and live classes by Naman Sir.";

/**
 * SEO metadata for the Home V2 experience. Filled with a canonical URL,
 * OpenGraph + Twitter cards and a metadataBase — the gaps the current homepage
 * has today. When V2 is only being previewed (not promoted via env) the caller
 * layers `robots: { index: false }` on top so it can't cause duplicate content.
 */
export function buildHomeV2Metadata(settings: SiteSettings): Metadata {
  const title = DEFAULT_TITLE;
  const description = (settings.hero?.subheading || DEFAULT_DESC).slice(0, 320);
  const ogImage = abs(settings.hero?.portrait_url) || abs(settings.logo_url);
  const images = ogImage ? [{ url: ogImage }] : undefined;

  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      url: SITE_URL,
      siteName: ACADEMY.name,
      title,
      description,
      images,
      locale: "en_IN",
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title,
      description,
      images: images?.map((i) => i.url),
    },
  };
}

type Json = Record<string, unknown>;

/**
 * JSON-LD graph for the homepage: Organization (brand identity + socials),
 * an ItemList of published courses, and a FAQPage matching the on-page FAQ.
 * All values come from admin settings / live data — nothing invented.
 */
export function buildHomeV2JsonLd(settings: SiteSettings, courses: Course[]): Json {
  const brand = settings.brand;
  const logo = abs(settings.logo_url) || abs(settings.hero?.portrait_url);
  const sameAs = [brand?.instagram, brand?.youtube, brand?.telegram]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s && /^https?:\/\//i.test(s));

  const organization: Json = {
    "@type": "EducationalOrganization",
    "@id": `${SITE_URL}/#organization`,
    name: brand?.name || ACADEMY.name,
    url: SITE_URL,
    ...(logo ? { logo } : {}),
    ...(brand?.address ? { address: { "@type": "PostalAddress", streetAddress: brand.address, addressCountry: "IN" } } : {}),
    ...(brand?.support_email ? { email: brand.support_email } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };

  const courseList: Json = {
    "@type": "ItemList",
    name: "UPSC Courses by Naman Sharma IAS Academy",
    itemListElement: courses.slice(0, 12).map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Course",
        name: c.title,
        ...(c.description ? { description: c.description.slice(0, 300) } : {}),
        url: `${SITE_URL}/courses/${c.slug}`,
        provider: { "@type": "EducationalOrganization", name: brand?.name || ACADEMY.name, sameAs: SITE_URL },
      },
    })),
  };

  const faqPage: Json = {
    "@type": "FAQPage",
    mainEntity: FAQ_V2.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return {
    "@context": "https://schema.org",
    "@graph": [organization, courseList, faqPage],
  };
}
