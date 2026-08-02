import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/adminGuard";
import { apiBase, botConfigured } from "@/lib/telegram/config";
import { callMethod } from "@/lib/telegram/botApi";
import { getMeStatus } from "@/lib/telegram/status";

export const dynamic = "force-dynamic";

/**
 * Streams the bot profile photo without exposing the token to the client.
 */
export async function GET() {
  if (!(await requireAnyPermission(["telegram_inbox", "manage_telegram"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!botConfigured()) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 404 });
  }
  const me = await getMeStatus();
  if (!me.id || !me.hasAvatar) {
    return NextResponse.json({ ok: false, error: "no_avatar" }, { status: 404 });
  }

  const photos = await callMethod<{
    photos?: { file_id: string }[][];
  }>("getUserProfilePhotos", { user_id: me.id, limit: 1 });
  const fileId = photos.result?.photos?.[0]?.[0]?.file_id;
  if (!fileId) return NextResponse.json({ ok: false, error: "no_file" }, { status: 404 });

  const file = await callMethod<{ file_path?: string }>("getFile", { file_id: fileId });
  const path = file.result?.file_path;
  const base = apiBase();
  if (!path || !base) return NextResponse.json({ ok: false, error: "no_path" }, { status: 404 });

  // apiBase is https://api.telegram.org/bot<token> — file URL uses /file/bot<token>/<path>
  const fileUrl = base.replace("/bot", "/file/bot") + "/" + path;
  const res = await fetch(fileUrl, { cache: "no-store" });
  if (!res.ok) return NextResponse.json({ ok: false, error: "fetch_failed" }, { status: 502 });
  const buf = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") || "image/jpeg";
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=300",
    },
  });
}
