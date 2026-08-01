import { NextResponse } from "next/server";
import { currentAdminId, requireAnyPermission, requirePermission } from "@/lib/adminGuard";
import { getSupabaseAdmin } from "@/lib/supabase";
import { extractVars } from "@/lib/telegram/render";
import type { TelegramButton } from "@/lib/telegram/types";

export const dynamic = "force-dynamic";

function asButtons(raw: unknown): TelegramButton[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => {
      if (!b || typeof b !== "object") return null;
      const o = b as Record<string, unknown>;
      const label = String(o.label || "").trim();
      const url = String(o.url || "").trim();
      if (!label || !url) return null;
      return { label, url };
    })
    .filter(Boolean) as TelegramButton[];
}

export async function GET() {
  if (!(await requireAnyPermission(["telegram_inbox", "manage_telegram"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: true, templates: [] });
  const { data } = await db
    .from("telegram_templates")
    .select("*")
    .order("updated_at", { ascending: false });
  return NextResponse.json({ ok: true, templates: data || [] });
}

export async function POST(req: Request) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const tplBody = String(body.body || "");
  if (!name || !tplBody) {
    return NextResponse.json({ ok: false, error: "name_and_body_required" }, { status: 400 });
  }
  const id = String(body.id || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")).slice(0, 64);
  const adminId = await currentAdminId();
  const now = new Date().toISOString();
  const row = {
    id,
    name,
    body: tplBody,
    image_url: body.image_url ? String(body.image_url) : null,
    buttons: asButtons(body.buttons),
    variables: extractVars(tplBody),
    is_active: body.is_active !== false,
    created_by: adminId,
    updated_by: adminId,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await db.from("telegram_templates").upsert(row).select("*").single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, template: data });
}

export async function PATCH(req: Request) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "id_required" }, { status: 400 });
  const adminId = await currentAdminId();
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: adminId,
  };
  if (body.name !== undefined) patch.name = String(body.name);
  if (body.body !== undefined) {
    patch.body = String(body.body);
    patch.variables = extractVars(String(body.body));
  }
  if (body.image_url !== undefined) patch.image_url = body.image_url ? String(body.image_url) : null;
  if (body.buttons !== undefined) patch.buttons = asButtons(body.buttons);
  if (body.is_active !== undefined) patch.is_active = !!body.is_active;

  const { data, error } = await db.from("telegram_templates").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, template: data });
}
