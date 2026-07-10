/**
 * ADMIN AGENT API — GET / PUT ai_agent_settings (key/value config).
 * API-enforced auth: requirePermission('manage_ai_agent').
 *
 * A settings CHANGE is a SENSITIVE action — written to ai_security_audit with the
 * admin actor + IP. Values are stored as JSONB keyed by `key`.
 */
import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { writeSecurityAudit, ipFromRequest } from "@/lib/ai-agent/audit";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requirePermission("manage_ai_agent"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: true, settings: [], demo: true });
  try {
    const { data } = await db
      .from("ai_agent_settings")
      .select("*")
      .order("updated_at", { ascending: false });
    return NextResponse.json({ ok: true, settings: data ?? [] });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load settings." }, { status: 500 });
  }
}

interface SettingsBody {
  key?: string;
  value?: unknown;
}

export async function PUT(req: Request) {
  if (!(await requirePermission("manage_ai_agent"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as SettingsBody;
  const key = String(body.key || "").trim().slice(0, 120);
  if (!key) return NextResponse.json({ ok: false, error: "key is required." }, { status: 400 });

  const actor = await getActionActor();
  const ts = new Date().toISOString();

  try {
    const { data: existing } = await db
      .from("ai_agent_settings")
      .select("id")
      .eq("key", key)
      .limit(1)
      .maybeSingle();

    let row;
    if (existing) {
      const { data } = await db
        .from("ai_agent_settings")
        .update({ value: body.value ?? null, updated_at: ts })
        .eq("id", existing.id)
        .select("*")
        .maybeSingle();
      row = data;
    } else {
      const { data } = await db
        .from("ai_agent_settings")
        .insert({ key, value: body.value ?? null, updated_at: ts, created_at: ts })
        .select("*")
        .maybeSingle();
      row = data;
    }

    await writeSecurityAudit({
      actor: actor?.id || "admin",
      action: "ai_settings_update",
      targetType: "ai_agent_settings",
      targetId: key,
      ip: ipFromRequest(req),
      meta: { key },
    });

    return NextResponse.json({ ok: true, setting: row ?? null });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to save settings." }, { status: 500 });
  }
}
