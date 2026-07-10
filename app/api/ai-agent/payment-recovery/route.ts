/**
 * PUBLIC AGENT API — payment-abandoned recovery (Phase 4 integration).
 *
 * Given a phone (+ optional item), looks up the prospect's payments and returns a
 * recovery card built from the REAL payment status. Hard rules:
 *   - PAID is the ONLY success → hide recovery, never re-pitch, never re-ask to pay.
 *   - INITIATED / ABANDONED / VERIFYING → NOT paid. Never call ABANDONED "failed".
 *   - A seat is NEVER described as confirmed unless the payment is PAID.
 *   - Server-sourced amounts/status only; the client price is never trusted.
 *
 * Matches by phone + item. Consent is enforced when required (phone capture).
 */
import { NextResponse } from "next/server";
import { normalizeIndianMobile } from "@/lib/phone";
import { getPaymentsByPhone } from "@/lib/dataProvider";
import { resolveLiveOffer } from "@/lib/ai-agent/offerResolver";
import { getAgentContext } from "@/lib/ai-agent/request";
import { hit } from "@/lib/ai-agent/rateLimit";
import { getAiAgentConfig } from "@/lib/ai-agent/config";
import type { OfferType } from "@/lib/ai-agent/offerResolver";
import type { PaymentRecoveryCardData } from "@/lib/ai-agent/providers/types";

export const dynamic = "force-dynamic";

interface Body {
  session_id?: string;
  phone?: string;
  offer_id?: string;
  offer_type?: OfferType;
  consent_marketing?: boolean;
}

const NOT_PAID = new Set(["INITIATED", "ABANDONED", "VERIFYING", "FAILED"]);

export async function POST(req: Request) {
  const cfg = getAiAgentConfig();
  const body = (await req.json().catch(() => ({}))) as Body;
  const ctx = getAgentContext(req, body.session_id);

  if (!hit(`ai:rec:ip:${ctx.ip}`, 20, 600).allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }
  const n = normalizeIndianMobile(body.phone);
  if (!n.ok) return NextResponse.json({ ok: false, error: n.error }, { status: 400 });
  const phone = n.digits10!;
  if (!hit(`ai:rec:phone:${phone}`, 10, 3600).allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }

  // Consent gate (phone capture).
  const marketingConsent = ctx.consent.marketing || body.consent_marketing === true;
  if (cfg.requireMarketingConsent && !marketingConsent) {
    return NextResponse.json({ ok: false, error: "consent_required", requiresConsent: true }, { status: 202 });
  }

  // Resolve the item (if provided) so we can match by slug + source the title/link.
  const offer = body.offer_id ? await resolveLiveOffer(String(body.offer_id), body.offer_type) : null;

  try {
    const payments = await getPaymentsByPhone(phone);
    const relevant = offer
      ? payments.filter((p) => p.item_slug === offer.slug && p.item_type === offer.type)
      : payments;

    // PAID wins — hide recovery entirely, never re-pitch.
    if (relevant.some((p) => p.status === "PAID")) {
      return NextResponse.json({ ok: true, paid: true });
    }

    const pending = relevant.find((p) => NOT_PAID.has(String(p.status || "").toUpperCase()));
    if (!pending) {
      // No abandoned/pending attempt to recover.
      return NextResponse.json({ ok: true, none: true });
    }

    const itemType: OfferType = (offer?.type || (pending.item_type as OfferType) || "course");
    const itemTitle = offer?.title || pending.item || (itemType === "webinar" ? "your masterclass" : "your course");
    const resumeLink = offer?.link || (pending.item_slug ? `/${itemType === "webinar" ? "webinars" : "courses"}/${pending.item_slug}` : null);

    // REAL, human-safe status line — ABANDONED is never called "failed"; a seat is
    // never described as confirmed (it isn't — nothing is PAID here).
    const statusLine =
      String(pending.status).toUpperCase() === "VERIFYING"
        ? "We're still verifying your last payment."
        : "Your enrolment isn't complete yet.";

    const card: PaymentRecoveryCardData = {
      itemTitle,
      itemType,
      statusLine,
      message:
        "No seat is confirmed until payment is done — nothing is lost, and you can pick up right where you left off whenever you're ready.",
      resumeLink,
      resumeLabel: "Resume enrolment",
    };

    return NextResponse.json({ ok: true, recovery: card });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not check status." }, { status: 500 });
  }
}
