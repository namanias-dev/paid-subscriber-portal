/**
 * ADMIN AGENT API — hot / warm leads (priority queue).
 * API-enforced auth: requirePermission('manage_ai_agent').
 *
 * Reading lead PII is a SENSITIVE action — every access is written to
 * ai_security_audit with the admin actor + IP.
 */
import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { writeSecurityAudit, ipFromRequest } from "@/lib/ai-agent/audit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await requirePermission("manage_ai_agent"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: true, leads: [], demo: true });

  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 200);

  try {
    // Priority = hot first, then warm, ordered by score desc + recency.
    const { data } = await db
      .from("ai_leads")
      .select("*")
      .in("temperature", ["hot", "warm"])
      .order("score", { ascending: false })
      .order("last_seen_at", { ascending: false })
      .limit(limit);

    const actor = await getActionActor();
    await writeSecurityAudit({
      actor: actor?.id || "admin",
      action: "ai_hot_leads_list",
      targetType: "ai_lead",
      targetId: null,
      ip: ipFromRequest(req),
      meta: { count: (data || []).length },
    });

    return NextResponse.json({ ok: true, leads: data ?? [] });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load hot leads." }, { status: 500 });
  }
}
