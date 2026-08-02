import { NextResponse } from "next/server";
import { requireAnyPermission, requirePermission, requireSuperAdmin } from "@/lib/adminGuard";
import { PHONE_AUDIENCES } from "@/lib/adminPhoneAudiences";
import { SAMPLE_VARS } from "@/lib/telegram/render";
import { getSettings } from "@/lib/telegram/subscribers";
import { getTelegramLiveStatus } from "@/lib/telegram/status";
import { TELEGRAM_TRIGGER_LIST } from "@/lib/telegram/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const canInbox = await requirePermission("telegram_inbox");
  const canManage = await requirePermission("manage_telegram");
  if (!canInbox && !canManage) {
    if (!(await requireAnyPermission(["telegram_inbox", "manage_telegram"]))) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  const force = new URL(req.url).searchParams.get("refresh") === "1";
  const [settings, live] = await Promise.all([
    getSettings(),
    getTelegramLiveStatus({ force }),
  ]);

  const username = live.bot.username || settings.bot_username;

  return NextResponse.json({
    ok: true,
    canInbox: canInbox || canManage,
    canManage,
    isSuperAdmin: await requireSuperAdmin(),
    configured: live.configured,
    botConfigured: live.configured,
    online: live.online,
    healthy: live.healthy,
    healthReason: live.healthReason,
    webhookRegistered: live.webhook.webhookRegistered,
    webhookUrl: live.webhook.webhookUrl,
    pendingUpdateCount: live.webhook.pendingUpdateCount,
    lastWebhookError: live.webhook.lastErrorMessage,
    lastWebhookErrorAt: live.webhook.lastErrorDate,
    webhookHitsLastHour: live.webhookHitsLastHour,
    webhookSecretConfigured: live.webhookSecretConfigured,
    lastInboundAt: live.lastInboundAt,
    lastOutboundAt: live.lastOutboundAt,
    bot: {
      id: live.bot.id,
      username,
      firstName: live.bot.firstName,
      online: live.bot.online,
      hasAvatar: live.bot.hasAvatar,
      error: live.bot.error,
    },
    botUsername: username,
    audiences: PHONE_AUDIENCES,
    triggers: TELEGRAM_TRIGGER_LIST,
    sampleVars: SAMPLE_VARS,
  });
}
