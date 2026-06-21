import { NextResponse } from "next/server";
import { getWebinars, addWebinar } from "@/lib/dataProvider";
import { requireAdmin } from "@/lib/adminGuard";
import { normalizeLandingInput } from "@/lib/landing";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const webinars = await getWebinars();
    return NextResponse.json({ ok: true, webinars });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load webinars." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    if (!body.title) return NextResponse.json({ ok: false, error: "Title required." }, { status: 400 });
    const norm = normalizeLandingInput(body);
    if (!norm.ok) return NextResponse.json({ ok: false, error: norm.error }, { status: 400 });
    const webinar = await addWebinar(norm.value!);
    return NextResponse.json({ ok: true, webinar });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create webinar.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
