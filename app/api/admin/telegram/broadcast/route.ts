import { NextResponse } from "next/server";
import { getActionActor, requirePermission } from "@/lib/adminGuard";
import {
  createAndEnqueueBroadcast,
  getBroadcastDetail,
  listBroadcasts,
} from "@/lib/telegram/broadcasts";
import type { TelegramBroadcastKind, TelegramButton } from "@/lib/telegram/types";

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

export async function GET(req: Request) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const detail = await getBroadcastDetail(id);
    if (!detail) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, ...detail });
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
  const kind = (body.kind || "message") as TelegramBroadcastKind;
  const result = await createAndEnqueueBroadcast({
    audienceId: String(body.audienceId || body.audience_id || ""),
    fromMs,
    toMs,
    body: String(body.body || body.message_body || ""),
    image: body.image || body.image_url || null,
    buttons: asButtons(body.buttons),
    name: body.name || null,
    scheduledAt: body.scheduledAt || body.scheduled_at || null,
    actor,
    fallbacks: (body.fallbacks && typeof body.fallbacks === "object" ? body.fallbacks : {}) as Record<
      string,
      string
    >,
    kind,
    poll: body.poll || null,
    question_key: body.question_key || body.questionKey || null,
    lead_field: body.lead_field || body.leadField || null,
    template_id: body.template_id || body.templateId || null,
    parse_mode: body.parse_mode || body.parseMode || "HTML",
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, broadcast: result.broadcast });
}

/** PATCH accepts the same create fields and enqueues a new broadcast (composer save+send). */
export async function PATCH(req: Request) {
  return POST(req);
}
