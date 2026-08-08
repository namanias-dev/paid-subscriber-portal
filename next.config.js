/**
 * Stable per-deploy build id. On Vercel this is the commit SHA; locally it falls
 * back to a timestamp. It is exposed to the client as NEXT_PUBLIC_BUILD_ID and
 * returned by /api/version so out-of-date clients can detect a new deploy and
 * auto-refresh. (Also used as the Next build id so chunk URLs are deterministic.)
 */
const BUILD_ID = (
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  `dev-${Date.now()}`
).slice(0, 12);

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  generateBuildId: async () => BUILD_ID,
  // Ship the staff help/handbook markdown into the serverless function bundle so
  // the in-app Help panel can read docs/staff/*.md at runtime on Vercel.
  experimental: {
    outputFileTracingIncludes: {
      "/api/admin/help": ["./docs/staff/**/*.md"],
    },
  },
  images: {
    // Keep optimized variants ≥31d so stable public media URLs stay HITs.
    minimumCacheTTL: 60 * 60 * 24 * 31,
    remotePatterns: [
      // Supabase Storage public URLs (cover images, logo, portrait, etc.)
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
      // Same-origin public `/media/*` stream (and legacy absolute namanias URLs).
      { protocol: "https", hostname: "namanias.com" },
      { protocol: "https", hostname: "*.namanias.com" },
      // Optional R2 public bucket / custom CDN (CLOUDFLARE_R2_PUBLIC_BASE_URL).
      // Never allow signed *.r2.cloudflarestorage.com — those thrash the cache.
      { protocol: "https", hostname: "*.r2.dev" },
      ...(() => {
        const base = (
          process.env.NEXT_PUBLIC_MEDIA_CDN_BASE ||
          process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL ||
          ""
        ).trim();
        if (!base) return [];
        try {
          const { hostname, protocol } = new URL(base);
          if (!hostname || (protocol !== "https:" && protocol !== "http:")) return [];
          return [{ protocol: protocol.replace(":", ""), hostname }];
        } catch {
          return [];
        }
      })(),
    ],
    // Admin-uploaded logos may be SVG. These are trusted (admin-only uploads).
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  async redirects() {
    // Expired / inactive webinar slugs still linked from Instagram/ManyChat ads.
    // Destination is the webinars index — never shadows a live upcoming slug.
    const expiredWebinars = [
      "upsc-full-masterclass-by-naman-sir-july-25",
      "upsc-full-masterclass-by-naman-sir-july-18",
      "upsc-full-masterclass-by-naman-sir-04072026",
      "upsc-full-masterclass-by-naman-sir-01-august-2026",
      "upsc-cse-masterclass",
      "how-to-choose-optional",
    ];
    return [
      ...expiredWebinars.map((slug) => ({
        source: `/webinars/${slug}`,
        destination: "/webinars",
        permanent: false,
      })),
    ];
  },
};
module.exports = nextConfig;
