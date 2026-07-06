import { NextResponse } from "next/server";
import { metaConfigured, advancedMatchingEnabled } from "@/lib/analytics/thirdParty";

/**
 * TEMPORARY, secret-gated production config check. Returns ONLY booleans (never any
 * secret values) so we can confirm the live Meta env is correct after deploy:
 *  - CAPI configured (pixel id + token present)
 *  - advanced matching OFF (G1 — no PII to Meta)
 *  - NO test_event_code (so events count as REAL, live events)
 * Any request without the exact token gets a 404 (indistinguishable from missing).
 * REMOVE this route once verified.
 */
export const dynamic = "force-dynamic";

const CHECK_TOKEN = "2ce1ee0f66122e4d5a0e04964b4dc2e19665c63e6217d5fb";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== CHECK_TOKEN) {
    return new NextResponse("Not found", { status: 404 });
  }
  const set = (k: string): boolean => {
    const v = process.env[k];
    return !!(v && v.trim() !== "");
  };
  return NextResponse.json({
    pixelIdSet: set("NEXT_PUBLIC_META_PIXEL_ID") || set("META_PIXEL_ID"),
    capiTokenSet: set("META_CAPI_ACCESS_TOKEN"),
    metaConfigured: metaConfigured(),
    advancedMatchingOn: advancedMatchingEnabled(),
    advancedMatchingRaw: process.env.META_ADVANCED_MATCHING ?? null,
    testEventCodePresent: set("META_TEST_EVENT_CODE"),
    graphVersion: process.env.META_GRAPH_VERSION || null,
    deployedCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
  });
}
