import { NextResponse } from "next/server";
import { getWebinars, addWebinar } from "@/lib/dataProvider";
import { requireAdmin } from "@/lib/adminGuard";

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
    const webinar = await addWebinar(body);
    return NextResponse.json({ ok: true, webinar });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to create webinar." }, { status: 500 });
  }
}
