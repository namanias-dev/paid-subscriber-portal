/**
 * ADMIN AGENT API — follow-ups management.
 * API-enforced auth: requirePermission('manage_ai_agent').
 *
 *  GET   list follow-ups (optionally by status).
 *  POST  create a follow-up (manual; NOTHING is auto-sent — sending stays gated
 *        by AI_AGENT_AUTOFOLLOWUP_ENABLED which remains false in this phase).
 *  PATCH update a follow-up's status (e.g. done / cancelled).
 *
 * Writes are audited to ai_security_audit.
 */
import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { writeSecurityAudit, ipFromRequest } from "@/lib/ai-agent/audit";

export const dynamic = "force-dynamic";

const ALLOWED_STATUS = new Set(["pending", "done", "cancelled", "sent", "failed"]);

export async function GET(req: Request) {
  if (!(await requirePermission("manage_ai_agent"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: true, followups: [], demo: true });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1), 300);

  try {
    let q = db.from("ai_followups").select("*").order("created_at", { ascending: false }).limit(limit);
    if (status && ALLOWED_STATUS.has(status)) q = q.eq("status", status);
    const { data } = await q;
    return NextResponse.json({ ok: true, followups: data ?? [] });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load follow-ups." }, { status: 500 });
  }
}

interface CreateBody {
  lead_id?: string;
  session_id?: string;
  type?: string;
  channel?: string;
  scheduled_for?: string;
  notes?: string;
}

export async function POST(req: Request) {
  if (!(await requirePermission("manage_ai_agent"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as CreateBody;
  const actor = await getActionActor();
  const ts = new Date().toISOString();

  try {
    const { data } = await db
      .from("ai_followups")
      .insert({
        lead_id: body.lead_id ? String(body.lead_id).slice(0, 64) : null,
        session_id: body.session_id ? String(body.session_id).slice(0, 128) : null,
        type: body.type ? String(body.type).slice(0, 40) : "manual",
        channel: body.channel ? String(body.channel).slice(0, 40) : "counselor",
        scheduled_for: body.scheduled_for || null,
        status: "pending",
        payload: body.notes ? { notes: String(body.notes).slice(0, 500) } : {},
        created_at: ts,
      })
      .select("*")
      .maybeSingle();

    await writeSecurityAudit({
      actor: actor?.id || "admin",
      action: "ai_followup_create",
      targetType: "ai_followup",
      targetId: (data?.id as string) || null,
      ip: ipFromRequest(req),
      meta: { type: body.type || "manual", channel: body.channel || "counselor" },
    });

    return NextResponse.json({ ok: true, followup: data ?? null });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to create follow-up." }, { status: 500 });
  }
}

interface PatchBody {
  id?: string;
  status?: string;
}

export async function PATCH(req: Request) {
  if (!(await requirePermission("manage_ai_agent"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as PatchBody;
  const id = String(body.id || "").trim();
  const status = String(body.status || "").trim();
  if (!id || !ALLOWED_STATUS.has(status)) {
    return NextResponse.json({ ok: false, error: "id and valid status required." }, { status: 400 });
  }

  const actor = await getActionActor();
  try {
    const patch: Record<string, unknown> = { status };
    if (status === "done" || status === "sent") patch.sent_at = new Date().toISOString();
    const { data } = await db.from("ai_followups").update(patch).eq("id", id).select("*").maybeSingle();

    await writeSecurityAudit({
      actor: actor?.id || "admin",
      action: "ai_followup_update",
      targetType: "ai_followup",
      targetId: id,
      ip: ipFromRequest(req),
      meta: { status },
    });

    return NextResponse.json({ ok: true, followup: data ?? null });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to update follow-up." }, { status: 500 });
  }
}
