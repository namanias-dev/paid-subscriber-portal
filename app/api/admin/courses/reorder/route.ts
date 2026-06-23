import { NextResponse } from "next/server";
import { reorderCourses } from "@/lib/dataProvider";
import { requireAdmin } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown): x is string => typeof x === "string") : null;
    if (!ids || ids.length === 0) return NextResponse.json({ ok: false, error: "ids[] required." }, { status: 400 });
    const res = await reorderCourses(ids);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error || "Reorder failed." }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to reorder courses.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
