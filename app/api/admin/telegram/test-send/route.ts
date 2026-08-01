import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { inlineKeyboardFromButtons, sendMessage, sendPhoto } from "@/lib/telegram/botApi";
import { renderTelegramBody, SAMPLE_VARS } from "@/lib/telegram/render";
import type { TelegramButton } from "@/lib/telegram/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const chatId = String(body.chat_id || "").trim();
  if (!chatId) return NextResponse.json({ ok: false, error: "chat_id_required" }, { status: 400 });

  const vars = { ...SAMPLE_VARS, ...(body.vars || {}) };
  const text = renderTelegramBody(String(body.body || "Test from Telegram Mission Control"), vars);
  const buttons = (Array.isArray(body.buttons) ? body.buttons : []) as TelegramButton[];
  const markup = inlineKeyboardFromButtons(buttons);

  let result;
  if (body.image_url) {
    result = await sendPhoto({
      chat_id: chatId,
      photo: String(body.image_url),
      caption: text,
      reply_markup: markup,
    });
  } else {
    result = await sendMessage({
      chat_id: chatId,
      text,
      reply_markup: markup,
      disable_web_page_preview: true,
    });
  }

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.description || "send_failed", error_code: result.error_code },
      { status: 400 },
    );
  }
  return NextResponse.json({
    ok: true,
    telegram_message_id: result.result?.message_id ?? null,
    rendered: text,
  });
}
