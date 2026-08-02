import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { prepareOutboundHtml } from "@/lib/telegram/compose";
import { missingVarReport, resolveRecipientVars } from "@/lib/telegram/recipientVars";
import { SAMPLE_VARS } from "@/lib/telegram/render";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const template = String(body.body || "");
  const fallbacks =
    body.fallbacks && typeof body.fallbacks === "object"
      ? (body.fallbacks as Record<string, string>)
      : {};
  const chatId = body.chatId || body.chat_id ? String(body.chatId || body.chat_id) : null;
  const hasImage = !!(body.image || body.image_url);

  let vars: Record<string, string> = { ...SAMPLE_VARS };
  let source: "sample" | "recipient" = "sample";
  if (chatId) {
    vars = await resolveRecipientVars({
      chatId,
      nameHint: body.name || null,
      phoneHint: body.phone || null,
    });
    source = "recipient";
  }

  const prepared = prepareOutboundHtml(template, vars, fallbacks, { hasImage });
  const missing = missingVarReport(template, [{ vars }]);

  return NextResponse.json({
    ok: true,
    html: prepared.html,
    plainLength: prepared.plainLength,
    usedFallbacks: prepared.usedFallbacks,
    missingVars: prepared.missingVars,
    missingReport: missing,
    overLimit: prepared.overLimit,
    limit: prepared.limit,
    source,
    vars,
  });
}
