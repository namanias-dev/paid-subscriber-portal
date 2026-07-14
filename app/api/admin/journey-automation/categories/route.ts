import { NextResponse } from "next/server";
import { requirePermission, getActionActor } from "@/lib/adminGuard";
import { setCategoryPause } from "@/lib/journey-automation/engine/control";

export const dynamic = "force-dynamic";

/**
 * Per-category pause/resume (e.g. halt ALL payment_reminder sends across every
 * workflow without touching the global kill switch). Requires
 * journey_manage_execution. Audited.
 */
export async function POST(req: Request) {
  if (!(await requirePermission("journey_manage_execution"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const actor = await getActionActor();
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const category = String(body.category ?? "").trim();
  if (!category) return NextResponse.json({ ok: false, error: "category required" }, { status: 400 });
  const paused = body.paused !== false;

  try {
    const pausedCategories = await setCategoryPause(category, paused, actor);
    return NextResponse.json({ ok: true, pausedCategories });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
