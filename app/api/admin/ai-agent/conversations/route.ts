/**
 * ADMIN AGENT API — list / inspect conversations (redacted summaries only).
 * API-enforced auth: requirePermission('manage_ai_agent').
 */
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await requirePermission("manage_ai_agent"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: true, conversations: [], demo: true });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const sessionId = url.searchParams.get("session_id");
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 200);

  try {
    if (id) {
      const { data: convo } = await db.from("ai_conversations").select("*").eq("id", id).maybeSingle();
      const { data: events } = await db
        .from("ai_lead_events")
        .select("*")
        .eq("session_id", convo?.session_id || "")
        .order("created_at", { ascending: true })
        .limit(500);
      return NextResponse.json({ ok: true, conversation: convo ?? null, events: events ?? [] });
    }

    let q = db
      .from("ai_conversations")
      .select("*")
      .order("last_message_at", { ascending: false })
      .limit(limit);
    if (sessionId) q = q.eq("session_id", sessionId);
    const { data } = await q;
    return NextResponse.json({ ok: true, conversations: data ?? [] });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load conversations." }, { status: 500 });
  }
}
