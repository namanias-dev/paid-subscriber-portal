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
import { X } from "lucide-react";
import type {
  AgentCard,
  AgentResponse,
  AgentTurnInput,
  FlowId,
  QuickReply,
} from "@/lib/ai-agent/providers/types";
import { AGENT_NAME, CONSENT } from "@/lib/ai-agent/copyLibrary";
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

/** Gold-on-navy compass mark, matching the floating launcher glyph. */
function CounsellorMark() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true" style={{ color: "var(--ca-gold-bright)" }}>
      <circle cx="12" cy="12" r="8.4" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M12 3.1v1.7M12 19.2v1.7M20.9 12h-1.7M4.8 12H3.1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path d="M15.6 8.4 11.1 11.1 8.4 15.6 12.9 12.9 Z" fill="currentColor" />
      <circle cx="12" cy="12" r="1.05" fill="var(--ca-navy-900)" />
    </svg>
  );
}

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
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
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
          { id: nextId(), role: "agent", text: "Sorry, something went wrong at my end. Please try again in a moment." },
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

  // Focus management: move focus into the panel on open, restore on close, and
  // allow Esc to close (presentation/accessibility only — onClose is unchanged).
  useEffect(() => {
    previouslyFocused.current = (document.activeElement as HTMLElement) || null;
    const focusTimer = requestAnimationFrame(() => closeBtnRef.current?.focus());
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [onClose]);

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
    <div
      className="fixed inset-0 z-[60] flex sm:items-end sm:justify-end sm:p-4 lg:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Naman IAS counsellor chat"
    >
      <div className="cac-overlay" onClick={onClose} aria-hidden="true" />

      <div className="cac-panel">
        <span className="cac-orb-a" aria-hidden="true" />

        {/* Header */}
        <header className="cac-header">
          <div className="flex min-w-0 items-center gap-3">
            <span className="cac-brandmark" aria-hidden="true">
              <CounsellorMark />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-bold tracking-tight">{AGENT_NAME}</p>
              <span className="cac-status">
                <span className="cac-status-dot" aria-hidden="true" />
                Online · Your UPSC prep guide
              </span>
            </div>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="cac-iconbtn"
          >
            <X size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </header>

        {/* Transcript */}
        <div
          ref={scrollRef}
          className="cac-log flex flex-col gap-3.5"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label="Conversation with the Naman IAS counsellor"
        >
          {transcript.map((t) =>
            t.role === "agent" ? (
              <div key={t.id} className="cac-row cac-row--agent">
                <span className="cac-avatar" aria-hidden="true">
                  <CounsellorMark />
                </span>
                <div className="cac-bubble cac-bubble--agent">{t.text}</div>
              </div>
            ) : (
              <div key={t.id} className="cac-row cac-row--user">
                <div className="cac-bubble cac-bubble--user">{t.text}</div>
              </div>
            ),
          )}

          {injectedCards.length > 0 && (
            <div className="cac-cards">{injectedCards.map((c, i) => renderCard(c, `inj${i}`))}</div>
          )}

          {current?.cards && current.cards.length > 0 && (
            <div className="cac-cards">{current.cards.map((c, i) => renderCard(c, i))}</div>
          )}

          {loading && (
            <div className="cac-row cac-row--agent">
              <span className="cac-avatar" aria-hidden="true">
                <CounsellorMark />
              </span>
              <div className="cac-typing" role="status" aria-label="Counsellor is typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
        </div>

        {/* Quick replies — premium docked footer */}
        {current?.quickReplies && current.quickReplies.length > 0 && (
          <div className="cac-footer">
            <p className="cac-footer-hint">Choose a reply</p>
            <QuickReplyButtons replies={current.quickReplies} disabled={loading} onSelect={handleQuickReply} />
          </div>
        )}
      </div>
    </div>
  );
}
