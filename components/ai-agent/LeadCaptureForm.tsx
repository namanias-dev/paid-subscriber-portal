"use client";

/**
 * Lead-capture form rendered as a chat card. Its submit endpoint is chosen by the
 * form's INTENT so it plugs straight into the Phase-4 integrations, while consent
 * gating + dedupe + validation always live server-side:
 *   - webinar         → POST /api/ai-agent/webinar-register (dedupe-safe register;
 *                       PAID webinars return a payUrl into the existing Eazypay flow)
 *   - callback/visit  → POST /api/ai-agent/callback (creates the admin follow-up)
 *   - payment_recovery→ POST /api/ai-agent/payment-recovery (REAL-status recovery)
 *   - everything else → POST /api/ai-agent/leads
 *
 * PII (name/phone/email) goes ONLY to these endpoints — never to analytics.
 */
import { useState } from "react";
import { normalizeIndianMobile } from "@/lib/phone";
import type { LeadFormCardData, PaymentRecoveryCardData } from "@/lib/ai-agent/providers/types";
import ConsentNotice from "./ConsentNotice";

const CURRENT_YEAR = new Date().getFullYear();
const TARGET_YEARS = [CURRENT_YEAR, CURRENT_YEAR + 1, CURRENT_YEAR + 2, CURRENT_YEAR + 3];

export interface LeadCaptureResult {
  ok: boolean;
  temperature?: string | null;
  /** Set when a PAID webinar must route into the existing payment flow. */
  payUrl?: string | null;
  /** Set by the payment-recovery check to render a recovery card. */
  recovery?: PaymentRecoveryCardData | null;
  /** Recorded intent, so the sheet can fire the right analytics event. */
  intent?: string | null;
  /** Optional confirmation line to show in the transcript. */
  message?: string | null;
}

/** Resolve the submit endpoint + payload for a given form intent. */
function endpointFor(intent: string | null): string {
  switch (intent) {
    case "webinar":
      return "/api/ai-agent/webinar-register";
    case "callback":
    case "campus_visit":
      return "/api/ai-agent/callback";
    case "payment_recovery":
      return "/api/ai-agent/payment-recovery";
    default:
      return "/api/ai-agent/leads";
  }
}

export default function LeadCaptureForm({
  sessionId,
  data,
  requiresConsent,
  consentBody,
  onSubmitted,
}: {
  sessionId: string;
  data: LeadFormCardData;
  requiresConsent: boolean;
  consentBody: string;
  onSubmitted: (nextStep: string, result: LeadCaptureResult) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [targetYear, setTargetYear] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsPhone = data.fields.includes("phone");
  const consentBlocked = requiresConsent && needsPhone && !consent;

  async function submit() {
    setError(null);
    if (data.fields.includes("name") && !name.trim()) {
      setError("Please add your name.");
      return;
    }
    if (needsPhone) {
      const n = normalizeIndianMobile(phone);
      if (!n.ok) {
        setError(n.error || "Enter a valid mobile number.");
        return;
      }
    }
    if (consentBlocked) {
      setError("Please tick the box so a counsellor can reach you.");
      return;
    }

    setBusy(true);
    try {
      const intent = data.intent || "chat";
      const marketingConsent = needsPhone ? consent || undefined : undefined;
      const body: Record<string, unknown> = {
        session_id: sessionId,
        name: name.trim() || undefined,
        phone: phone.trim() || undefined,
        offer_id: data.offerId || undefined,
        offer_type: data.offerType || undefined,
        consent_marketing: marketingConsent,
      };
      // The generic leads endpoint accepts the richer profile; specialised
      // endpoints only need the fields above (+ city/intent for callback).
      if (intent === "callback" || intent === "campus_visit") {
        body.city = city.trim() || undefined;
        body.intent = intent;
      } else if (intent !== "webinar" && intent !== "payment_recovery") {
        body.email = email.trim() || undefined;
        body.city = city.trim() || undefined;
        body.target_year = targetYear || undefined;
        body.source = `ai_agent:${intent}`;
        body.status = "new";
        body.signals = {
          hasPhone: needsPhone,
          hasEmail: !!email.trim(),
          formFieldsProvided: [name, city, targetYear, email].filter((v) => v.trim()).length,
          marketingConsent: consent,
        };
      }

      const res = await fetch(endpointFor(intent), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 202 && json?.requiresConsent) {
        setError("Please tick the box so a counsellor can reach you.");
        setBusy(false);
        return;
      }
      if (!res.ok || !json?.ok) {
        setError(json?.error === "consent_required" ? "I need your permission first." : "Couldn't save that — please try again.");
        setBusy(false);
        return;
      }
      setDone(true);
      onSubmitted(data.nextStep, {
        ok: true,
        intent,
        temperature: json?.lead?.temperature ?? null,
        payUrl: typeof json?.payUrl === "string" ? json.payUrl : null,
        recovery: (json?.recovery as PaymentRecoveryCardData | undefined) ?? null,
        message:
          typeof json?.paid === "boolean" && json.paid
            ? "Our records show this is already done — nothing pending from your side."
            : json?.already
              ? "You're already registered for this — see you there."
              : intent === "payment_recovery" && json?.none
                ? "I couldn't find a pending enrolment for that number. If that seems wrong, a counsellor can check it with you."
                : null,
      });
    } catch {
      setError("Network problem — please try again.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-line bg-white p-4 text-center shadow-sm">
        <div className="mx-auto mb-1 flex h-8 w-8 items-center justify-center rounded-full" style={{ background: "var(--primary-tint)", color: "var(--primary)" }}>✓</div>
        <p className="text-xs font-medium text-ink">You're all set.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-sm">
      <h4 className="font-heading text-sm font-bold text-ink">{data.title}</h4>
      {data.subtitle && <p className="mt-0.5 text-[11px] text-ink2">{data.subtitle}</p>}

      <div className="mt-3 space-y-2">
        {data.fields.includes("name") && (
          <input className="input h-9 min-h-0 text-sm" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        )}
        {data.fields.includes("phone") && (
          <input className="input h-9 min-h-0 text-sm" placeholder="Mobile number" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" autoComplete="tel" />
        )}
        {data.fields.includes("email") && (
          <input className="input h-9 min-h-0 text-sm" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="email" />
        )}
        {data.fields.includes("city") && (
          <input className="input h-9 min-h-0 text-sm" placeholder="City (optional)" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" />
        )}
        {data.fields.includes("target_year") && (
          <select className="input h-9 min-h-0 text-sm" value={targetYear} onChange={(e) => setTargetYear(e.target.value)}>
            <option value="">Target attempt (optional)</option>
            {TARGET_YEARS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        )}
      </div>

      {needsPhone && (
        <ConsentNotice required={requiresConsent} checked={consent} onChange={setConsent} body={consentBody} />
      )}

      {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}

      <button type="button" onClick={submit} disabled={busy} className="btn btn-primary mt-3 h-9 w-full min-h-0 text-xs">
        {busy ? "Sending…" : data.submitLabel}
      </button>
    </div>
  );
}
