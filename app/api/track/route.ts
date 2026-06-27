import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBuyerSession } from "@/lib/session";
import { rateLimited } from "@/lib/dataProvider";
import { writeEvent, isBot, parseDevice } from "@/lib/analytics/server";
import { CLIENT_ALLOWED_EVENTS, type EventName } from "@/lib/analytics/events";
import { VISITOR_COOKIE, SESSION_COOKIE, ATTR_COOKIE, parseAttrCookie } from "@/lib/attribution";

export const dynamic = "force-dynamic";

/**
 * First-party analytics beacon. The browser posts low-risk traffic/funnel events
 * here; identity (buyer_id/phone) is resolved SERVER-side from the session cookie
 * so it can't be spoofed, and only whitelisted client events are accepted
 * (anything that moves money / grants access is server-emitted elsewhere).
 *
 * Designed for navigator.sendBeacon: always returns fast, never throws, and the
 * write is best-effort (a failed analytics write never affects the user).
 */
export async function POST(req: Request) {
  try {
    const ua = req.headers.get("user-agent");
    // Drop bot/script traffic at the door — keeps dashboards/segments clean.
    if (isBot(ua)) return NextResponse.json({ ok: true, skipped: "bot" });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (await rateLimited(`track-ip:${ip}`, 240, 60)) {
      return NextResponse.json({ ok: true, skipped: "rate" });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const eventName = String(body.event_name || "") as EventName;
    if (!CLIENT_ALLOWED_EVENTS.has(eventName)) {
      return NextResponse.json({ ok: false, error: "event not allowed" }, { status: 400 });
    }

    const jar = cookies();
    const visitorId = jar.get(VISITOR_COOKIE)?.value || (typeof body.visitor_id === "string" ? body.visitor_id : null);
    const sessionId = jar.get(SESSION_COOKIE)?.value || (typeof body.session_id === "string" ? body.session_id : null);
    const attr = parseAttrCookie(jar.get(ATTR_COOKIE)?.value);

    // Identity resolved server-side (trustworthy) — never from the client payload.
    let buyerId: string | null = null;
    let phone: string | null = null;
    try {
      const session = await getBuyerSession();
      if (session) { buyerId = session.buyer_id; phone = session.phone; }
    } catch { /* anon */ }

    const props = (body.props && typeof body.props === "object" ? body.props : {}) as Record<string, unknown>;

    await writeEvent({
      event_name: eventName,
      visitor_id: visitorId,
      buyer_id: buyerId,
      phone,
      session_id: sessionId,
      page_path: typeof body.page_path === "string" ? body.page_path : null,
      referrer: typeof body.referrer === "string" ? body.referrer : null,
      device: parseDevice(ua),
      is_bot: false,
      attribution: attr,
      props,
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // never surface analytics errors
  }
}
