import { NextResponse } from "next/server";
import { webhookSecret } from "@/lib/telegram/config";
import { processUpdate } from "@/lib/telegram/webhookHandler";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const secret = webhookSecret();
  const header = req.headers.get("x-telegram-bot-api-secret-token");
  if (!secret || header !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: unknown = null;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Acknowledge immediately; process async.
  void processUpdate(update as Parameters<typeof processUpdate>[0]).catch(() => {});
  return NextResponse.json({ ok: true });
}
