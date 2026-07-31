import { NextResponse } from "next/server";
import { requireAdmin, requireAnyPermission } from "@/lib/adminGuard";
import {
  getExecutivePulse,
  getExecutiveBody,
  getExecutiveOverview,
  type ExecPreset,
  type ExecPart,
} from "@/lib/analytics/executiveOverview";
import { ttlCached } from "@/lib/ttlCache";

export const dynamic = "force-dynamic";

const PRESETS: ReadonlySet<ExecPreset> = new Set(["today", "7d", "30d", "this_month", "all_time"]);
const PARTS: ReadonlySet<ExecPart> = new Set(["pulse", "body", "full"]);
const CACHE_MS = 20_000;

export async function GET(req: Request) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL(req.url);
    const presetRaw = (url.searchParams.get("preset") || "30d") as ExecPreset;
    const preset = PRESETS.has(presetRaw) ? presetRaw : "30d";
    const partRaw = (url.searchParams.get("part") || "full") as ExecPart;
    const part = PARTS.has(partRaw) ? partRaw : "full";
    const excludeAdmin = url.searchParams.get("excludeAdmin") === "1";
    const canRevenue = await requireAnyPermission([
      "view_revenue",
      "view_analytics_revenue",
      "manage_payments",
    ]);
    const cacheKey = `admin:exec-overview:v2:${part}:${preset}:${excludeAdmin ? 1 : 0}:${canRevenue ? 1 : 0}`;
    const cached = await ttlCached(cacheKey, CACHE_MS, async () => {
      const opts = { preset, excludeAdmin, canRevenue };
      if (part === "pulse") return { part, ...(await getExecutivePulse(opts)) };
      if (part === "body") return { part, ...(await getExecutiveBody(opts)) };
      return { part: "full" as const, ...(await getExecutiveOverview(opts)) };
    });
    return NextResponse.json({ ok: true, overview: cached.value, cache: cached.cache });
  } catch (err) {
    console.error("[executive-overview]", err);
    return NextResponse.json({ ok: false, error: "Failed to load executive overview." }, { status: 500 });
  }
}
