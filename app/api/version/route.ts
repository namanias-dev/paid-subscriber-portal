import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Lightweight build-version probe for client self-healing. Returns the build id
 * of the CURRENTLY DEPLOYED app. An out-of-date client (whose baked-in
 * NEXT_PUBLIC_BUILD_ID differs from this) knows a new deploy is live and can
 * transparently reload to the fresh bundle. Never cached.
 */
export async function GET() {
  const version = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
  return NextResponse.json(
    { version },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } },
  );
}
