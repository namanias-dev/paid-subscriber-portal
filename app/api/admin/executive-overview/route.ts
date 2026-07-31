import { NextResponse } from "next/server";
import { requireAdmin, requireAnyPermission } from "@/lib/adminGuard";
import { getExecutiveOverview, type ExecPreset } from "@/lib/analytics/executiveOverview";
import { ttlCached } from "@/lib/ttlCache";

export const dynamic = "force-dynamic";

const PRESETS: ReadonlySet<ExecPreset> = new Set([
  "today",
  "yesterday",
  "7d",
  "30d",
  "this_month",
  "custom",
  "all_time",
]);
const CACHE_MS = 20_000;

export async function GET(req: Request) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL(req.url);
    const presetRaw = (url.searchParams.get("preset") || "30d") as ExecPreset;
    const preset = PRESETS.has(presetRaw) ? presetRaw : "30d";
    const excludeAdmin = url.searchParams.get("excludeAdmin") === "1";
    const canRevenue = await requireAnyPermission([
      "view_revenue",
      "view_analytics_revenue",
      "manage_payments",
    ]);
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const cacheKey = `admin:exec-overview:${preset}:${excludeAdmin ? 1 : 0}:${canRevenue ? 1 : 0}:${from}:${to}`;
    const cached = await ttlCached(cacheKey, CACHE_MS, () =>
      getExecutiveOverview({
        preset,
        from: from || null,
        to: to || null,
        excludeAdmin,
        canRevenue,
      }),
    );
    return NextResponse.json({ ok: true, overview: cached.value, cache: cached.cache });
  } catch (err) {
    console.error("[executive-overview]", err);
    return NextResponse.json({ ok: false, error: "Failed to load executive overview." }, { status: 500 });
  }
}
