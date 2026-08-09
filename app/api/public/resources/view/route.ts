import { NextResponse } from "next/server";
import { incrementResourceView } from "@/lib/dataProvider";
import { shouldSkipViewBeacon } from "@/lib/publicViewBeacon";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (shouldSkipViewBeacon(req)) return NextResponse.json({ ok: true, skipped: true });
    const body = await req.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!id) return NextResponse.json({ ok: false }, { status: 400 });
    await incrementResourceView(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
