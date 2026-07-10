/**
 * PUBLIC AGENT API — counsellor callback / handoff (Phase 4 integration).
 *
 * Upserts the lead (with consent flags) and creates a PENDING ai_followups row —
 * the in-app admin notification that a prospect wants a callback (surfaced in
 * Admin → AI Counsellor → Follow-ups / Hot Leads).
 *
 * The SMS/handoff path is BUILT but NOTHING is auto-sent: outbound SMS stays gated
 * by AI_AGENT_AUTOFOLLOWUP_ENABLED (false in this phase) AND the site's own SMS
 * kill-switch + sms_opt_outs + DLT templates (via lib/sms/service.sendSms). An
 * admin enables auto-send in a later phase; until then a human follows up.
 */
import { NextResponse } from "next/server";
import { normalizeIndianMobile } from "@/lib/phone";
import { getSupabaseAdmin } from "@/lib/supabase";
import { upsertLead } from "@/lib/ai-agent/leadService";
import { getAgentContext } from "@/lib/ai-agent/request";
import { hit } from "@/lib/ai-agent/rateLimit";
import { getAiAgentConfig } from "@/lib/ai-agent/config";

export const dynamic = "force-dynamic";

interface Body {
  session_id?: string;
  name?: string;
  phone?: string;
  city?: string;
  intent?: string;
  consent_marketing?: boolean;
}

export async function POST(req: Request) {
  const cfg = getAiAgentConfig();
  const body = (await req.json().catch(() => ({}))) as Body;
  const ctx = getAgentContext(req, body.session_id);

  if (!hit(`ai:cb:ip:${ctx.ip}`, 20, 600).allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }

  const name = String(body.name || "").trim().slice(0, 120);
  const city = String(body.city || "").trim().slice(0, 120);
  const intent = String(body.intent || "callback").slice(0, 40);
  const n = normalizeIndianMobile(body.phone);
  if (!n.ok) return NextResponse.json({ ok: false, error: n.error }, { status: 400 });
  const phone = n.digits10!;
  if (!hit(`ai:cb:phone:${phone}`, 10, 3600).allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }

  // Consent gate before persisting any phone-bearing lead.
  const marketingConsent = ctx.consent.marketing || body.consent_marketing === true;
  if (cfg.requireMarketingConsent && !marketingConsent) {
    return NextResponse.json({ ok: false, error: "consent_required", requiresConsent: true }, { status: 202 });
  }

  const result = await upsertLead({
    sessionId: ctx.sessionId || null,
    phone,
    name: name || null,
    city: city || null,
    source: `ai_agent:${intent}`,
    status: "contacted",
    attributionSource: ctx.attribution.source,
    attributionCampaign: ctx.attribution.campaign,
    attributionFbclid: ctx.attribution.fbclid,
    attributionFbc: ctx.attribution.fbc,
    consentAnalytics: ctx.consent.analytics || false,
    consentMarketing: marketingConsent,
    signals: { hasPhone: true, marketingConsent, formFieldsProvided: [name, city].filter(Boolean).length },
  });

  if (!result.ok) {
    const status = result.error === "lead_cap_reached" ? 429 : 500;
    return NextResponse.json({ ok: false, error: status === 429 ? "Too many requests." : "Could not save." }, { status });
  }

  // Create the in-app admin notification (a pending follow-up). Nothing is sent.
  const db = getSupabaseAdmin();
  if (db) {
    try {
      await db.from("ai_followups").insert({
        lead_id: result.lead?.id ?? null,
        session_id: ctx.sessionId || null,
        type: intent,
        channel: "counselor",
        status: "pending",
        payload: { via: "ai_agent", temperature: result.lead?.temperature ?? null },
        created_at: new Date().toISOString(),
      });
    } catch {
      /* best-effort; a failed notification never breaks the handoff */
    }
  }

  // SMS auto-send stays OFF this phase. When AI_AGENT_AUTOFOLLOWUP_ENABLED is
  // later turned on, this is where an opt-out-checked, DLT-template sendSms() would
  // fire. Intentionally not wired now.
  const smsAutoSend = cfg.autoFollowupEnabled; // false in this phase
  void smsAutoSend;

  return NextResponse.json({ ok: true });
}
