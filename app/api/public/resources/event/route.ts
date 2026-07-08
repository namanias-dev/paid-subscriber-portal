import { NextResponse } from "next/server";
import { logResourceEvent, type ResourceEventType } from "@/lib/dataProvider";

export const dynamic = "force-dynamic";

const ALLOWED: ResourceEventType[] = ["cta_click", "quiz_click", "pdf_download", "share"];

/** Lightweight, unauthenticated engagement beacon for the Resources hub. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const type = body?.type as ResourceEventType;
    if (!ALLOWED.includes(type)) return NextResponse.json({ ok: false }, { status: 400 });
    const ref = typeof body?.ref === "string" ? body.ref.slice(0, 300) : null;
    await logResourceEvent(type, ref);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
