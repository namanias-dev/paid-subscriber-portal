"use client";

/**
 * AiChatSheet — the conversational surface. Full-screen sheet on mobile, side
 * panel on desktop. Drives the DETERMINISTIC guided-flow engine via
 * POST /api/ai-agent/message and renders the returned messages, quick replies,
 * offer / roadmap / recovery cards, and the lead-capture form.
 *
 * PII rule: only the lead-capture form ever sends PII (to /api/ai-agent/leads).
 * Analytics events here are strictly PII-free (session id + intent only).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentCard,
  AgentResponse,
  AgentTurnInput,
  FlowId,
  QuickReply,
} from "@/lib/ai-agent/providers/types";
import { CONSENT } from "@/lib/ai-agent/copyLibrary";
import QuickReplyButtons from "./QuickReplyButtons";
import OfferRecommendationCard from "./OfferRecommendationCard";
import RoadmapCard from "./RoadmapCard";
import PaymentRecoveryCard from "./PaymentRecoveryCard";
import LeadCaptureForm, { type LeadCaptureResult } from "./LeadCaptureForm";
import { trackAgentEvent, type AgentEventName } from "./agentAnalytics";

interface TranscriptEntry {
  id: string;
  role: "user" | "agent";
  text: string;
}

interface PageContext {
  pagePath: string | null;
  offerId: string | null;
  offerType: "course" | "webinar" | null;
}

const KNOWN_EVENTS: ReadonlySet<string> = new Set<AgentEventName>([
  "ai_widget_opened",
  "ai_widget_dismissed",
  "ai_message_sent",
  "ai_quick_reply",
  "ai_lead_created",
  "ai_webinar_register_click",
  "ai_payment_start_click",
  "ai_whatsapp_click",
  "ai_callback_requested",
  "ai_payment_recovery_click",
  "ai_resource_click",
  "ai_offer_click",
]);

export default function AiChatSheet({
  sessionId,
  waLink,
  initialFlow,
  pageContext,
  onClose,
}: {
  sessionId: string;
  waLink: string | null;
  initialFlow: FlowId;
  pageContext: PageContext;
  onClose: () => void;
}) {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [current, setCurrent] = useState<AgentResponse | null>(null);
  const [injectedCards, setInjectedCards] = useState<AgentCard[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const seq = useRef(0);
  const started = useRef(false);

  const nextId = () => `t${Date.now().toString(36)}${(seq.current += 1)}`;

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const sendTurn = useCallback(
    async (input: Partial<AgentTurnInput>) => {
      setLoading(true);
      try {
        const res = await fetch("/api/ai-agent/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            flow: input.flow ?? undefined,
            step: input.step ?? undefined,
            choice_id: input.choiceId ?? undefined,
            text: input.text ?? undefined,
            context: {
              page_path: pageContext.pagePath,
              offer_id: pageContext.offerId,
              offer_type: pageContext.offerType,
            },
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (json?.ok && json.response) {
          const resp = json.response as AgentResponse;
          setCurrent(resp);
          setTranscript((prev) => [
            ...prev,
            ...resp.messages.map((m) => ({ id: nextId(), role: "agent" as const, text: m.text })),
          ]);
        }
      } catch {
        setTranscript((prev) => [
          ...prev,
          { id: nextId(), role: "agent", text: "I'm having trouble right now — please try again in a moment." },
        ]);
      } finally {
        setLoading(false);
        scrollToEnd();
      }
    },
    [sessionId, pageContext, scrollToEnd],
  );

  // First turn on open.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    trackAgentEvent(sessionId, "ai_widget_opened", { flow: initialFlow, path: pageContext.pagePath || "" });
    void sendTurn({ flow: initialFlow });
  }, [initialFlow, sendTurn, sessionId, pageContext.pagePath]);

  useEffect(() => scrollToEnd(), [transcript, current, scrollToEnd]);

  function fire(name: string | undefined, fallback: AgentEventName, props: Record<string, string | number | boolean | null> = {}) {
    const evt = name && KNOWN_EVENTS.has(name) ? (name as AgentEventName) : fallback;
    trackAgentEvent(sessionId, evt, props);
  }

  function navigate(href: string | null | undefined) {
    if (!href) return;
    if (/^https?:\/\//i.test(href)) window.open(href, "_blank", "noopener,noreferrer");
    else window.location.assign(href);
  }

  function handleQuickReply(reply: QuickReply) {
    // Echo the user's choice into the transcript.
    setTranscript((prev) => [...prev, { id: nextId(), role: "user", text: reply.label }]);

    switch (reply.action) {
      case "open_url":
        fire(reply.track, "ai_offer_click", { href: reply.href || "" });
        navigate(reply.href);
        return;
      case "whatsapp":
        fire(reply.track, "ai_whatsapp_click");
        navigate(reply.href || waLink);
        return;
      case "tel":
        fire(reply.track, "ai_quick_reply");
        navigate(reply.href);
        return;
      case "dismiss":
        onClose();
        return;
      case "register_webinar":
        fire(reply.track, "ai_webinar_register_click", { offer_id: (reply.data?.offer_id as string) || "" });
        break;
      default:
        fire(reply.track, "ai_quick_reply", { id: reply.id });
    }

    void sendTurn({ flow: reply.flow ?? null, step: reply.next ?? null, choiceId: reply.id });
  }

  function handleOfferCta(offerLink: string, paid: boolean, offerId: string, offerType: string) {
    fire(paid ? "ai_payment_start_click" : "ai_offer_click", paid ? "ai_payment_start_click" : "ai_offer_click", {
      offer_id: offerId,
      offer_type: offerType,
    });
    navigate(offerLink);
  }

  function handleLeadSubmitted(nextStep: string, intent: string | null, result: LeadCaptureResult) {
    const it = intent || result.intent || "chat";
    if (result.ok) {
      trackAgentEvent(sessionId, "ai_lead_created", { intent: it, temperature: result.temperature || "" });
      if (it === "callback" || it === "campus_visit") {
        trackAgentEvent(sessionId, "ai_callback_requested", { intent: it });
      } else if (it === "webinar") {
        trackAgentEvent(sessionId, "ai_webinar_register_click", {});
        // PAID webinar → hand off to the existing payment flow (never bypassed).
        if (result.payUrl) {
          trackAgentEvent(sessionId, "ai_payment_start_click", {});
          navigate(result.payUrl);
        }
      } else if (it === "payment_recovery") {
        trackAgentEvent(sessionId, "ai_payment_recovery_click", {});
        if (result.recovery) {
          setInjectedCards((prev) => [...prev, { kind: "payment_recovery", data: result.recovery! }]);
        }
      }
      if (result.message) {
        setTranscript((prev) => [...prev, { id: nextId(), role: "agent", text: result.message! }]);
      }
    }
    void sendTurn({ step: nextStep });
  }

  function renderCard(card: AgentCard, idx: number | string) {
    switch (card.kind) {
      case "offer":
        return (
          <OfferRecommendationCard
            key={idx}
            offer={card.data}
            onCta={(o) => handleOfferCta(o.link, o.paymentEnabled, o.id, o.type)}
          />
        );
      case "roadmap":
        return <RoadmapCard key={idx} data={card.data} />;
      case "payment_recovery":
        return (
          <PaymentRecoveryCard
            key={idx}
            data={card.data}
            onResume={(link) => {
              fire("ai_payment_recovery_click", "ai_payment_recovery_click");
              navigate(link);
            }}
          />
        );
      case "lead_form":
        return (
          <LeadCaptureForm
            key={idx}
            sessionId={sessionId}
            data={card.data}
            requiresConsent={!!current?.meta.requiresConsent}
            consentBody={CONSENT.body}
            onSubmitted={(nextStep, result) => handleLeadSubmitted(nextStep, card.data.intent || null, result)}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex sm:items-end sm:justify-end" role="dialog" aria-modal="true" aria-label="Naman IAS counsellor chat">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className="relative flex h-full w-full flex-col bg-surface shadow-2xl sm:m-4 sm:h-[min(640px,85vh)] sm:w-[400px] sm:rounded-2xl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3" style={{ background: "var(--primary)" }}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full text-base" style={{ background: "var(--gold, #d4af37)", color: "var(--primary)" }}>
              🎓
            </div>
            <div className="leading-tight text-white">
              <p className="text-sm font-bold">Naman IAS Counsellor</p>
              <p className="text-[11px] opacity-80">Guidance, not spam</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close chat" className="rounded-full p-1.5 text-white/90 hover:bg-white/10">
            ✕
          </button>
        </div>

        {/* Transcript */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3.5 py-4">
          {transcript.map((t) =>
            t.role === "agent" ? (
              <div key={t.id} className="max-w-[85%] rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink shadow-sm">
                {t.text}
              </div>
            ) : (
              <div key={t.id} className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-sm leading-relaxed text-white shadow-sm" style={{ background: "var(--primary)" }}>
                {t.text}
              </div>
            ),
          )}

          {injectedCards.length > 0 && (
            <div className="space-y-2.5">{injectedCards.map((c, i) => renderCard(c, `inj${i}`))}</div>
          )}

          {current?.cards && current.cards.length > 0 && (
            <div className="space-y-2.5">{current.cards.map((c, i) => renderCard(c, i))}</div>
          )}

          {loading && (
            <div className="flex max-w-[60%] gap-1 rounded-2xl rounded-tl-sm bg-white px-3.5 py-3 shadow-sm">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
            </div>
          )}
        </div>

        {/* Quick replies */}
        {current?.quickReplies && current.quickReplies.length > 0 && (
          <div className="border-t border-line bg-white/70 px-3.5 py-3">
            <QuickReplyButtons replies={current.quickReplies} disabled={loading} onSelect={handleQuickReply} />
          </div>
        )}
      </div>
    </div>
  );
}
