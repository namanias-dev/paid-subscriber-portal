const path = require("path");

/**
 * AIVA build id — commit SHA on Vercel, timestamp locally. Exposed to /api/version.
 */
const BUILD_ID = (
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  `dev-${Date.now()}`
).slice(0, 12);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // AIVA type-checks in CI/build; lint runs separately.
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  generateBuildId: async () => BUILD_ID,
  // AIVA reuses the portal's PURE business primitives from the repo root
  // (lib/paymentsAgg, lib/paymentGroups, lib/installments, lib/permissions, lib/types, lib/dates)
  // via the @portal/* alias. externalDir lets Next transpile TS from outside aiva/.
  experimental: {
    externalDir: true,
    // Trace reused files from the repo root so serverless bundles include them.
    outputFileTracingRoot: path.join(__dirname, ".."),
  },
};

module.exports = nextConfig;
