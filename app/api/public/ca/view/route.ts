import { NextResponse } from "next/server";
import { incrementCaView } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!id) return NextResponse.json({ ok: false }, { status: 400 });
    await incrementCaView(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
