import { NextResponse } from "next/server";
import { webhookSecret } from "@/lib/telegram/config";
import { processUpdate, type TelegramUpdate } from "@/lib/telegram/webhookHandler";
import { tgLog } from "@/lib/telegram/log";

export const dynamic = "force-dynamic";
/** Telegram allows up to 60s; process fully before responding (Vercel freezes after return). */
export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = webhookSecret();
  const header = req.headers.get("x-telegram-bot-api-secret-token");

  if (!secret) {
    tgLog("secret_reject", { reason: "TELEGRAM_WEBHOOK_SECRET_missing" }, "error");
    return NextResponse.json({ ok: false, error: "webhook_secret_not_configured" }, { status: 401 });
  }
  if (header == null || header !== secret) {
    tgLog(
      "secret_reject",
      {
        reason: "mismatch",
        headerPresent: header != null,
        headerLen: header?.length ?? 0,
        secretLen: secret.length,
      },
      "warn",
    );
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch (e) {
    tgLog("json_parse_failed", { error: (e as Error).message }, "error");
    // Still 200 so Telegram does not retry a malformed body forever.
    return NextResponse.json({ ok: true, ignored: "bad_json" });
  }

  tgLog("webhook_received", {
    update_id: update.update_id ?? null,
    has_message: !!update.message,
    has_callback: !!update.callback_query,
    chat_id: update.message?.chat?.id ?? update.callback_query?.message?.chat?.id ?? null,
    text_preview: (update.message?.text || "").slice(0, 80) || null,
  });

  // CRITICAL: await processing BEFORE responding. Fire-and-forget is frozen on Vercel.
  try {
    await processUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (e) {
    tgLog("process_update_threw", { error: (e as Error).message }, "error");
    // 200 after logging — avoid infinite Telegram retries for permanent handler bugs.
    return NextResponse.json({ ok: true, error: "handler_exception" });
  }
}
