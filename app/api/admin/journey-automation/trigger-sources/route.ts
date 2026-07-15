import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { listTriggerSources } from "@/lib/journey-automation/triggerSources";

export const dynamic = "force-dynamic";

/**
 * Live trigger filter sources for the builder's trigger inspector: the REAL lead
 * forms / product types / courses / webinars the backend has seen, so filters are
 * never a stale hardcoded list. Read-only; gated by `journey_view`.
 */
export async function GET() {
  if (!(await requirePermission("journey_view"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const sources = await listTriggerSources();
    return NextResponse.json({ ok: true, sources });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
