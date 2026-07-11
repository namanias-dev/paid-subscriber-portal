/**
 * WORKER API — write model SUGGESTIONS back for human review (HMAC-gated). PHASE 5.
 *
 * The worker posts model-generated suggestions here. They are PERSISTED for a
 * human to review — NOTHING is ever auto-sent. Two payload kinds:
 *
 *   1. followup suggestions → inserted into `ai_followups` as type
 *      "ai_suggestion", status "pending". Auto-send stays gated behind
 *      AI_AGENT_AUTOFOLLOWUP_ENABLED (which remains false); this endpoint never
 *      sends anything regardless.
 *   2. offer knowledge → stored in `ai_agent_settings` under key
 *      "ai_offer_knowledge" for the admin dashboard to surface.
 *
 * All free text is REDACTED before storage (defense-in-depth — the model output
 * must never introduce a PII/secret leak). DISABLED (404) unless
 * AI_AGENT_HMAC_SECRET is set. Writes are audited.
 */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAiAgentConfig } from "@/lib/ai-agent/config";
import { guardWorkerRequest } from "@/lib/ai-agent/security/workerGuard";
import { writeSecurityAudit, ipFromRequest } from "@/lib/ai-agent/audit";
import { redactText, redactObject } from "@/lib/ai-agent/security/redaction";

export const dynamic = "force-dynamic";

interface SuggestionItem {
  lead_id?: string;
  session_id?: string;
  text?: string;
}

export async function POST(req: Request) {
  const gate = await guardWorkerRequest(req);
  if (!gate.ok) return gate.response;

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });

  const body = gate.body;
  const ts = new Date().toISOString();
  // Belt-and-braces: this endpoint NEVER sends. Record the sending posture so an
  // audit reviewer can confirm auto-follow-up was off when suggestions landed.
  const autoFollowupEnabled = getAiAgentConfig().autoFollowupEnabled;

  let followupsWritten = 0;
  let knowledgeWritten = false;

  try {
    // (1) Follow-up suggestions → ai_followups (pending, never sent).
    const rawSuggestions = Array.isArray(body.suggestions) ? (body.suggestions as SuggestionItem[]) : [];
    const rows = rawSuggestions
      .slice(0, 50)
      .map((s) => {
        const text = redactText(String(s?.text || "")).slice(0, 500);
        if (!text) return null;
        return {
          lead_id: s.lead_id ? String(s.lead_id).slice(0, 64) : null,
          session_id: s.session_id ? String(s.session_id).slice(0, 128) : null,
          type: "ai_suggestion",
          channel: "counselor",
          scheduled_for: null,
          status: "pending" as const,
          payload: { notes: text, source: "ai_worker", auto_send: false },
          created_at: ts,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length) {
      const { error } = await db.from("ai_followups").insert(rows);
      if (!error) followupsWritten = rows.length;
    }

    // (2) Offer knowledge → ai_agent_settings["ai_offer_knowledge"].
    if (body.offer_knowledge && typeof body.offer_knowledge === "object") {
      const value = redactObject({
        ...(body.offer_knowledge as Record<string, unknown>),
        updated_by: "ai_worker",
        updated_at: ts,
      });
      const { data: existing } = await db
        .from("ai_agent_settings")
        .select("id")
        .eq("key", "ai_offer_knowledge")
        .limit(1)
        .maybeSingle();
      if (existing) {
        await db.from("ai_agent_settings").update({ value, updated_at: ts }).eq("id", existing.id);
      } else {
        await db
          .from("ai_agent_settings")
          .insert({ key: "ai_offer_knowledge", value, updated_at: ts, created_at: ts });
      }
      knowledgeWritten = true;
    }

    await writeSecurityAudit({
      actor: "ai_worker",
      action: "worker_suggestions_write",
      targetType: "ai_followup",
      targetId: null,
      ip: ipFromRequest(req),
      meta: { followups: followupsWritten, offer_knowledge: knowledgeWritten, auto_send: autoFollowupEnabled },
    });

    return NextResponse.json({
      ok: true,
      followups_written: followupsWritten,
      offer_knowledge_written: knowledgeWritten,
      auto_send: autoFollowupEnabled,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to write suggestions." }, { status: 500 });
  }
}
