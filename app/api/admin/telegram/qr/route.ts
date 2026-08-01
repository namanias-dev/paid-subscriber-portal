import { NextResponse } from "next/server";
import { requireAnyPermission } from "@/lib/adminGuard";
import { qrSvg } from "@/lib/telegram/qrSvg";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await requireAnyPermission(["telegram_inbox", "manage_telegram", "manage_students_leads"]))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const data = url.searchParams.get("data") || "";
  const size = Math.min(512, Math.max(64, Number(url.searchParams.get("size") || 200)));
  if (!data) {
    return NextResponse.json({ ok: false, error: "data_required" }, { status: 400 });
  }
  const svg = qrSvg(data, size);
  return new NextResponse(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "private, max-age=300",
    },
  });
}
