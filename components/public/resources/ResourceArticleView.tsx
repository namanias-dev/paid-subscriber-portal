"use client";

import { useEffect } from "react";
import { ga4Event } from "@/lib/analytics/ga4";

/**
 * Fires a single GA4 `resource_article_view` on mount for a published /resources
 * article. Rendered from the (server) article page so we get an article-scoped
 * event ALONGSIDE the generic page_view. No PII — slug/category/title only.
 */
export default function ResourceArticleView({
  slug,
  category,
  title,
}: {
  slug: string;
  category?: string | null;
  title?: string | null;
}) {
  useEffect(() => {
    ga4Event("resource_article_view", {
      resource_slug: slug,
      resource_category: category ?? null,
      resource_title: title ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
