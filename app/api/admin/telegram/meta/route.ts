import { NextResponse } from "next/server";
import { requireAnyPermission, requirePermission, requireSuperAdmin } from "@/lib/adminGuard";
import { PHONE_AUDIENCES } from "@/lib/adminPhoneAudiences";
import { botConfigured, botUsername } from "@/lib/telegram/config";
import { getWebhookInfoStatus } from "@/lib/telegram/botApi";
import { getSettings } from "@/lib/telegram/subscribers";
import { TELEGRAM_TRIGGER_LIST } from "@/lib/telegram/types";
import { SAMPLE_VARS } from "@/lib/telegram/render";

export const dynamic = "force-dynamic";

export async function GET() {
  const canInbox = await requirePermission("telegram_inbox");
  const canManage = await requirePermission("manage_telegram");
  if (!canInbox && !canManage) {
    if (!(await requireAnyPermission(["telegram_inbox", "manage_telegram"]))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }
  const settings = await getSettings();
  // Same botConfigured() helper the send path uses (reads TELEGRAM_BOT_TOKEN server-side).
  const webhook = await getWebhookInfoStatus();
  const configured = botConfigured() && webhook.configured;

  return NextResponse.json({
    ok: true,
    canInbox: canInbox || canManage,
    canManage,
    isSuperAdmin: await requireSuperAdmin(),
    // Canonical boolean for the UI banner (never the token).
    configured,
    botConfigured: configured,
    webhookRegistered: webhook.webhookRegistered,
    webhookUrl: webhook.webhookUrl,
    pendingUpdateCount: webhook.pendingUpdateCount,
    lastWebhookError: webhook.lastErrorMessage,
    lastWebhookErrorAt: webhook.lastErrorDate,
    botUsername: settings.bot_username || botUsername(),
    audiences: PHONE_AUDIENCES,
    triggers: TELEGRAM_TRIGGER_LIST,
    sampleVars: SAMPLE_VARS,
  });
}
