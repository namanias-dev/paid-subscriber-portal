import { NextResponse } from "next/server";
import { getActionActor, requireAnyPermission, requirePermission } from "@/lib/adminGuard";
import { logAdminActivity } from "@/lib/adminActivity";
import {
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomations,
  runManualAutomation,
  toggleAutomation,
  updateAutomation,
} from "@/lib/telegram/automations";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await requireAnyPermission(["telegram_inbox", "manage_telegram"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const auto = await getAutomation(id);
    if (!auto) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, automation: auto });
  }
  const automations = await listAutomations();
  return NextResponse.json({ ok: true, automations });
}

export async function POST(req: Request) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const actor = await getActionActor();

  if (body.action === "run" && body.id) {
    const result = await runManualAutomation(String(body.id));
    void logAdminActivity({
      actor,
      action: "telegram_automation_updated",
      entityType: "telegram_automation",
      entityId: String(body.id),
      metadata: { action: "run", ...result },
    });
    return NextResponse.json(result);
  }

  if (body.action === "toggle" && body.id != null) {
    const auto = await toggleAutomation(String(body.id), !!body.enabled, actor?.id);
    void logAdminActivity({
      actor,
      action: "telegram_automation_updated",
      entityType: "telegram_automation",
      entityId: String(body.id),
      metadata: { action: "toggle", enabled: !!body.enabled },
    });
    return NextResponse.json({ ok: !!auto, automation: auto });
  }

  const created = await createAutomation({
    name: String(body.name || "Untitled"),
    enabled: !!body.enabled,
    trigger: String(body.trigger || "manual"),
    audience_id: body.audience_id ?? null,
    schedule_mode: body.schedule_mode || "on_trigger",
    schedule_at: body.schedule_at ?? null,
    recurring_cron: body.recurring_cron ?? null,
    message_body: body.message_body || "",
    image_url: body.image_url ?? null,
    buttons: body.buttons || [],
    template_id: body.template_id ?? null,
    follow_ups: body.follow_ups || [],
    stop_on_reply: body.stop_on_reply !== false,
    stop_on_converted: !!body.stop_on_converted,
    created_by: actor?.id,
  });
  void logAdminActivity({
    actor,
    action: "telegram_automation_updated",
    entityType: "telegram_automation",
    entityId: created?.id || null,
    metadata: { action: "create", name: body.name },
  });
  return NextResponse.json({ ok: !!created, automation: created }, { status: created ? 200 : 500 });
}

export async function PATCH(req: Request) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "id_required" }, { status: 400 });
  const actor = await getActionActor();
  const updated = await updateAutomation(id, {
    ...body,
    updated_by: actor?.id,
  });
  void logAdminActivity({
    actor,
    action: "telegram_automation_updated",
    entityType: "telegram_automation",
    entityId: id,
    metadata: { action: "update" },
  });
  return NextResponse.json({ ok: !!updated, automation: updated });
}

export async function DELETE(req: Request) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || (await req.json().catch(() => ({}))).id;
  if (!id) return NextResponse.json({ ok: false, error: "id_required" }, { status: 400 });
  const actor = await getActionActor();
  const ok = await deleteAutomation(String(id));
  void logAdminActivity({
    actor,
    action: "telegram_automation_updated",
    entityType: "telegram_automation",
    entityId: String(id),
    metadata: { action: "delete" },
  });
  return NextResponse.json({ ok });
}
