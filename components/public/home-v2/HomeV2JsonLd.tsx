import { buildHomeV2JsonLd } from "./seo";
import type { SiteSettings, Course } from "@/lib/types";

/**
 * Server-rendered JSON-LD for Home V2 (Organization + Course ItemList + FAQPage).
 * Only rendered on the V2 variant, so the default homepage is unaffected.
 */
export default function HomeV2JsonLd({ settings, courses }: { settings: SiteSettings; courses: Course[] }) {
  const json = buildHomeV2JsonLd(settings, courses);
  return (
    <script
      type="application/ld+json"
      // Data is derived from trusted admin settings / live data; JSON.stringify
      // safely escapes it for embedding in the document.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}
