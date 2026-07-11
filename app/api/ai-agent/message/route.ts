/**
 * PUBLIC AGENT API — guided-flow conversation engine.
 *
 * Advances the DETERMINISTIC guided-flow state machine and returns the next
 * messages / quick-replies / cards. NO external LLM is ever called (provider is
 * resolved from config; Phase 2 is always "guided_flow").
 *
 * Guards:
 *  - force-dynamic (never cached).
 *  - per-IP + per-session rate limits (reuses lib/ai-agent/rateLimit).
 *  - input validation + hard caps on free text / ids.
 *  - PII-safe: user text is redacted before it is persisted (conversationStore);
 *    the response itself never echoes PII, and the engine only surfaces
 *    server-sourced live offers.
 *  - consent state is read from nsa_consent (via getAgentContext) so the engine
 *    can gate phone capture when AI_AGENT_REQUIRE_MARKETING_CONSENT is true.
 */
import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai-agent/providers";
import { getAiAgentConfig } from "@/lib/ai-agent/config";
import { getAgentContext } from "@/lib/ai-agent/request";
import { hit } from "@/lib/ai-agent/rateLimit";
import { appendTurn } from "@/lib/ai-agent/conversationStore";
import { sanitizeUserText } from "@/lib/ai-agent/conversationPolicy";
import type { AgentTurnInput, FlowId } from "@/lib/ai-agent/providers/types";
import type { OfferType } from "@/lib/ai-agent/offerResolver";

export const dynamic = "force-dynamic";

const VALID_FLOWS: ReadonlySet<string> = new Set<FlowId>([
  "root",
  "beginner_roadmap",
  "course_reco",
  "webinar_reco",
  "offline_chandigarh",
  "quiz_followup",
  "payment_recovery",
  "counselor_handoff",
  "post_registration",
  "resource_conversion",
]);

interface MessageBody {
  session_id?: string;
  flow?: string;
  step?: string;
  choice_id?: string;
  text?: string;
  context?: {
    page_path?: string;
    offer_id?: string;
    offer_type?: string;
  };
}

function safeStr(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

export async function POST(req: Request) {
  const cfg = getAiAgentConfig();
  const body = (await req.json().catch(() => ({}))) as MessageBody;
  const ctx = getAgentContext(req, body.session_id);

  if (!ctx.sessionId) {
    return NextResponse.json({ ok: false, error: "session is required." }, { status: 400 });
  }
  // Rate limits: per IP + per session (deterministic engine is cheap, but this
  // still throttles abuse / runaway clients).
  if (!hit(`ai:msg:ip:${ctx.ip}`, 120, 60).allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }
  if (!hit(`ai:msg:sid:${ctx.sessionId}`, 120, 60).allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }

  const flow = safeStr(body.flow, 40);
  const text = sanitizeUserText(body.text, 500);
  const offerType = safeStr(body.context?.offer_type, 20);

  const input: AgentTurnInput = {
    sessionId: ctx.sessionId,
    flow: flow && VALID_FLOWS.has(flow) ? (flow as FlowId) : null,
    step: safeStr(body.step, 200),
    choiceId: safeStr(body.choice_id, 80),
    text: text || null,
    context: {
      pagePath: safeStr(body.context?.page_path, 300),
      offerId: safeStr(body.context?.offer_id, 64),
      offerType: offerType === "course" || offerType === "webinar" ? (offerType as OfferType) : null,
    },
  };

  try {
    const provider = getProvider(cfg.provider);
    const response = await provider.run(input, {
      requireConsent: cfg.requireMarketingConsent,
      hasMarketingConsent: ctx.consent.marketing,
    });

    // Persist the turn (redacted) — best-effort; never blocks the reply. Only the
    // user's free text is meaningful to store; quick-reply taps carry no PII.
    if (cfg.storeConversations) {
      if (text) {
        void appendTurn({ sessionId: ctx.sessionId, role: "user", text, provider: cfg.provider }).catch(() => {});
      }
      const agentText = response.messages.map((m) => m.text).join(" ");
      if (agentText) {
        void appendTurn({
          sessionId: ctx.sessionId,
          role: "agent",
          text: agentText,
          payload: { step: response.step, flow: response.flow, intent: response.meta.intent || null },
          provider: cfg.provider,
        }).catch(() => {});
      }
    }

    return NextResponse.json({ ok: true, response });
  } catch {
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}
