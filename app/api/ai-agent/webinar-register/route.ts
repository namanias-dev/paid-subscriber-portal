/**
 * PUBLIC AGENT API — webinar registration (Phase 4 integration).
 *
 * FREE webinar  → dedupe-safe register via the EXISTING registerWebinar() (after a
 *                 findExistingRegistration pre-check, since webinar_registrations
 *                 has NO unique (webinar_id, phone) constraint). Registration ==
 *                 confirmation for free sessions.
 * PAID webinar  → NEVER registered/confirmed here. We return the offer page link so
 *                 the client routes the user into the EXISTING Eazypay payment flow.
 *                 A seat is only ever confirmed after a verified PAID payment.
 *
 * The offer id is validated against the LIVE resolver (must be an OPEN webinar);
 * price is server-sourced. Consent is enforced when required. A lead is upserted
 * (with consent flags) so the registration attributes to the agent.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { normalizeIndianMobile } from "@/lib/phone";
import { registerWebinar } from "@/lib/dataProvider";
import { resolveLiveOffer } from "@/lib/ai-agent/offerResolver";
import { findExistingRegistration } from "@/lib/ai-agent/registrationDedupe";
import { upsertLead } from "@/lib/ai-agent/leadService";
import { getAgentContext } from "@/lib/ai-agent/request";
import { hit } from "@/lib/ai-agent/rateLimit";
import { getAiAgentConfig } from "@/lib/ai-agent/config";
import { VISITOR_COOKIE, ATTR_COOKIE, parseAttrCookie } from "@/lib/attribution";

export const dynamic = "force-dynamic";

interface Body {
  session_id?: string;
  name?: string;
  phone?: string;
  offer_id?: string;
  consent_marketing?: boolean;
}

export async function POST(req: Request) {
  const cfg = getAiAgentConfig();
  const body = (await req.json().catch(() => ({}))) as Body;
  const ctx = getAgentContext(req, body.session_id);

  if (!hit(`ai:webreg:ip:${ctx.ip}`, 20, 600).allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }

  const name = String(body.name || "").trim().slice(0, 120);
  const n = normalizeIndianMobile(body.phone);
  if (!n.ok) return NextResponse.json({ ok: false, error: n.error }, { status: 400 });
  const phone = n.digits10!;
  if (!hit(`ai:webreg:phone:${phone}`, 10, 3600).allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }

  // Validate the webinar against LIVE, OPEN offers (also sources the price).
  const offer = await resolveLiveOffer(String(body.offer_id || ""), "webinar");
  if (!offer) {
    return NextResponse.json({ ok: false, error: "That session isn't open for registration." }, { status: 400 });
  }

  // Consent gate before persisting any phone-bearing lead.
  const marketingConsent = ctx.consent.marketing || body.consent_marketing === true;
  if (cfg.requireMarketingConsent && !marketingConsent) {
    return NextResponse.json({ ok: false, error: "consent_required", requiresConsent: true }, { status: 202 });
  }

  // Upsert the lead (attributes the registration to the agent).
  await upsertLead({
    sessionId: ctx.sessionId || null,
    phone,
    name: name || null,
    attributionSource: ctx.attribution.source,
    attributionCampaign: ctx.attribution.campaign,
    attributionFbclid: ctx.attribution.fbclid,
    attributionFbc: ctx.attribution.fbc,
    consentAnalytics: ctx.consent.analytics || false,
    consentMarketing: marketingConsent,
    offerInterest: [{ type: "webinar", id: offer.id, slug: offer.slug }],
    // Only free webinars are confirmed here; paid ones aren't "registered" until PAID.
    status: offer.price > 0 ? "interested" : "registered",
    signals: { webinarInterest: true, hasPhone: true, marketingConsent },
  }).catch(() => {});

  // PAID webinar → never bypass payment. Route to the existing Eazypay flow.
  if (offer.price > 0) {
    return NextResponse.json({ ok: true, paid: true, payUrl: offer.link, title: offer.title });
  }

  // FREE webinar → dedupe pre-check, then reuse the existing registration path.
  try {
    const existing = await findExistingRegistration(offer.id, phone);
    if (existing) {
      return NextResponse.json({ ok: true, already: true, title: offer.title });
    }
    const jar = cookies();
    const attr = parseAttrCookie(jar.get(ATTR_COOKIE)?.value);
    const visitorId = jar.get(VISITOR_COOKIE)?.value || null;
    const res = await registerWebinar(offer.id, name || "Aspirant", phone, attr, visitorId);
    if (!res.ok) return NextResponse.json({ ok: false, error: "Could not register." }, { status: 500 });
    return NextResponse.json({ ok: true, registered: true, title: offer.title });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not register." }, { status: 500 });
  }
}
