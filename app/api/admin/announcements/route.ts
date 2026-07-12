import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { getAnnouncements, addAnnouncement } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requirePermission("manage_settings"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const announcements = await getAnnouncements();
  return NextResponse.json({ ok: true, announcements });
}

export async function POST(req: Request) {
  if (!(await requirePermission("manage_settings"))) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.title || !String(body.title).trim()) return NextResponse.json({ ok: false, error: "Title required." }, { status: 400 });
  const announcement = await addAnnouncement(body);
  return NextResponse.json({ ok: true, announcement });
}
