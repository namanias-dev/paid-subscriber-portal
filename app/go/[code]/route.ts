import { NextResponse, type NextRequest } from "next/server";
import { resolveCampaignLinkByCode, recordCampaignClick } from "@/lib/marketing/campaignLinks";
import { composeRedirectUrl, CAMPAIGN_SITE_URL } from "@/lib/marketing/campaignLink";
import { isBot, parseDevice } from "@/lib/analytics/server";
import { VISITOR_COOKIE, SESSION_COOKIE } from "@/lib/attribution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const YEAR = 60 * 60 * 24 * 365;

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* ignore */ }
  return "v-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function cookieDomain(host: string): string | undefined {
  const h = (host || "").split(":")[0].toLowerCase();
  if (h === "namanias.com" || h.endsWith(".namanias.com")) return ".namanias.com";
  return undefined; // host-only (localhost / previews)
}

/**
 * Public branded short-link redirect: /go/<code>.
 * - Extremely light: one indexed lookup, then a 302.
 * - Appends canonical UTM params + ?clid=<code> so the existing first-party
 *   attribution pipeline (captureAttribution) records the campaign link on the
 *   destination page — the clid then rides nsa_attr through the whole funnel.
 * - Preserves query already on the destination AND passthrough params the ad
 *   platform appends (fbclid/gclid/wbraid/gbraid/etc.).
 * - Open-redirect safe (composeRedirectUrl only allows site paths / allowlisted hosts).
 * - NEVER lets click logging block or break the redirect.
 */
export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code || "";
  const home = CAMPAIGN_SITE_URL + "/";

  let link: Awaited<ReturnType<typeof resolveCampaignLinkByCode>> = null;
  try {
    link = await resolveCampaignLinkByCode(code);
  } catch {
    link = null;
  }

  // Unknown / invalid code → send to home (never a dead-end for a paid click).
  if (!link) {
    return NextResponse.redirect(home, { status: 302 });
  }

  const passthrough = new URLSearchParams(req.nextUrl.search);
  passthrough.delete("code");
  const target = composeRedirectUrl({
    destination: link.destination_url,
    utm: { source: link.source, medium: link.medium, campaign: link.campaign, content: link.content, term: link.term },
    clid: link.short_code,
    passthrough,
  });

  // Destination somehow unsafe (defensive) → home.
  const absoluteTarget = target
    ? target.startsWith("/")
      ? new URL(target, CAMPAIGN_SITE_URL).toString()
      : target
    : home;

  const res = NextResponse.redirect(absoluteTarget, { status: 302 });
  res.headers.set("Cache-Control", "no-store");

  // Ensure a durable visitor id so the click ties to later on-site events.
  const host = req.headers.get("host") || "";
  const domain = cookieDomain(host);
  const secure = req.nextUrl.protocol === "https:";
  let visitorId = req.cookies.get(VISITOR_COOKIE)?.value || null;
  if (!visitorId) {
    visitorId = newId();
    res.cookies.set(VISITOR_COOKIE, visitorId, {
      maxAge: YEAR * 2, path: "/", sameSite: "lax", secure, ...(domain ? { domain } : {}),
    });
  }
  const sessionId = req.cookies.get(SESSION_COOKIE)?.value || null;

  const ua = req.headers.get("user-agent");
  // Fire the click log; it never throws. Awaited (fast indexed insert with its own
  // DB timeout) so serverless doesn't drop the write, but a failure still redirects.
  await recordCampaignClick({
    campaign_link_id: link.id,
    short_code: link.short_code,
    destination_url: absoluteTarget,
    visitor_id: visitorId,
    session_id: sessionId,
    referrer: req.headers.get("referer"),
    user_agent: ua,
    device: parseDevice(ua),
    fbclid: req.nextUrl.searchParams.get("fbclid"),
    gclid: req.nextUrl.searchParams.get("gclid"),
    wbraid: req.nextUrl.searchParams.get("wbraid"),
    gbraid: req.nextUrl.searchParams.get("gbraid"),
    is_bot: isBot(ua),
  });

  return res;
}
