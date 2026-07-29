import { NextResponse } from "next/server";
import { requireAdmin, requireAnyPermission } from "@/lib/adminGuard";
import { getCeoOverview } from "@/lib/analytics/ceoOverview";
import type { RangePreset } from "@/lib/analytics/queries";
import { ttlCached } from "@/lib/ttlCache";

export const dynamic = "force-dynamic";

const PRESETS: ReadonlySet<RangePreset> = new Set(["today", "yesterday", "7d", "30d", "this_month", "custom"]);
const OVERVIEW_CACHE_MS = 20_000;

export async function GET(req: Request) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL(req.url);
    const presetRaw = (url.searchParams.get("preset") || "30d") as RangePreset;
    const preset = PRESETS.has(presetRaw) ? presetRaw : "30d";
    const excludeAdmin = url.searchParams.get("excludeAdmin") === "1";
    // Same revenue gate the /api/admin/dashboard route uses — hide ₹ server-side
    // (not just in the UI) for accounts without revenue access.
    const canRevenue = await requireAnyPermission(["view_revenue", "view_analytics_revenue", "manage_payments"]);
    const cacheKey = `admin:overview:${preset}:${excludeAdmin ? 1 : 0}:${canRevenue ? 1 : 0}:${url.searchParams.get("from") || ""}:${url.searchParams.get("to") || ""}`;
    const cached = await ttlCached(cacheKey, OVERVIEW_CACHE_MS, () =>
      getCeoOverview({
        preset,
        from: url.searchParams.get("from"),
        to: url.searchParams.get("to"),
        excludeAdmin,
        canRevenue,
      }),
    );
    return NextResponse.json({ ok: true, overview: cached.value, cache: cached.cache });
  } catch {
    return NextResponse.json({ ok: false, error: "Failed to load overview." }, { status: 500 });
  }
}
