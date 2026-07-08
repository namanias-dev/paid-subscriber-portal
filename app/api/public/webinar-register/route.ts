import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { registerWebinar, getWebinarById, logWebinarAudit } from "@/lib/dataProvider";
import { canRegisterForWebinar, buildClosedError } from "@/lib/webinarLifecycle";
import { ATTR_COOKIE, VISITOR_COOKIE, parseAttrCookie } from "@/lib/attribution";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").replace(/\D/g, "");
    const webinarId = String(body.webinar_id || "");
    if (!name || phone.length !== 10 || !webinarId) {
      return NextResponse.json({ ok: false, error: "Valid name, mobile and webinar required." }, { status: 400 });
    }
    // Source of truth: reject (free) registration once the session has closed/ended.
    const webinar = await getWebinarById(webinarId);
    if (webinar && !canRegisterForWebinar(webinar)) {
      let nextSlug: string | null = null;
      if (webinar.next_webinar_id) {
        const next = await getWebinarById(webinar.next_webinar_id);
        nextSlug = next?.slug ?? null;
      }
      await logWebinarAudit({ action: "payment_blocked_expired", webinar_id: webinar.id, actor: "system", detail: { phone, free: true } });
      return NextResponse.json(buildClosedError(webinar, nextSlug), { status: 409 });
    }
    // First-party attribution snapshot from the nsa_attr cookie (best-effort; never
    // blocks). Threaded into the lead so registration_created carries the campaign
    // and the buyer record is stamped first-touch-wins at the lead moment.
    const jar = cookies();
    const attr = parseAttrCookie(jar.get(ATTR_COOKIE)?.value);
    // Visitor id bridges this conversion to the same visitor's anonymous,
    // campaign-rich landing page views so the lead attributes to its ad campaign.
    const visitorId = jar.get(VISITOR_COOKIE)?.value || null;
    await registerWebinar(webinarId, name, phone, attr, visitorId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not register." }, { status: 500 });
  }
}
