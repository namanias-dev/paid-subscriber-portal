/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  reactStrictMode: true,
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
