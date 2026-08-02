import { NextResponse } from "next/server";
import { getActionActor, requirePermission } from "@/lib/adminGuard";
import { createDirectSend } from "@/lib/telegram/broadcasts";
import type { TelegramButton } from "@/lib/telegram/types";

export const dynamic = "force-dynamic";

function asButtons(raw: unknown): TelegramButton[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => {
      if (!b || typeof b !== "object") return null;
      const o = b as Record<string, unknown>;
      const label = String(o.label || "").trim();
      if (!label) return null;
      const url = o.url != null ? String(o.url).trim() : "";
      const callback_data = o.callback_data != null ? String(o.callback_data).trim() : "";
      if (callback_data) return { label, callback_data };
      if (url) return { label, url };
      return null;
    })
    .filter(Boolean) as TelegramButton[];
}

export async function POST(req: Request) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const actor = await getActionActor();
  const result = await createDirectSend({
    chatId: String(body.chatId || body.chat_id || ""),
    body: String(body.body || ""),
    image: body.image || body.image_url || null,
    buttons: asButtons(body.buttons),
    fallbacks:
      body.fallbacks && typeof body.fallbacks === "object"
        ? (body.fallbacks as Record<string, string>)
        : {},
    actor,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, queueId: result.queueId });
}
