import { NextResponse } from "next/server";
import { getActionActor, requirePermission } from "@/lib/adminGuard";
import { createAndEnqueueBroadcast, listBroadcasts } from "@/lib/telegram/broadcasts";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const broadcasts = await listBroadcasts(50);
  return NextResponse.json({ ok: true, broadcasts });
}

export async function POST(req: Request) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const actor = await getActionActor();
  const fromMs = Number(body.fromMs) || Date.now() - 30 * 24 * 3600 * 1000;
  const toMs = Number(body.toMs) || Date.now();
  const result = await createAndEnqueueBroadcast({
    audienceId: String(body.audienceId || body.audience_id || ""),
    fromMs,
    toMs,
    body: String(body.body || body.message_body || ""),
    image: body.image || body.image_url || null,
    buttons: body.buttons || [],
    name: body.name || null,
    scheduledAt: body.scheduledAt || body.scheduled_at || null,
    actor,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, broadcast: result.broadcast });
}
