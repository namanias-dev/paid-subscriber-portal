import { NextResponse } from "next/server";

/**
 * Lightweight build-version probe for client self-healing. Returns the build id
 * of the CURRENTLY DEPLOYED app. Clients compare against their baked-in
 * NEXT_PUBLIC_BUILD_ID and reload when a newer deploy is live.
 *
 * ETag + 304 keeps polling cheap; short CDN/browser cache (5 min) is fine
 * because ClientHealth checks at most hourly (and focus-debounced).
 */
export async function GET(req: Request) {
  const version = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
  const etag = `"${version}"`;
  const headers = {
    ETag: etag,
    "Cache-Control": "public, max-age=300",
  };

  const inm = req.headers.get("if-none-match");
  if (inm && inm === etag) {
    return new NextResponse(null, { status: 304, headers });
  }

  return NextResponse.json({ version }, { headers });
}
