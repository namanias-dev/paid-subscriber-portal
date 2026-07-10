/**
 * PUBLIC AGENT API — create / update a lead.
 *
 *  POST  create-or-update a lead (dedupe by phone -> session via leadService).
 *  PATCH update an existing lead (same upsert path; explicit for clarity).
 *
 * Guards:
 *  - per-IP + per-session + per-phone rate limits (in-memory, Phase 1).
 *  - Indian mobile + email validation.
 *  - offer ids cross-checked against the LIVE offer resolver (unknown/inactive
 *    ids are rejected — we never trust a client-supplied offer).
 *  - consent: attribution comes from nsa_consent/nsa_attr. When
 *    AI_AGENT_REQUIRE_MARKETING_CONSENT=true, marketing-usable lead data is only
 *    persisted after marketing consent is present.
 *  - NEVER trusts a client price; leads only reference offer ids, prices are
 *    resolved server-side by the resolver when needed.
 */
import { NextResponse } from "next/server";
import { normalizeIndianMobile } from "@/lib/phone";
import { upsertLead } from "@/lib/ai-agent/leadService";
import { resolveLiveOffer } from "@/lib/ai-agent/offerResolver";
import { getAgentContext, isValidEmail } from "@/lib/ai-agent/request";
import { hit } from "@/lib/ai-agent/rateLimit";
import { getAiAgentConfig } from "@/lib/ai-agent/config";
import type { LeadSignals } from "@/lib/ai-agent/leadScoring";

export const dynamic = "force-dynamic";

interface LeadBody {
  session_id?: string;
  phone?: string;
  email?: string;
  name?: string;
  city?: string;
  target_year?: number | string;
  source?: string;
  campaign?: string;
  offer_id?: string;
  offer_type?: "course" | "webinar";
  status?: string;
  notes?: string;
  consent_analytics?: boolean;
  consent_marketing?: boolean;
  signals?: LeadSignals;
}

function str(v: unknown, max = 200): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

async function handle(req: Request) {
  const cfg = getAiAgentConfig();
  const body = (await req.json().catch(() => ({}))) as LeadBody;
  const ctx = getAgentContext(req, body.session_id);

  // Rate limits: per IP, per session, per phone.
  if (!hit(`ai:leads:ip:${ctx.ip}`, 20, 600).allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }
  if (ctx.sessionId && !hit(`ai:leads:sid:${ctx.sessionId}`, 20, 600).allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }

  // Validate phone if provided (a lead may exist pre-phone, keyed by session).
  let phone: string | null = null;
  if (body.phone !== undefined && body.phone !== null && String(body.phone).trim() !== "") {
    const n = normalizeIndianMobile(body.phone);
    if (!n.ok) return NextResponse.json({ ok: false, error: n.error }, { status: 400 });
    phone = n.digits10!;
    if (!hit(`ai:leads:phone:${phone}`, 10, 3600).allowed) {
      return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
    }
  }

  if (!phone && !ctx.sessionId) {
    return NextResponse.json(
      { ok: false, error: "A phone or session is required." },
      { status: 400 },
    );
  }

  // Validate email if provided.
  const email = str(body.email);
  if (email && !isValidEmail(email)) {
    return NextResponse.json({ ok: false, error: "Enter a valid email." }, { status: 400 });
  }

  // Cross-check the offer id against LIVE offers — reject unknown/inactive.
  const offerInterest: unknown[] = [];
  if (body.offer_id) {
    const offer = await resolveLiveOffer(String(body.offer_id), body.offer_type);
    if (!offer) {
      return NextResponse.json(
        { ok: false, error: "That offer is not available." },
        { status: 400 },
      );
    }
    offerInterest.push({ type: offer.type, id: offer.id, slug: offer.slug });
  }

  // Consent gating. Marketing consent from nsa_consent OR an explicit client flag.
  const marketingConsent = ctx.consent.marketing || body.consent_marketing === true;
  const analyticsConsent = ctx.consent.analytics || body.consent_analytics === true;
  if (cfg.requireMarketingConsent && !marketingConsent) {
    // Without marketing consent we refuse to persist marketing-usable lead data.
    return NextResponse.json(
      { ok: false, error: "consent_required", requiresConsent: true },
      { status: 202 },
    );
  }

  let targetYear: number | null = null;
  if (body.target_year !== undefined && body.target_year !== null && body.target_year !== "") {
    const y = parseInt(String(body.target_year), 10);
    if (Number.isFinite(y) && y >= 2024 && y <= 2100) targetYear = y;
  }

  const result = await upsertLead({
    sessionId: ctx.sessionId || null,
    phone,
    email,
    name: str(body.name, 120),
    city: str(body.city, 120),
    targetYear,
    source: str(body.source, 80),
    campaign: str(body.campaign, 120),
    attributionSource: ctx.attribution.source,
    attributionCampaign: ctx.attribution.campaign,
    attributionFbclid: ctx.attribution.fbclid,
    attributionFbc: ctx.attribution.fbc,
    consentAnalytics: analyticsConsent,
    consentMarketing: marketingConsent,
    offerInterest,
    notes: str(body.notes, 500),
    status: str(body.status, 40),
    signals: body.signals,
  });

  if (!result.ok) {
    const status = result.error === "lead_cap_reached" ? 429 : 500;
    const msg = result.error === "lead_cap_reached" ? "Too many requests." : "Could not save.";
    return NextResponse.json({ ok: false, error: msg }, { status });
  }

  // Return a MINIMAL, non-PII acknowledgement (never echo the stored lead PII).
  return NextResponse.json({
    ok: true,
    created: !!result.created,
    lead: result.lead
      ? { id: result.lead.id, score: result.lead.score, temperature: result.lead.temperature }
      : null,
  });
}

export async function POST(req: Request) {
  return handle(req);
}

export async function PATCH(req: Request) {
  return handle(req);
}
