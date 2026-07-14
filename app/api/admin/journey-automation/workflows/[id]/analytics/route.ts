import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { computeWorkflowAnalytics } from "@/lib/journey-automation/engine/analytics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Per-workflow analytics + revenue attribution (READ-ONLY, reconciles to
 * deriveCollections). journey_view. Nothing is written or sent.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!(await requirePermission("journey_view"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const analytics = await computeWorkflowAnalytics(params.id);
    return NextResponse.json({ ok: true, analytics });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
