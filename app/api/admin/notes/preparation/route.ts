import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/adminGuard";
import { computePreparationDemand } from "@/lib/store/preparation";

export const dynamic = "force-dynamic";

/** GET — copies-to-prepare across all paid, not-yet-dispatched orders. */
export async function GET() {
  if (!(await requirePermission("store_manage_orders"))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const rows = await computePreparationDemand();
    return NextResponse.json(
      {
        ok: true,
        rows,
        totals: {
          products: rows.length,
          copies_required: rows.reduce((s, r) => s + r.additional_required, 0),
          total_demand: rows.reduce((s, r) => s + r.demand, 0),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
