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
    remotePatterns: [
      // Supabase Storage public URLs (cover images, logo, portrait, etc.)
      { protocol: "https", hostname: "*.supabase.co" },
      { protocol: "https", hostname: "*.supabase.in" },
    ],
    // Admin-uploaded logos may be SVG. These are trusted (admin-only uploads).
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};
module.exports = nextConfig;
