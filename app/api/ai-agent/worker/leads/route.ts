/**
 * WORKER API — minimized, NON-PII lead queue (HMAC-gated). PHASE 5.
 *
 * The optional local worker calls this to fetch priority leads to reason about.
 * It returns ONLY coarse, non-PII signals — NEVER phone / email / name. The city
 * is included as a coarse category signal (explicitly allowed). Conversation
 * summaries are the ALREADY-REDACTED rolling summaries from ai_conversations.
 *
 * DISABLED (404) unless AI_AGENT_HMAC_SECRET is set. Reading the queue is a
 * sensitive action → audited to ai_security_audit.
 */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { guardWorkerRequest } from "@/lib/ai-agent/security/workerGuard";
import { writeSecurityAudit, ipFromRequest } from "@/lib/ai-agent/audit";
import { redactObject } from "@/lib/ai-agent/security/redaction";
import type { AiLead } from "@/lib/ai-agent/types";

export const dynamic = "force-dynamic";

const KINDS = new Set(["hot", "warm", "hot_warm", "all"]);

/** Project a lead to the minimized, NON-PII shape safe to hand to the model. */
function minimizeLead(lead: AiLead): Record<string, unknown> {
  return redactObject({
    id: lead.id,
    temperature: lead.temperature,
    score: lead.score,
    status: lead.status,
    // Coarse, non-identifying signals only.
    target_year: lead.target_year,
    city: lead.city, // coarse city category — never combined with name/phone here
    offer_interest: Array.isArray(lead.offer_interest) ? lead.offer_interest.slice(0, 8) : [],
    last_seen_at: lead.last_seen_at,
    created_at: lead.created_at,
  });
}

export async function POST(req: Request) {
  const gate = await guardWorkerRequest(req);
  if (!gate.ok) return gate.response;

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: true, leads: [], demo: true });

  const kindRaw = String((gate.body.kind as string) || "hot_warm");
  const kind = KINDS.has(kindRaw) ? kindRaw : "hot_warm";
  const limit = Math.min(Math.max(Number(gate.body.limit) || 25, 1), 100);

  try {
    let q = db
      .from("ai_leads")
      .select("*")
      .order("score", { ascending: false })
      .order("last_seen_at", { ascending: false })
      .limit(limit);

    if (kind === "hot") q = q.eq("temperature", "hot");
    else if (kind === "warm") q = q.eq("temperature", "warm");
    else if (kind === "hot_warm") q = q.in("temperature", ["hot", "warm"]);

    const { data } = await q;
    const leads = (data ?? []).map((l) => minimizeLead(l as AiLead));

    await writeSecurityAudit({
      actor: "ai_worker",
      action: "worker_leads_list",
      targetType: "ai_lead",
      targetId: null,
      ip: ipFromRequest(req),
      meta: { kind, count: leads.length },
    });

    return NextResponse.json({ ok: true, leads });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load leads." }, { status: 500 });
  }
}
