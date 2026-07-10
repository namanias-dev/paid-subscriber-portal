/**
 * PUBLIC AGENT API — append a conversation turn (redacted).
 *
 * Appends to ai_conversations + a mirrored ai_lead_events row via
 * conversationStore.appendTurn, which redacts all text/payload before storage.
 * Rate-limited per IP + per session. Returns only non-PII conversation metadata.
 */
import { NextResponse } from "next/server";
import { appendTurn } from "@/lib/ai-agent/conversationStore";
import { getAgentContext } from "@/lib/ai-agent/request";
import { hit } from "@/lib/ai-agent/rateLimit";

export const dynamic = "force-dynamic";

interface ConvoBody {
  session_id?: string;
  lead_id?: string;
  role?: "user" | "agent" | "system";
  text?: string;
  payload?: Record<string, unknown>;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as ConvoBody;
  const ctx = getAgentContext(req, body.session_id);

  if (!ctx.sessionId) {
    return NextResponse.json({ ok: false, error: "session is required." }, { status: 400 });
  }
  if (!hit(`ai:convo:ip:${ctx.ip}`, 120, 60).allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }
  if (!hit(`ai:convo:sid:${ctx.sessionId}`, 120, 60).allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429 });
  }

  const role: "user" | "agent" | "system" =
    body.role === "agent" || body.role === "system" ? body.role : "user";

  const result = await appendTurn({
    sessionId: ctx.sessionId,
    leadId: body.lead_id ? String(body.lead_id).slice(0, 64) : null,
    role,
    text: typeof body.text === "string" ? body.text : "",
    payload: body.payload && typeof body.payload === "object" ? body.payload : undefined,
  });

  if (!result.ok) {
    // storage disabled / not configured are soft outcomes, not hard failures.
    if (result.error === "storage_disabled" || result.error === "not_configured") {
      return NextResponse.json({ ok: true, stored: false });
    }
    return NextResponse.json({ ok: false, error: "Could not save." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    stored: true,
    conversation: result.conversation
      ? {
          id: result.conversation.id,
          message_count: result.conversation.message_count,
          status: result.conversation.status,
        }
      : null,
  });
}
