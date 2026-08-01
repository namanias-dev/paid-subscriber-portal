import { NextResponse } from "next/server";
import { requireAnyPermission, requirePermission } from "@/lib/adminGuard";
import { linkByPhone, listSubscribers } from "@/lib/telegram/subscribers";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await requireAnyPermission(["telegram_inbox", "manage_telegram"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const result = await listSubscribers({
    activeOnly: url.searchParams.get("active") === "1",
    q: url.searchParams.get("q"),
    limit: Number(url.searchParams.get("limit") || 50),
    offset: Number(url.searchParams.get("offset") || 0),
  });
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(req: Request) {
  if (!(await requirePermission("manage_telegram"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  if (body.action === "link_phone") {
    const sub = await linkByPhone(String(body.chat_id || ""), String(body.phone || ""));
    return NextResponse.json({ ok: !!sub, subscriber: sub });
  }
  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
