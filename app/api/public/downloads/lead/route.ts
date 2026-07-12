/**
 * PUBLIC — free-download lead capture.
 *
 * Reuses the EXISTING lead infrastructure so a free-download lead is a
 * first-class citizen in the same admin dashboard as every other lead:
 *   • writes to `ai_leads` via {@link upsertLead} (dedupe by phone → session,
 *     score/temperature recomputed, per-phone abuse cap enforced),
 *   • tags `source = "free_download"` and stores the file in `offer_interest`,
 *   • records a redacted `free_download_lead` row in `ai_lead_events` capturing
 *     the file id/kind (PII-free) so admins see WHICH file drove the lead.
 *
 * Consent is recorded HONESTLY (nsa_consent cookie OR the form checkbox): a lead
 * with consent_marketing=false is stored but must NOT be used for SMS/marketing.
 * Unlike the AI-agent endpoint we do NOT refuse to store without consent — the
 * visitor typed their number to unlock a file; we keep an honest record and
 * simply gate marketing on the consent flag.
 *
 * PII (name/phone) NEVER touches analytics — only the file id/kind is emitted
 * client-side via the whitelisted `download_lead_submit` event.
 */
import { NextResponse } from "next/server";
import { normalizeIndianMobile } from "@/lib/phone";
import { upsertLead } from "@/lib/ai-agent/leadService";
import { recordEvent } from "@/lib/ai-agent/conversationStore";
import { getAgentContext } from "@/lib/ai-agent/request";
import { rateLimited } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

interface Body {
  name?: string;
  phone?: string;
  city?: string;
  target_year?: number | string;
  /** Optional: "yes" | "exploring" — "Have you decided to prepare?" */
  decided?: string;
  /** Optional: "online" | "offline" — "Online or Offline?" */
  mode?: string;
  consent_marketing?: boolean;
  file?: { id?: string; title?: string; kind?: string };
}

function str(v: unknown, max = 200): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const ctx = getAgentContext(req);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
    if (await rateLimited(`dl-lead:${ip}`, 30, 600)) {
      return NextResponse.json({ ok: false, error: "Too many requests. Please try again shortly." }, { status: 429 });
    }

    // Required: name, phone (valid Indian mobile), city.
    const name = str(body.name, 120);
    if (!name) return NextResponse.json({ ok: false, error: "Please enter your name." }, { status: 400 });

    const n = normalizeIndianMobile(body.phone);
    if (!n.ok) return NextResponse.json({ ok: false, error: n.error || "Enter a valid mobile number." }, { status: 400 });

    const city = str(body.city, 120);
    if (!city) return NextResponse.json({ ok: false, error: "Please enter your city." }, { status: 400 });

    // Optional profile fields.
    let targetYear: number | null = null;
    if (body.target_year !== undefined && body.target_year !== null && body.target_year !== "") {
      const y = parseInt(String(body.target_year), 10);
      if (Number.isFinite(y) && y >= 2024 && y <= 2100) targetYear = y;
    }
    const decided = body.decided === "yes" || body.decided === "exploring" ? body.decided : null;
    const mode = body.mode === "online" || body.mode === "offline" ? body.mode : null;

    // Consent recorded honestly: cookie consent OR the explicit form checkbox.
    const marketingConsent = ctx.consent.marketing || body.consent_marketing === true;
    const analyticsConsent = ctx.consent.analytics;

    // File context (PII-free) — surfaced to admins via offer_interest + event.
    const fileId = str(body.file?.id, 80);
    const fileKind = str(body.file?.kind, 40);
    const fileTitle = str(body.file?.title, 200);
    const offerInterest = fileId
      ? [{ type: "download", id: fileId, kind: fileKind || undefined, title: fileTitle || undefined }]
      : [];

    const filledOptional = [targetYear, decided, mode].filter(Boolean).length;

    const result = await upsertLead({
      sessionId: ctx.sessionId || null,
      phone: n.digits10!,
      name,
      city,
      targetYear,
      source: "free_download",
      attributionSource: ctx.attribution.source,
      attributionCampaign: ctx.attribution.campaign,
      attributionFbclid: ctx.attribution.fbclid,
      attributionFbc: ctx.attribution.fbc,
      consentAnalytics: analyticsConsent,
      consentMarketing: marketingConsent,
      offerInterest,
      status: "new",
      signals: {
        hasPhone: true,
        // name + city always given here; plus any optional answers.
        formFieldsProvided: 2 + filledOptional,
        marketingConsent,
      },
    });

    if (!result.ok) {
      const status = result.error === "lead_cap_reached" ? 429 : 500;
      const msg = result.error === "lead_cap_reached" ? "Too many requests." : "Could not save right now.";
      return NextResponse.json({ ok: false, error: msg }, { status });
    }

    // Append a redacted, PII-free event so admins see which file drove the lead.
    void recordEvent({
      sessionId: ctx.sessionId || null,
      leadId: result.lead?.id ?? null,
      eventType: "free_download_lead",
      payload: {
        file_id: fileId,
        file_kind: fileKind,
        file_title: fileTitle,
        decided,
        mode,
        target_year: targetYear,
        consent_marketing: marketingConsent,
      },
    });

    // Minimal, non-PII acknowledgement.
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not save right now." }, { status: 500 });
  }
}
