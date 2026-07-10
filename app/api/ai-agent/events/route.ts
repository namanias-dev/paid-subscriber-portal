/**
 * PUBLIC AGENT API — record an agent event (redacted, append-only).
 *
 * Writes to ai_lead_events via conversationStore.recordEvent, which redacts the
 * payload before storage. Rate-limited per IP + per session. Never persists raw
 * PII (redaction handles that) and never returns any stored data.
 */
import { NextResponse } from "next/server";
import { recordEvent } from "@/lib/ai-agent/conversationStore";
import { getAgentContext } from "@/lib/ai-agent/request";
import { hit } from "@/lib/ai-agent/rateLimit";

export const dynamic = "force-dynamic";

interface EventBody {
  session_id?: string;
  lead_id?: string;
  event_type?: string;
  payload?: Record<string, unknown>;
  score_delta?: number;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as EventBody;
  const ctx = getAgentContext(req, body.session_id);

  if (!hit(`ai:events:ip:${ctx.ip}`, 120, 60).allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }
  if (ctx.sessionId && !hit(`ai:events:sid:${ctx.sessionId}`, 120, 60).allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }

  const eventType = String(body.event_type || "").trim();
  if (!eventType) {
    return NextResponse.json({ ok: false, error: "event_type is required." }, { status: 400 });
  }
  if (!ctx.sessionId && !body.lead_id) {
    return NextResponse.json({ ok: false, error: "session or lead is required." }, { status: 400 });
  }

  await recordEvent({
    sessionId: ctx.sessionId || null,
    leadId: body.lead_id ? String(body.lead_id).slice(0, 64) : null,
    eventType,
    payload: body.payload && typeof body.payload === "object" ? body.payload : {},
    scoreDelta: typeof body.score_delta === "number" ? body.score_delta : 0,
  });

  return NextResponse.json({ ok: true });
}
