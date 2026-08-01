import { NextResponse } from "next/server";
import { currentAdminId, requireAnyPermission, requirePermission } from "@/lib/adminGuard";
import { botConfigured, botUsername } from "@/lib/telegram/config";
import { getSettings, updateSettings } from "@/lib/telegram/subscribers";
import { defaultWelcomeButtons } from "@/lib/telegram/welcome";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireAnyPermission(["telegram_inbox", "manage_telegram"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const settings = await getSettings();
  return NextResponse.json({
    ok: true,
    settings,
    botConfigured: botConfigured(),
    envBotUsername: botUsername(),
    defaultWelcomeButtons: defaultWelcomeButtons(),
  });
}

export async function PATCH(req: Request) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const adminId = await currentAdminId();
  const settings = await updateSettings(
    {
      bot_username: body.bot_username !== undefined ? body.bot_username : undefined,
      welcome_body: body.welcome_body !== undefined ? body.welcome_body : undefined,
      welcome_buttons: body.welcome_buttons !== undefined ? body.welcome_buttons : undefined,
    },
    adminId,
  );
  return NextResponse.json({ ok: true, settings });
}
