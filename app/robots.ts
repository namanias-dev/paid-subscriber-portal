import type { MetadataRoute } from "next";
import { SEO_ORIGIN, seoUrl } from "@/lib/seoOrigin";

/**
 * Keep scrapers off unauthenticated force-dynamic surfaces (enroll/purchase,
 * saved CA, cinematic preview) and all private app/API paths.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/dashboard",
          "/portal",
          "/payment",
          "/api",
          "/quiz-print",
          "/login",
          "/enroll",
          "/home-cinematic",
          "/current-affairs/saved",
          "/courses/*/enroll",
          "/quizzes/*/attempt",
          "/quizzes/*/result",
          "/lecture",
        ],
      },
    ],
    sitemap: seoUrl("/sitemap.xml"),
    host: SEO_ORIGIN,
  };
}
