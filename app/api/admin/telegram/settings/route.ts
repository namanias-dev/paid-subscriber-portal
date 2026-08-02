import { NextResponse } from "next/server";
import { currentAdminId, requireAnyPermission, requirePermission } from "@/lib/adminGuard";
import { defaultWelcomeButtons } from "@/lib/telegram/defaults";
import { getTelegramLiveStatus, reregisterWebhook } from "@/lib/telegram/status";
import { getSettings, updateSettings } from "@/lib/telegram/subscribers";
import type { TelegramButton } from "@/lib/telegram/types";

export const dynamic = "force-dynamic";

function normalizeButtons(raw: unknown): TelegramButton[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map((b) => {
      if (!b || typeof b !== "object") return null;
      const o = b as Record<string, unknown>;
      const label = String(o.label || "").trim();
      const url = String(o.url || "").trim();
      if (!label || !url) return null;
      try {
        const u = new URL(url);
        if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      } catch {
        return null;
      }
      return { label: label.slice(0, 64), url };
    })
    .filter(Boolean)
    .slice(0, 3) as TelegramButton[];
}

export async function GET() {
  if (!(await requireAnyPermission(["telegram_inbox", "manage_telegram"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const [settings, live] = await Promise.all([getSettings(), getTelegramLiveStatus()]);
  return NextResponse.json({
    ok: true,
    settings,
    bot: live.bot,
    webhook: live.webhook,
    healthy: live.healthy,
    defaultWelcomeButtons: defaultWelcomeButtons(),
  });
}

export async function PATCH(req: Request) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const adminId = await currentAdminId();

  // Accept both snake_case (canonical) and legacy camelCase from older UI.
  const welcome_body =
    body.welcome_body !== undefined
      ? body.welcome_body
      : body.welcomeMessage !== undefined
        ? body.welcomeMessage
        : undefined;
  const welcome_buttons =
    body.welcome_buttons !== undefined
      ? normalizeButtons(body.welcome_buttons)
      : body.welcomeButtons !== undefined
        ? normalizeButtons(body.welcomeButtons)
        : undefined;

  const settings = await updateSettings(
    {
      bot_username: body.bot_username !== undefined ? body.bot_username : undefined,
      welcome_body,
      welcome_buttons,
      welcome_image_url:
        body.welcome_image_url !== undefined ? body.welcome_image_url || null : undefined,
      unknown_command_reply:
        body.unknown_command_reply !== undefined ? body.unknown_command_reply : undefined,
      first_inbound_ack_enabled:
        body.first_inbound_ack_enabled !== undefined
          ? !!body.first_inbound_ack_enabled
          : undefined,
      first_inbound_ack_body:
        body.first_inbound_ack_body !== undefined ? body.first_inbound_ack_body : undefined,
    },
    adminId,
  );
  return NextResponse.json({ ok: true, settings });
}

export async function POST(req: Request) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  if (body.action === "reregister_webhook") {
    const result = await reregisterWebhook();
    return NextResponse.json({
      ok: result.ok,
      url: result.url,
      description: result.description,
      result: result.result,
      error: result.ok ? undefined : result.description || "setWebhook_failed",
    }, { status: result.ok ? 200 : 400 });
  }
  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
