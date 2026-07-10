/**
 * ADMIN AGENT API — list / inspect leads.
 * API-enforced auth: requirePermission('manage_ai_agent').
 *
 * Reading a lead's PII is a SENSITIVE action — every access is written to
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

  const actor = await getActionActor();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const temperature = url.searchParams.get("temperature");
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 200);

  try {
    if (id) {
      const { data } = await db.from("ai_leads").select("*").eq("id", id).maybeSingle();
      await writeSecurityAudit({
        actor: actor?.id || "admin",
        action: "ai_lead_view",
        targetType: "ai_lead",
        targetId: id,
        ip: ipFromRequest(req),
        meta: { single: true },
      });
      return NextResponse.json({ ok: true, lead: data ?? null });
    }

    let q = db.from("ai_leads").select("*").order("last_seen_at", { ascending: false }).limit(limit);
    if (temperature) q = q.eq("temperature", temperature);
    const { data } = await q;

    await writeSecurityAudit({
      actor: actor?.id || "admin",
      action: "ai_lead_list",
      targetType: "ai_lead",
      targetId: null,
      ip: ipFromRequest(req),
      meta: { count: (data || []).length, temperature: temperature || null },
    });

    return NextResponse.json({ ok: true, leads: data ?? [] });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load leads." }, { status: 500 });
  }
}
