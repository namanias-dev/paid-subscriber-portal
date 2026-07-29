import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getBuyerSession } from "@/lib/session";
import { rateLimited } from "@/lib/dataProvider";
import { writeEvent, isBot, parseDevice } from "@/lib/analytics/server";
import { CLIENT_ALLOWED_EVENTS, type EventName } from "@/lib/analytics/events";
import { VISITOR_COOKIE, SESSION_COOKIE, ATTR_COOKIE, parseAttrCookie } from "@/lib/attribution";
import { withDbBudget } from "@/lib/dbCircuit";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * First-party analytics beacon.
 *
 * SEV1 rule: analytics must NEVER take the site down. Rate-limit + write are
 * budgeted and fire-and-forget after validation — a slow DB drops the event,
 * not the page view.
 */
export async function POST(req: Request) {
  try {
    const ua = req.headers.get("user-agent");
    if (isBot(ua)) return NextResponse.json({ ok: true, skipped: "bot" });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const eventName = String(body.event_name || "") as EventName;
    if (!CLIENT_ALLOWED_EVENTS.has(eventName)) {
      return NextResponse.json({ ok: false, error: "event not allowed" }, { status: 400 });
    }

    const jar = cookies();
    const visitorId = jar.get(VISITOR_COOKIE)?.value || (typeof body.visitor_id === "string" ? body.visitor_id : null);
    const sessionId = jar.get(SESSION_COOKIE)?.value || (typeof body.session_id === "string" ? body.session_id : null);
    const attr = parseAttrCookie(jar.get(ATTR_COOKIE)?.value);

    let buyerId: string | null = null;
    let phone: string | null = null;
    try {
      const session = await getBuyerSession();
      if (session) { buyerId = session.buyer_id; phone = session.phone; }
    } catch { /* anon */ }

    const props = (body.props && typeof body.props === "object" ? body.props : {}) as Record<string, unknown>;

    // Respond immediately; do DB work in the background with a hard budget.
    // navigator.sendBeacon / page unload must not wait on Supabase.
    void (async () => {
      const limited = await withDbBudget(rateLimited(`track-ip:${ip}`, 240, 60), 1500, "track_rate");
      if (limited.ok && limited.value) return;
      await withDbBudget(writeEvent({
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
      }), 2500, "track_write");
    })();

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
